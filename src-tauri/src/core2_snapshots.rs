//! Immutable snapshots and slot references. No caller-controlled filesystem paths.
use crate::core2_json::stable_json;
use crate::core2_repository::{
    assert_id, checked, integer, same, scope_key, state_from_transaction, text, CoreFileTransaction,
};
use crate::core2_store::checksum_bytes;
use serde_json::{json, Value};
use std::path::Path;

pub(crate) fn store_checkpoint(
    tx: &mut CoreFileTransaction,
    scope: &Value,
) -> Result<String, String> {
    let state = state_from_transaction(tx, scope)?;
    let id = format!("snapshot-{}", crate::core2_store::nonce()?);
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "CORE2_STORAGE_CLOCK_INVALID")?
        .as_millis() as u64;
    let snapshot = json!({"snapshotId":id,"scope":scope,"coreSeq":state["head"]["coreSeq"],"memoryRevision":state["head"]["memoryRevision"],"createdAt":created,"checksum":checksum_bytes(stable_json(&state)?.as_bytes()),"state":state});
    checked_snapshot(&snapshot)?;
    tx.add("snapshots", id.clone(), snapshot)?;
    let mut branch = tx.branch(scope)?;
    branch["checkpointId"] = json!(id);
    tx.put("branches", scope_key(scope)?, branch)?;
    Ok(id)
}
pub(crate) fn read_recovery_checkpoint(root: &Path, scope: Value) -> Result<Value, String> {
    let tx = CoreFileTransaction::open(root)?;
    let branch = tx.branch(&scope)?;
    let id = branch
        .get("checkpointId")
        .and_then(Value::as_str)
        .ok_or("CORE2_CHECKPOINT_NOT_FOUND")?;
    let snapshot = tx
        .get("snapshots", id)?
        .ok_or("CORE2_CHECKPOINT_NOT_FOUND")?;
    checked_snapshot(&snapshot)?;
    if !same(&snapshot["scope"], &scope)
        || integer(&snapshot["coreSeq"])? > integer(&branch["head"]["coreSeq"])?
        || integer(&snapshot["memoryRevision"])? > integer(&branch["head"]["memoryRevision"])?
    {
        return Err("CORE2_CHECKPOINT_POSITION_MISMATCH".into());
    }
    Ok(snapshot)
}

