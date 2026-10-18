use crate::core2_contract::validate_core_dto;
use crate::core2_json::stable_json;
use crate::core2_store::{LoadedView, LockedStore, RowChange};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

pub(crate) fn checked(kind: &str, value: &Value) -> Result<(), String> {
    if validate_core_dto(kind, value) {
        Ok(())
    } else {
        Err(format!("CORE2_INVALID_{}", kind.to_ascii_uppercase()))
    }
}
pub(crate) fn text(value: &Value) -> Result<&str, String> {
    value.as_str().ok_or_else(|| "CORE2_CORRUPT_RECORD".into())
}
pub(crate) fn scope_key(scope: &Value) -> Result<String, String> {
    checked("scope", scope)?;
    Ok(format!(
        "{}/{}",
        text(&scope["journeyId"])?,
        text(&scope["branchId"])?
    ))
}
pub(crate) fn source_key(reference: &Value) -> Result<String, String> {
    checked("sourceRef", reference)?;
    Ok(format!(
        "{}/{:016}",
        text(&reference["sourceId"])?,
        reference["sourceVersion"]
            .as_f64()
            .ok_or("CORE2_INVALID_SOURCEREF")? as u64
    ))
}
pub(crate) struct CoreFileTransaction {
    store: LockedStore,
    view: Option<LoadedView>,
    pending: BTreeMap<(String, String), Option<String>>,
    // Request-local, never shared across an OS lock. Pending writes invalidate their own key.
    record_cache: RefCell<VecDeque<((String, String), Option<Value>, usize)>>,
    #[cfg(test)]
    record_reads: std::cell::RefCell<BTreeMap<String, usize>>,
    #[cfg(test)]
    record_decodes: std::cell::Cell<usize>,
}
impl CoreFileTransaction {
    pub fn open(root: &Path) -> Result<Self, String> {
        let store = LockedStore::open(root)?;
        let view = store.load()?;
        // Recovery remains explicit; no request silently replaces the fallback view.
        if let Some(recovered) = view.as_ref().filter(|view| view.recovery.is_some()) {
            return Err(format!(
                "CORE2_RECOVERY_REQUIRES_CONFIRMATION: revision={}; cause={}",
                recovered.manifest.revision,
                recovered.recovery.as_ref().unwrap()
            ));
        }
        Ok(Self {
            store,
            view,
            pending: BTreeMap::new(),
            record_cache: RefCell::new(VecDeque::new()),
            #[cfg(test)]
            record_reads: std::cell::RefCell::new(BTreeMap::new()),
            #[cfg(test)]
            record_decodes: std::cell::Cell::new(0),
        })
    }
    pub fn get(&self, store: &str, key: &str) -> Result<Option<Value>, String> {
        let identity = (store.to_owned(), key.to_owned());
        let cached = self
            .record_cache
            .borrow()
            .iter()
            .find(|(saved, _, _)| saved == &identity)
            .map(|(_, value, _)| value.clone());
        if let Some(value) = cached {
            #[cfg(test)]
            if value.is_some() {
                *self
                    .record_reads
                    .borrow_mut()
                    .entry(store.into())
                    .or_default() += 1;
            }
            return Ok(value);
        }
        let value = match self.pending.get(&(store.into(), key.into())) {
            Some(value) => value.clone(),
            None => match &self.view {
                Some(view) => self.store.get_row(view, store, key)?,
                None => None,
            },
        };
        #[cfg(test)]
        if value.is_some() {
            *self
                .record_reads
                .borrow_mut()
                .entry(store.into())
                .or_default() += 1;
        }
        let bytes = value.as_ref().map_or(0, String::len);
        let parsed = value
            .map(|text| {
                #[cfg(test)]
                self.record_decodes.set(self.record_decodes.get() + 1);
                serde_json::from_str(&text).map_err(|e| format!("CORE2_CORRUPT_RECORD: {e}"))
            })
            .transpose()?;
        // These bounds are encoded byte sizes, not a claim about exact heap usage.
        if bytes <= 256 * 1024 {
            let mut cache = self.record_cache.borrow_mut();
            while !cache.is_empty()
                && (cache.len() >= 128
                    || cache.iter().map(|(_, _, size)| *size).sum::<usize>() + bytes
                        > 2 * 1024 * 1024)
            {
                cache.pop_front();
            }
            cache.push_back((identity, parsed.clone(), bytes));
        }
        Ok(parsed)
    }
    pub fn put(&mut self, store: &str, key: String, value: Value) -> Result<(), String> {
        self.record_cache
            .borrow_mut()
            .retain(|((table, saved), _, _)| table != store || saved != &key);
        self.pending
            .insert((store.into(), key), Some(stable_json(&value)?));
        Ok(())
    }
    pub fn add(&mut self, store: &str, key: String, value: Value) -> Result<(), String> {
        if self.get(store, &key)?.is_some() {
            return Err("CORE2_RECORD_EXISTS".into());
        }
        self.put(store, key, value)
    }
    pub fn delete(&mut self, store: &str, key: String) {
        self.record_cache
            .borrow_mut()
            .retain(|((table, saved), _, _)| table != store || saved != &key);
        self.pending.insert((store.into(), key), None);
    }
    pub fn write_binary(&self, bytes: &[u8]) -> Result<crate::core2_store::BlockRef, String> {
        self.store.write_binary(bytes)
    }
    pub fn read_binary(&self, block: &crate::core2_store::BlockRef) -> Result<Vec<u8>, String> {
        self.store.read_block(block)
    }
    pub fn scan(&self, store: &str, prefix: &str) -> Result<Vec<Value>, String> {
        let mut values = BTreeMap::new();
        if let Some(view) = &self.view {
            let mut after: Option<String> = None;
            loop {
                let rows = self
                    .store
                    .scan_rows(view, store, prefix, after.as_deref(), 200)?;
                if rows.is_empty() {
                    break;
                }
                after = rows.last().map(|row| row.key.clone());
                let count = rows.len();
                for row in rows {
                    values.insert(row.key, row.value_json);
                }
                if count < 200 {
                    break;
                }
            }
        }
        for ((table, key), value) in &self.pending {
            if table == store && key.starts_with(prefix) {
                match value {
                    Some(value) => {
                        values.insert(key.clone(), value.clone());
                    }
                    None => {
                        values.remove(key);
                    }
                }
            }
        }
        #[cfg(test)]
        {
            *self
                .record_reads
                .borrow_mut()
                .entry(store.into())
                .or_default() += values.len();
        }
        values
            .into_values()
            .map(|text| {
                serde_json::from_str(&text).map_err(|e| format!("CORE2_CORRUPT_RECORD: {e}"))
            })
            .collect()
    }
    pub fn branch(&self, scope: &Value) -> Result<Value, String> {
        let branch = self
            .get("branches", &scope_key(scope)?)?
            .ok_or("CORE2_BRANCH_NOT_FOUND")?;
        checked("head", &branch["head"])?;
        if branch["head"]["scope"] != *scope {
            return Err("CORE2_CORRUPT_BRANCH_SCOPE".into());
        }
        Ok(branch)
    }
    #[cfg(test)]
    pub(crate) fn record_read_count(&self, store: &str) -> usize {
        self.record_reads.borrow().get(store).copied().unwrap_or(0)
    }
    #[cfg(test)]
    pub(crate) fn record_decode_count(&self) -> usize {
        self.record_decodes.get()
    }
    pub fn finish(self) -> Result<(), String> {
        self.finish_with_fault(|_| Ok(()))
    }
    pub(crate) fn finish_with_fault(
        self,
        fault: impl Fn(crate::core2_store::FaultPoint) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.store.apply_rows_with_fault(
            self.view.as_ref().map_or(0, |view| view.manifest.revision),
            self.pending
                .into_iter()
                .map(|((store, key), value_json)| RowChange {
                    store,
                    key,
                    value_json,
                })
                .collect(),
            fault,
        )?;
        Ok(())
    }
}

