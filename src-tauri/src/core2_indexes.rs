//! Derived posting cache. It never establishes game facts or NPC visibility.
use crate::core2_json::stable_json;
use crate::core2_repository::{checked, integer, same, scope_key, text, CoreFileTransaction};
use serde_json::{json, Value};
use std::{collections::BTreeSet, path::Path};

fn status(tx: &CoreFileTransaction, scope: &Value) -> Result<Value, String> {
    let head = tx.branch(scope)?["head"].clone();
    let Some(mut saved) = tx.get("indexMeta", &scope_key(scope)?)? else {
        return Ok(
            json!({"scope":scope,"coreSeq":0,"memoryRevision":0,"indexVersion":0,"status":"missing"}),
        );
    };
    checked("indexStatus", &saved)?;
    if !same(&saved["scope"], scope)
        || integer(&saved["coreSeq"])? > integer(&head["coreSeq"])?
        || integer(&saved["memoryRevision"])? > integer(&head["memoryRevision"])?
        || integer(&saved["indexVersion"])? == 0
    {
        return Err("CORE2_INDEX_CORRUPT".into());
    }
    saved["status"] = json!(if saved["coreSeq"].as_f64() == head["coreSeq"].as_f64()
        && saved["memoryRevision"].as_f64() == head["memoryRevision"].as_f64()
    {
        "ready"
    } else {
        "lagging"
    });
    Ok(saved)
}
pub(crate) fn read_status(root: &Path, scope: Value) -> Result<Value, String> {
    status(&CoreFileTransaction::open(root)?, &scope)
}
pub(crate) fn publish_index(root: &Path, patch: Value) -> Result<Value, String> {
    checked("indexPatch", &patch)?;
    let mut tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(&patch["scope"])?["head"].clone();
    let previous = status(&tx, &patch["scope"])?;
    let reject = |status: &str, reason: &str| json!({"status":status,"reason":reason,"indexVersion":previous["indexVersion"]});
    if head["sessionId"] != patch["sessionId"] {
        return Ok(reject("cancelled", "session_changed"));
    }
    if previous["indexVersion"].as_f64() != patch["expectedIndexVersion"].as_f64() {
        return Ok(reject("conflict", "index_version_changed"));
    }
    let cutoff = integer(&patch["cutoffSeq"])?;
    let revision = integer(&patch["memoryRevision"])?;
    if cutoff > integer(&head["coreSeq"])? || revision > integer(&head["memoryRevision"])? {
        return Ok(reject("conflict", "future_index_position"));
    }
    if cutoff < integer(&previous["coreSeq"])? || revision < integer(&previous["memoryRevision"])? {
        return Ok(reject("conflict", "index_position_regressed"));
    }
    let mut seen = BTreeSet::new();
    let path = tx.branch_path(&patch["scope"])?;
    for posting in patch["postings"].as_array().unwrap() {
        let identity = stable_json(&json!([
            posting["kind"],
            posting["key"],
            posting["target"],
            posting["targetId"]
        ]))?;
        if !seen.insert(identity) {
            return Ok(reject("conflict", "duplicate_index_posting"));
        }
        let valid = if posting["target"] == "event" {
            match tx.event(text(&posting["targetId"])?)? {
                None => false,
                Some(event) => {
                    integer(&posting["memoryRevision"])? == 0
                        && posting["commitSeq"].as_f64() == event["commitSeq"].as_f64()
                        && path.iter().any(|bound| {
                            bound.scope["journeyId"] == event["journeyId"]
                                && bound.scope["branchId"] == event["branchId"]
                                && integer(&event["commitSeq"]).unwrap() <= bound.cutoff.min(cutoff)
                        })
                }
            }
        } else {
            tx.latest_memory_at(
                &patch["scope"],
                text(&posting["targetId"])?,
                cutoff,
                revision,
            )?
            .is_some_and(|row| {
                row["commitSeq"].as_f64() == posting["commitSeq"].as_f64()
                    && row["publishedRevision"].as_f64() == posting["memoryRevision"].as_f64()
            })
        };
        if !valid {
            return Ok(reject("conflict", "invalid_index_target"));
        }
    }
    let key = scope_key(&patch["scope"])?;
    if patch.get("replacedTargets").is_some()
        && patch.get("mode").is_none_or(|mode| mode != "merge")
    {
        return Ok(reject("conflict", "invalid_index_merge"));
    }
    let mut targets = BTreeSet::new();
    for row in patch
        .get("replacedTargets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(patch["postings"].as_array().unwrap())
    {
        targets.insert(stable_json(&json!([row["target"], row["targetId"]]))?);
    }
    let old = tx.scan("postings", &format!("{key}/"))?;
    for row in old {
        if patch["mode"] != "merge"
            || targets.contains(&stable_json(&json!([
                row["record"]["target"],
                row["record"]["targetId"]
            ]))?)
        {
            tx.delete("postings", text(&row["storageKey"])?.into());
        }
    }
    let publication = crate::core2_store::nonce()?;
    for (index, posting) in patch["postings"].as_array().unwrap().iter().enumerate() {
        let posting_key = format!("{key}/{publication}-{index:016}");
        tx.put(
            "postings",
            posting_key.clone(),
            json!({"storageKey":posting_key,"record":posting}),
        )?;
    }
    let version = integer(&previous["indexVersion"])? + 1;
    let mut metadata = json!({"scope":patch["scope"],"coreSeq":cutoff,"memoryRevision":revision,"indexVersion":version,"status":"ready"});
    if let Some(content_version) = patch.get("contentVersion") {
        metadata["contentVersion"] = content_version.clone();
    }
    tx.put("indexMeta", key, metadata)?;
    tx.finish()?;
    Ok(json!({"status":"published","indexVersion":version}))
}
pub(crate) fn query_postings(root: &Path, query: Value) -> Result<Value, String> {
    checked("postingQuery", &query)?;
    let tx = CoreFileTransaction::open(root)?;
    let saved = status(&tx, &query["scope"])?;
    if saved["status"] != "ready"
        || saved["coreSeq"].as_f64() != query["cutoffSeq"].as_f64()
        || saved["memoryRevision"].as_f64() != query["memoryRevision"].as_f64()
    {
        return Err("CORE2_INDEX_POSITION_MISMATCH".into());
    }
    let mut items = Vec::new();
    for row in tx.scan("postings", &format!("{}/", scope_key(&query["scope"])?))? {
        let record = row["record"].clone();
        checked("indexPosting", &record)?;
        if !same(&record["scope"], &query["scope"]) {
            return Err("CORE2_INDEX_CORRUPT".into());
        }
        if query.get("kind").is_none_or(|kind| *kind == record["kind"])
            && query
                .get("keys")
                .is_none_or(|keys| keys.as_array().unwrap().contains(&record["key"]))
            && query
                .get("target")
                .is_none_or(|target| *target == record["target"])
        {
            items.push(record);
        }
    }
    let identity = |row: &Value| {
        stable_json(&json!([
            row["kind"],
            row["key"],
            row["target"],
            row["targetId"]
        ]))
        .unwrap()
    };
    items.sort_by(|a, b| identity(a).encode_utf16().cmp(identity(b).encode_utf16()));
    let mut descriptor = query.clone();
    descriptor.as_object_mut().unwrap().remove("cursor");
    let prefix = format!("core2-page/{}/", stable_json(&descriptor)?);
    let offset = if let Some(cursor) = query
        .get("cursor")
        .and_then(Value::as_str)
        .filter(|cursor| !cursor.is_empty())
    {
        let previous = cursor
            .strip_prefix(&prefix)
            .ok_or("CORE2_CURSOR_MISMATCH")?;
        items
            .iter()
            .position(|item| identity(item) == previous)
            .map(|index| index + 1)
            .ok_or("CORE2_CURSOR_STALE")?
    } else {
        0
    };
    let end = (offset + query.get("limit").map(integer).transpose()?.unwrap_or(50) as usize)
        .min(items.len());
    let mut result = json!({"items":items[offset..end]});
    if end < items.len() {
        let cursor = format!("{prefix}{}", identity(&items[end - 1]));
        if cursor.encode_utf16().count() > 1000 {
            return Err("CORE2_CURSOR_TOO_LARGE".into());
        }
        result["nextCursor"] = json!(cursor);
    }
    Ok(result)
}