pub(crate) fn checked_snapshot(snapshot: &Value) -> Result<(), String> {
    checked("snapshotRecord", snapshot)?;
    if snapshot["checksum"] != checksum_bytes(stable_json(&snapshot["state"])?.as_bytes()) {
        return Err("CORE2_SNAPSHOT_CHECKSUM_MISMATCH".into());
    }
    let mut identities = std::collections::BTreeSet::new();
    for record in snapshot["state"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .chain(
            snapshot["state"]
                .get("tombstones")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        )
    {
        if !identities.insert((text(&record["domain"])?, text(&record["entityId"])?)) {
            return Err("CORE2_INVALID_SNAPSHOT_RECORDS".into());
        }
    }
    Ok(())
}
pub(crate) fn publish_snapshot(root: &Path, snapshot: Value, slot: Value) -> Result<(), String> {
    checked_snapshot(&snapshot)?;
    checked("saveSlot", &slot)?;
    if slot["journeyId"] != snapshot["scope"]["journeyId"]
        || slot["snapshotId"] != snapshot["snapshotId"]
    {
        return Err("CORE2_SLOT_IDENTITY_MISMATCH".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    let existing = tx.get("snapshots", text(&snapshot["snapshotId"])?)?;
    if existing
        .as_ref()
        .is_some_and(|existing| !same(existing, &snapshot))
    {
        return Err("CORE2_SNAPSHOT_IMMUTABLE".into());
    }
    let previous_slot = tx.get("slots", text(&slot["slotId"])?)?;
    if previous_slot.as_ref().is_some_and(|previous| {
        previous["journeyId"] != slot["journeyId"] || previous["kind"] != slot["kind"]
    }) {
        return Err("CORE2_SLOT_IDENTITY_MISMATCH".into());
    }
    if existing.is_some()
        && previous_slot
            .as_ref()
            .is_some_and(|previous| same(previous, &slot))
    {
        return Ok(());
    }
    let branch = tx.branch(&snapshot["scope"])?;
    if branch["head"]["sessionId"] != snapshot["state"]["head"]["sessionId"] {
        return Err("CORE2_SESSION_CHANGED".into());
    }
    if branch["head"]["coreSeq"].as_f64() != snapshot["coreSeq"].as_f64()
        || branch["head"]["memoryRevision"].as_f64() != snapshot["memoryRevision"].as_f64()
    {
        return Err("CORE2_SNAPSHOT_HEAD_CHANGED".into());
    }
    if !same(
        &snapshot["state"],
        &state_from_transaction(&tx, &snapshot["scope"])?,
    ) {
        return Err("CORE2_SNAPSHOT_STATE_MISMATCH".into());
    }
    if existing.is_none() {
        tx.add(
            "snapshots",
            text(&snapshot["snapshotId"])?.into(),
            snapshot.clone(),
        )?;
    }
    tx.put("slots", text(&slot["slotId"])?.into(), slot)?;
    let mut branch = branch;
    branch["checkpointId"] = snapshot["snapshotId"].clone();
    tx.put("branches", scope_key(&snapshot["scope"])?, branch)?;
    tx.finish()
}
pub(crate) fn read_snapshot(root: &Path, id: String) -> Result<Value, String> {
    assert_id(&id)?;
    let snapshot = CoreFileTransaction::open(root)?.get("snapshots", &id)?;
    if let Some(snapshot) = &snapshot {
        checked_snapshot(snapshot)?;
    }
    Ok(snapshot.unwrap_or(Value::Null))
}
pub(crate) fn list_slots(root: &Path, journey: String) -> Result<Value, String> {
    assert_id(&journey)?;
    let mut slots = Vec::new();
    for slot in CoreFileTransaction::open(root)?.scan("slots", "")? {
        checked("saveSlot", &slot)?;
        if slot["journeyId"] == journey {
            slots.push(slot);
        }
    }
    slots.sort_by(|a, b| {
        b["updatedAt"]
            .as_f64()
            .unwrap()
            .total_cmp(&a["updatedAt"].as_f64().unwrap())
            .then_with(|| {
                a["slotId"]
                    .as_str()
                    .unwrap()
                    .cmp(b["slotId"].as_str().unwrap())
            })
    });
    Ok(json!(slots))
}
pub(crate) fn fork(root: &Path, request: Value) -> Result<Value, String> {
    checked("fork", &request)?;
    let scope =
        json!({"journeyId":request["parentScope"]["journeyId"],"branchId":request["branchId"]});
    if same(&scope, &request["parentScope"]) {
        return Err("CORE2_FORK_SAME_BRANCH".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    let snapshot = tx
        .get("snapshots", text(&request["snapshotId"])?)?
        .ok_or("CORE2_SNAPSHOT_NOT_FOUND")?;
    checked_snapshot(&snapshot)?;
    if !same(&snapshot["scope"], &request["parentScope"]) {
        return Err("CORE2_FORK_PARENT_MISMATCH".into());
    }
    let parent = tx.branch(&request["parentScope"])?;
    if integer(&snapshot["coreSeq"])? > integer(&parent["head"]["coreSeq"])?
        || integer(&snapshot["memoryRevision"])? > integer(&parent["head"]["memoryRevision"])?
    {
        return Err("CORE2_FORK_FUTURE_SNAPSHOT".into());
    }
    let key = scope_key(&scope)?;
    if let Some(existing) = tx.get("branches", &key)? {
        if existing["originSnapshotId"] != request["snapshotId"]
            || !same(&existing["head"]["parent"], &request["parentScope"])
        {
            return Err("CORE2_BRANCH_EXISTS".into());
        }
        checked("head", &existing["head"])?;
        return Ok(existing["head"].clone());
    }
    let head = json!({"scope":scope,"coreSeq":snapshot["coreSeq"],"memoryRevision":snapshot["memoryRevision"],"sessionId":request["sessionId"],"parent":request["parentScope"],"forkSeq":snapshot["coreSeq"],"forkMemoryRevision":snapshot["memoryRevision"]});
    checked("head", &head)?;
    tx.add("branches", key.clone(), json!({"head":head,"playerId":parent["playerId"],"contentRefs":snapshot["state"]["contentRefs"],"sourceCount":0,"originSnapshotId":request["snapshotId"]}))?;
    for record in snapshot["state"]["records"].as_array().unwrap() {
        let mut record = record.clone();
        record["scope"] = scope.clone();
        checked("state", &record)?;
        tx.add("states", format!("{key}/{}/{}", text(&record["domain"])?, text(&record["entityId"])?), json!({"scope":scope,"domain":record["domain"],"entityId":record["entityId"],"version":record["version"],"record":record}))?;
    }
    if let Some(tombstones) = snapshot["state"].get("tombstones") {
        for record in tombstones.as_array().unwrap() {
            tx.add("states", format!("{key}/{}/{}", text(&record["domain"])?, text(&record["entityId"])?), json!({"scope":scope,"domain":record["domain"],"entityId":record["entityId"],"version":record["version"],"record":null}))?;
        }
    }
    store_checkpoint(&mut tx, &scope)?;
    tx.finish()?;
    Ok(head)
}