pub(crate) fn initialize(root: &Path, seed: Value) -> Result<Value, String> {
    checked("seed", &seed)?;
    let records = seed["records"].as_array().ok_or("CORE2_INVALID_SEED")?;
    let sources = seed["sources"].as_array().ok_or("CORE2_INVALID_SEED")?;
    let mut record_ids = BTreeSet::new();
    let mut source_ids = BTreeSet::new();
    if seed["head"]["coreSeq"].as_f64() != Some(0.0)
        || seed["head"]["memoryRevision"].as_f64() != Some(0.0)
        || seed["head"].get("parent").is_some()
        || !records
            .iter()
            .any(|record| record["domain"] == "traveler" && record["entityId"] == seed["playerId"])
        || !records.iter().all(|record| {
            record_ids.insert((
                record["domain"].clone().to_string(),
                record["entityId"].clone().to_string(),
            ))
        })
        || !sources
            .iter()
            .all(|source| source_ids.insert(source["ref"].to_string()))
    {
        return Err("CORE2_INVALID_INITIALIZATION".into());
    }
    let scope = &seed["head"]["scope"];
    let key = scope_key(scope)?;
    let mut tx = CoreFileTransaction::open(root)?;
    if tx.get("branches", &key)?.is_some() {
        return Err("CORE2_BRANCH_EXISTS".into());
    }
    tx.add("branches", key.clone(), serde_json::json!({"head":seed["head"],"playerId":seed["playerId"],"contentRefs":seed["contentRefs"],"sourceCount":sources.len()}))?;
    for record in records {
        tx.add("states", format!("{key}/{}/{}", text(&record["domain"])?, text(&record["entityId"])?), serde_json::json!({"scope":scope,"domain":record["domain"],"entityId":record["entityId"],"version":record["version"],"record":record}))?;
    }
    for source in sources {
        crate::core2_sources::write_position(&mut tx, source, serde_json::json!(0))?;
        tx.add(
            "sources",
            source_key(&source["ref"])?,
            serde_json::json!({"record":source,"commitSeq":0}),
        )?;
    }
    crate::core2_snapshots::store_checkpoint(&mut tx, scope)?;
    tx.finish()?;
    Ok(seed["head"].clone())
}
pub(crate) fn read_head(root: &Path, scope: Value) -> Result<Value, String> {
    Ok(CoreFileTransaction::open(root)?.branch(&scope)?["head"].clone())
}
pub(crate) fn read_state(root: &Path, scope: Value) -> Result<Value, String> {
    let tx = CoreFileTransaction::open(root)?;
    state_from_transaction(&tx, &scope)
}
pub(crate) fn state_from_transaction(
    tx: &CoreFileTransaction,
    scope: &Value,
) -> Result<Value, String> {
    let branch = tx.branch(scope)?;
    let mut records = Vec::new();
    let mut tombstones = Vec::new();
    for state in tx.scan("states", &format!("{}/", scope_key(&scope)?))? {
        if state["scope"] != *scope {
            return Err("CORE2_CORRUPT_STATE_SCOPE".into());
        }
        if state["record"].is_null() {
            tombstones.push(serde_json::json!({"domain":state["domain"],"entityId":state["entityId"],"version":state["version"]}));
        } else {
            checked("state", &state["record"])?;
            records.push(state["record"].clone());
        }
    }
    let snapshot = serde_json::json!({"head":branch["head"],"records":records,"contentRefs":branch["contentRefs"],"tombstones":tombstones});
    checked("snapshot", &snapshot)?;
    Ok(snapshot)
}
pub(crate) fn activate_session(
    root: &Path,
    scope: Value,
    session: String,
) -> Result<Value, String> {
    let mut tx = CoreFileTransaction::open(root)?;
    let mut branch = tx.branch(&scope)?;
    branch["head"]["sessionId"] = Value::String(session);
    checked("head", &branch["head"])?;
    let head = branch["head"].clone();
    tx.put("branches", scope_key(&scope)?, branch)?;
    tx.finish()?;
    Ok(head)
}
pub(crate) fn put_source(root: &Path, source: Value) -> Result<Value, String> {
    checked("source", &source)?;
    let mut tx = CoreFileTransaction::open(root)?;
    let reference = put_source_tx(&mut tx, &source)?;
    tx.finish()?;
    Ok(reference)
}
fn put_source_tx(tx: &mut CoreFileTransaction, source: &Value) -> Result<Value, String> {
    if !unique_by(array(&source["blocks"])?, |block| {
        block["blockId"].to_string()
    }) {
        return Err("CORE2_DUPLICATE_BLOCK_ID".into());
    }
    let reference = source["ref"].clone();
    let key = source_key(&reference)?;
    let mut branch = tx.branch(&source["scope"])?;
    if let Some(previous) = tx.get("sources", &key)? {
        if stable_json(&previous["record"])? != stable_json(&source)? {
            return Err("CORE2_SOURCE_IMMUTABLE".into());
        }
        return Ok(reference);
    }
    let version = reference["sourceVersion"]
        .as_f64()
        .ok_or("CORE2_INVALID_SOURCEREF")? as u64;
    if version > 1 {
        let previous_key = source_key(
            &serde_json::json!({"sourceId":reference["sourceId"],"sourceVersion":version - 1}),
        )?;
        let previous = tx
            .get("sources", &previous_key)?
            .ok_or("CORE2_SOURCE_VERSION_CONFLICT")?;
        if previous["record"]["scope"] != source["scope"]
            || previous["record"]["kind"] != source["kind"]
        {
            return Err("CORE2_SOURCE_VERSION_CONFLICT".into());
        }
    }
    tx.add(
        "sources",
        key,
        serde_json::json!({"record":source,"commitSeq":null}),
    )?;
    crate::core2_sources::write_position(tx, source, Value::Null)?;
    branch["sourceCount"] = serde_json::json!(integer(&branch["sourceCount"])? + 1);
    tx.put("branches", scope_key(&source["scope"])?, branch)?;
    Ok(reference)
}
pub(crate) fn append_operation_source(root: &Path, value: Value) -> Result<Value, String> {
    checked("operationSourceAppend", &value)?;
    let source = &value["source"];
    let scope = &value["scope"];
    if source["kind"] != "narrative"
        || source["operationId"] != value["operationId"]
        || integer(&source["ref"]["sourceVersion"])? != 1
        || !unique_by(array(&source["blocks"])?, |block| {
            block["blockId"].to_string()
        })
    {
        return Err("CORE2_INVALID_OPERATION_SOURCE".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    if tx.branch(scope)?["head"]["sessionId"] != value["sessionId"] {
        return Err("CORE2_SESSION_CHANGED".into());
    }
    let mut operation = tx
        .operation(scope, text(&value["operationId"])?)?
        .ok_or("CORE2_OPERATION_NOT_OPEN")?;
    if operation["kind"] != "main"
        || operation["status"] != "draft"
        || operation.get("stage").is_some()
    {
        return Err("CORE2_OPERATION_NOT_OPEN".into());
    }
    for reference in array(&operation["sourceRefs"])? {
        let stored = tx
            .get("sources", &source_key(reference)?)?
            .ok_or("CORE2_OPERATION_SOURCE_MISMATCH")?;
        if stored["record"]["scope"] != *scope
            || stored["record"]["operationId"] != value["operationId"]
        {
            return Err("CORE2_OPERATION_SOURCE_MISMATCH".into());
        }
        if stored["record"]["kind"] == "narrative" {
            if !same(reference, &source["ref"]) || !same(&stored["record"], source) {
                return Err("CORE2_NARRATIVE_ALREADY_FROZEN".into());
            }
            return Ok(operation);
        }
    }
    if let Some(previous) = tx.get("sources", &source_key(&source["ref"])?)? {
        if !same(&previous["record"], source) || !previous["commitSeq"].is_null() {
            return Err("CORE2_SOURCE_IMMUTABLE".into());
        }
    }
    put_source_tx(&mut tx, source)?;
    operation["sourceRefs"]
        .as_array_mut()
        .ok_or("CORE2_CORRUPT_RECORD")?
        .push(source["ref"].clone());
    tx.put(
        "operations",
        format!("{}/{}", scope_key(scope)?, text(&value["operationId"])?),
        operation.clone(),
    )?;
    tx.finish()?;
    Ok(operation)
}
pub(crate) fn read_source(root: &Path, reference: Value) -> Result<Value, String> {
    let tx = CoreFileTransaction::open(root)?;
    match tx.get("sources", &source_key(&reference)?)? {
        Some(source) => {
            checked("source", &source["record"])?;
            if source["record"]["ref"] != reference {
                return Err("CORE2_CORRUPT_SOURCE_REF".into());
            }
            Ok(source["record"].clone())
        }
        None => Ok(Value::Null),
    }
}

pub(crate) fn array(value: &Value) -> Result<&Vec<Value>, String> {
    value
        .as_array()
        .ok_or_else(|| "CORE2_CORRUPT_RECORD".into())
}
pub(crate) fn integer(value: &Value) -> Result<u64, String> {
    value
        .as_f64()
        .filter(|n| {
            n.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(n) && n.fract() == 0.0
        })
        .map(|n| n as u64)
        .ok_or_else(|| "CORE2_INVALID_POSITION".into())
}
pub(crate) fn same(a: &Value, b: &Value) -> bool {
    stable_json(a)
        .ok()
        .zip(stable_json(b).ok())
        .is_some_and(|(a, b)| a == b)
}
pub(crate) fn unique_by(values: &[Value], key: impl Fn(&Value) -> String) -> bool {
    let mut seen = BTreeSet::new();
    values.iter().all(|value| seen.insert(key(value)))
}
pub(crate) fn ref_key(reference: &Value) -> String {
    format!("{}/{}", reference["domain"], reference["entityId"])
}
pub(crate) fn field_ids(values: &Value, field: &str) -> Result<Vec<Value>, String> {
    Ok(array(values)?
        .iter()
        .map(|value| value[field].clone())
        .collect())
}
pub(crate) fn assert_id(value: &str) -> Result<(), String> {
    checked(
        "scope",
        &serde_json::json!({"journeyId":value,"branchId":"id"}),
    )
    .map_err(|_| "CORE2_INVALID_ID".into())
}
pub(crate) struct FrozenScope {
    pub scope: Value,
    pub cutoff: u64,
    pub memory_revision: u64,
}
pub(crate) fn event_key(scope: &Value, sequence: u64, id: &str) -> Result<String, String> {
    if sequence == 0 {
        return Err("CORE2_INVALID_POSITION".into());
    }
    assert_id(id)?;
    Ok(format!(
        "{}/{:016}/{sequence:016}/{id}",
        scope_key(scope)?,
        (sequence - 1) / 50
    ))
}
impl CoreFileTransaction {
    pub(crate) fn event(&self, id: &str) -> Result<Option<Value>, String> {
        assert_id(id)?;
        let Some(pointer) = self.get("eventIds", id)? else {
            return Ok(None);
        };
        let key = text(&pointer["eventKey"])?;
        let event = self
            .get("events", key)?
            .ok_or("CORE2_EVENT_PAYLOAD_MISSING")?;
        checked("event", &event)?;
        let scope =
            serde_json::json!({"journeyId":event["journeyId"],"branchId":event["branchId"]});
        if event["eventId"] != id || key != event_key(&scope, integer(&event["commitSeq"])?, id)? {
            return Err("CORE2_CORRUPT_EVENT_INDEX".into());
        }
        Ok(Some(event))
    }
    pub(crate) fn branch_path(&self, scope: &Value) -> Result<Vec<FrozenScope>, String> {
        let mut current = self.branch(scope)?;
        let mut cutoff = integer(&current["head"]["coreSeq"])?;
        let mut memory_revision = integer(&current["head"]["memoryRevision"])?;
        let mut path = Vec::new();
        let mut seen = BTreeSet::new();
        loop {
            let head = &current["head"];
            if head["scope"]["journeyId"] != scope["journeyId"]
                || !seen.insert(scope_key(&head["scope"])?)
                || cutoff > integer(&head["coreSeq"])?
                || memory_revision > integer(&head["memoryRevision"])?
            {
                return Err("CORE2_BRANCH_LINEAGE_CORRUPT".into());
            }
            path.push(FrozenScope {
                scope: head["scope"].clone(),
                cutoff,
                memory_revision,
            });
            let Some(parent) = head.get("parent") else {
                return Ok(path);
            };
            cutoff = cutoff.min(integer(&head["forkSeq"])?);
            memory_revision = memory_revision.min(integer(&head["forkMemoryRevision"])?);
            current = self.branch(parent)?;
        }
    }
    pub(crate) fn reachable(
        &self,
        scope: &Value,
        record_scope: &Value,
        seq: u64,
    ) -> Result<bool, String> {
        Ok(self
            .branch_path(scope)?
            .iter()
            .any(|bound| same(&bound.scope, record_scope) && seq <= bound.cutoff))
    }
    pub(crate) fn operation(&self, scope: &Value, id: &str) -> Result<Option<Value>, String> {
        assert_id(id)?;
        let path = self.branch_path(scope)?;
        let own = self.get("operations", &format!("{}/{id}", scope_key(scope)?))?;
        if let Some(own) = &own {
            checked("operation", own)?;
            if own["status"] == "committed" {
                return Ok(Some(own.clone()));
            }
        }
        for bound in &path[1..] {
            if let Some(operation) =
                self.get("operations", &format!("{}/{id}", scope_key(&bound.scope)?))?
            {
                checked("operation", &operation)?;
                if operation["status"] == "committed"
                    && operation.get("receipt").is_some()
                    && ["committed", "already_committed"]
                        .contains(&operation["receipt"]["status"].as_str().unwrap_or(""))
                    && integer(&operation["receipt"]["coreSeq"])? <= bound.cutoff
                {
                    return Ok(Some(operation));
                }
            }
        }
        Ok(own)
    }
    pub(crate) fn source_usable(
        &self,
        source: &Value,
        scope: &Value,
        operation_id: &Value,
    ) -> Result<bool, String> {
        checked("source", &source["record"])?;
        if source["commitSeq"].is_null() {
            return Ok(same(&source["record"]["scope"], scope)
                && source["record"]["operationId"] == *operation_id);
        }
        self.reachable(
            scope,
            &source["record"]["scope"],
            integer(&source["commitSeq"])?,
        )
    }
    pub(crate) fn evidence_valid(
        &self,
        evidence: &Value,
        declared: &Value,
        scope: &Value,
        operation_id: &Value,
    ) -> Result<bool, String> {
        for evidence in array(evidence)? {
            if !array(declared)?
                .iter()
                .any(|reference| same(reference, &evidence["ref"]))
            {
                return Ok(false);
            }
            let Some(source) = self.get("sources", &source_key(&evidence["ref"])?)? else {
                return Ok(false);
            };
            if !self.source_usable(&source, scope, operation_id)? {
                return Ok(false);
            }
            let Some(block) = array(&source["record"]["blocks"])?
                .iter()
                .find(|block| block["blockId"] == evidence["blockId"])
            else {
                return Ok(false);
            };
            let units: Vec<u16> = text(&block["text"])?.encode_utf16().collect();
            let start = integer(&evidence["start"])? as usize;
            let end = integer(&evidence["end"])? as usize;
            let quote: Vec<_> = text(&evidence["quote"])?.encode_utf16().collect();
            if start >= end || end > units.len() || units[start..end] != quote {
                return Ok(false);
            }
        }
        Ok(true)
    }
    pub(crate) fn event_reachable(
        &self,
        scope: &Value,
        id: &Value,
        drafts: &Value,
    ) -> Result<bool, String> {
        if array(drafts)?.iter().any(|event| event["eventId"] == *id) {
            return Ok(true);
        }
        let Some(event) = self.event(text(id)?)? else {
            return Ok(false);
        };
        checked("event", &event)?;
        self.reachable(
            scope,
            &serde_json::json!({"journeyId":event["journeyId"],"branchId":event["branchId"]}),
            integer(&event["commitSeq"])?,
        )
    }
    pub(crate) fn latest_version(
        &self,
        store: &str,
        scope: &Value,
        id: &str,
    ) -> Result<u64, String> {
        let mut version = 0;
        for bound in self.branch_path(scope)? {
            for row in self.scan(store, &format!("{}/{id}/", scope_key(&bound.scope)?))? {
                if integer(&row["commitSeq"])? <= bound.cutoff
                    && (store != "memories"
                        || integer(&row["publishedRevision"])? <= bound.memory_revision)
                {
                    version = version.max(integer(&row["record"]["version"])?);
                }
            }
        }
        Ok(version)
    }
}

pub(crate) fn prepare_operation(root: &Path, mut operation: Value) -> Result<(), String> {
    checked("operation", &operation)?;
    if !["draft", "prepared", "failed"].contains(&operation["status"].as_str().unwrap_or(""))
        || operation.get("receipt").is_some()
        || operation.get("stage").is_some()
        || !unique_by(array(&operation["readSet"])?, ref_key)
        || !unique_by(array(&operation["sourceRefs"])?, |reference| {
            stable_json(reference).unwrap_or_default()
        })
        || !unique_by(array(&operation["effects"])?, Value::to_string)
    {
        return Err("CORE2_INVALID_PREPARATION".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    let scope = operation["scope"].clone();
    tx.branch(&scope)?;
    if let Some(previous) = tx.operation(&scope, text(&operation["operationId"])?)? {
        if ["cancelled", "committed"].contains(&previous["status"].as_str().unwrap_or("")) {
            return Err("CORE2_OPERATION_TERMINAL".into());
        }
        let sealing = (previous["status"] == "draft"
            || (previous["status"] == "failed" && array(&previous["effects"])?.is_empty()))
            && operation["status"] == "prepared";
        let binding_changed = if sealing {
            previous.get("stage").is_none()
                || array(&operation["readSet"])?.iter().any(|reference| {
                    match previous["readSet"].as_array().and_then(|reads| {
                        reads
                            .iter()
                            .find(|captured| ref_key(captured) == ref_key(reference))
                    }) {
                        Some(captured) => captured["version"] != reference["version"],
                        None => integer(&reference["version"]).ok() != Some(0),
                    }
                })
        } else {
            (previous["status"] == "prepared" && operation["status"] == "draft")
                || ["readSet", "effects"]
                    .iter()
                    .any(|key| !same(&previous[*key], &operation[*key]))
        };
        if previous["kind"] != operation["kind"]
            || !same(&previous["sourceRefs"], &operation["sourceRefs"])
            || binding_changed
            || integer(&operation["attempts"])? < integer(&previous["attempts"])?
        {
            return Err("CORE2_OPERATION_VERSION_CONFLICT".into());
        }
        if let Some(stage) = previous.get("stage") {
            operation["stage"] = stage.clone();
        }
    }
    for reference in array(&operation["sourceRefs"])? {
        let source = tx
            .get("sources", &source_key(reference)?)?
            .ok_or("CORE2_SOURCE_NOT_REACHABLE")?;
        if !tx.source_usable(&source, &scope, &operation["operationId"])? {
            return Err("CORE2_SOURCE_NOT_REACHABLE".into());
        }
    }
    tx.put(
        "operations",
        format!(
            "{}/{}",
            scope_key(&scope)?,
            text(&operation["operationId"])?
        ),
        operation,
    )?;
    tx.finish()
}
pub(crate) fn stage_operation(root: &Path, stage: Value) -> Result<(), String> {
    checked("stage", &stage)?;
    let scope = &stage["scope"];
    let mut tx = CoreFileTransaction::open(root)?;
    let branch = tx.branch(scope)?;
    if branch["head"]["sessionId"] != stage["sessionId"] {
        return Err("CORE2_SESSION_CHANGED".into());
    }
    let key = format!("{}/{}", scope_key(scope)?, text(&stage["operationId"])?);
    let mut operation = tx
        .get("operations", &key)?
        .ok_or("CORE2_OPERATION_NOT_PREPARED")?;
    checked("operation", &operation)?;
    if ["cancelled", "committed"].contains(&operation["status"].as_str().unwrap_or("")) {
        return Err("CORE2_OPERATION_TERMINAL".into());
    }
    if !same(&operation["sourceRefs"], &stage["sourceRefs"])
        || !unique_by(array(&stage["candidates"])?, |candidate| {
            candidate["candidateId"].to_string()
        })
        || !unique_by(array(&stage["review"])?, |review| {
            review["candidateId"].to_string()
        })
        || array(&stage["candidates"])?
            .iter()
            .any(|candidate| candidate["operationId"] != stage["operationId"])
        || array(&stage["review"])?.iter().any(|review| {
            !array(&stage["candidates"])
                .unwrap()
                .iter()
                .any(|candidate| candidate["candidateId"] == review["candidateId"])
        })
    {
        return Err("CORE2_STAGE_IDENTITY_MISMATCH".into());
    }
    if let Some(previous) = operation.get("stage") {
        if integer(&stage["stageVersion"])? < integer(&previous["stageVersion"])?
            || (integer(&stage["stageVersion"])? == integer(&previous["stageVersion"])?
                && !same(&stage, previous))
        {
            return Err("CORE2_STAGE_VERSION_CONFLICT".into());
        }
    }
    for candidate in array(&stage["candidates"])? {
        if !tx.evidence_valid(
            &candidate["evidenceRefs"],
            &stage["sourceRefs"],
            scope,
            &stage["operationId"],
        )? {
            return Err("CORE2_INVALID_EVIDENCE".into());
        }
    }
    operation["stage"] = stage;
    tx.put("operations", key, operation)?;
    tx.finish()
}
pub(crate) fn cancel_operation(root: &Path, scope: Value, id: String) -> Result<(), String> {
    assert_id(&id)?;
    let mut tx = CoreFileTransaction::open(root)?;
    tx.branch(&scope)?;
    let key = format!("{}/{id}", scope_key(&scope)?);
    let operation = tx.operation(&scope, &id)?;
    if operation
        .as_ref()
        .is_some_and(|operation| operation["status"] == "committed")
    {
        // Cancelling background work cannot undo an already committed world event.
        for mut stored in tx.scan("jobs", &format!("{}/", scope_key(&scope)?))? {
            let job = &stored["record"];
            checked("job", job)?;
            if job["operationId"] == id
                && !["completed", "cancelled"].contains(&job["status"].as_str().unwrap())
            {
                let job_key = format!("{}/{}", scope_key(&scope)?, text(&job["jobId"])?);
                let version = integer(&job["version"])?;
                stored["record"]["status"] = serde_json::json!("cancelled");
                stored["record"]["leaseId"] = Value::Null;
                stored["record"]["version"] = serde_json::json!(version + 1);
                checked("job", &stored["record"])?;
                tx.put("jobs", job_key, stored)?;
            }
        }
    } else {
        let mut operation = operation.unwrap_or_else(|| serde_json::json!({"scope":scope,"operationId":id,"kind":"system","status":"cancelled","sourceRefs":[],"readSet":[],"candidateRefs":[],"effects":[],"attempts":0}));
        operation["status"] = serde_json::json!("cancelled");
        checked("operation", &operation)?;
        tx.put("operations", key, operation)?;
    }
    tx.finish()
}

pub(crate) fn read_operation(
    root: &Path,
    scope: Value,
    operation_id: String,
) -> Result<Value, String> {
    Ok(CoreFileTransaction::open(root)?
        .operation(&scope, &operation_id)?
        .unwrap_or(Value::Null))
}

pub(crate) use crate::core2_commit::commit;
#[cfg(test)]
pub(crate) use crate::core2_commit::commit_with_fault;

#[cfg(test)]
pub(crate) fn read_event(root: &Path, id: String) -> Result<Value, String> {
    Ok(CoreFileTransaction::open(root)?
        .event(&id)?
        .unwrap_or(Value::Null))
}

pub(crate) use crate::core2_jobs::{cancel_job, claim_job, enqueue_job, finish_job};
#[cfg(test)]
pub(crate) use crate::core2_memories::publish_derived_with_fault;
pub(crate) use crate::core2_memories::{publish_derived, save_job_step};
pub(crate) use crate::core2_queries::query_records;
