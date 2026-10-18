//! Atomic file publication of an already validated, closed import graph.
use crate::core2_assets::checked_asset;
use crate::core2_import_validation::{ensure, entity, event_scope, rows, scoped, validate_import};
use crate::core2_repository::{
    event_key, integer, scope_key, source_key, text, CoreFileTransaction,
};
use serde_json::{json, Value};
use std::path::Path;

pub(crate) fn import_prepared(root: &Path, value: Value) -> Result<Value, String> {
    import_prepared_with_fault(root, value, |_| Ok(()))
}
pub(crate) fn import_prepared_with_fault(
    root: &Path,
    value: Value,
    fault: impl Fn(crate::core2_store::FaultPoint) -> Result<(), String>,
) -> Result<Value, String> {
    let head = validate_import(&value)?;
    let mut tx = CoreFileTransaction::open(root)?;
    let journey = &value["manifest"]["scope"]["journeyId"];
    ensure(
        !tx.scan("branches", &format!("{}/", text(journey)?))?
            .iter()
            .any(|branch| branch["head"]["scope"]["journeyId"] == *journey),
        "CORE2_JOURNEY_EXISTS",
    )?;
    for branch in rows(&value, "branches") {
        let scope = &branch["state"]["head"]["scope"];
        let base = scope_key(scope)?;
        for record in rows(&branch["state"], "records") {
            tx.add("states",format!("{base}/{}",entity(record)?),json!({"scope":scope,"domain":record["domain"],"entityId":record["entityId"],"version":record["version"],"record":record}))?;
        }
        if let Some(refs) = branch["state"].get("tombstones") {
            for reference in refs.as_array().unwrap() {
                tx.add("states",format!("{base}/{}",entity(reference)?),json!({"scope":scope,"domain":reference["domain"],"entityId":reference["entityId"],"version":reference["version"],"record":null}))?;
            }
        }
        let mut stored = json!({"head":branch["state"]["head"],"playerId":branch["playerId"],"contentRefs":branch["state"]["contentRefs"]});
        stored["sourceCount"] = json!(rows(&value, "sources")
            .iter()
            .filter(|source| crate::core2_repository::same(&source["record"]["scope"], scope))
            .count());
        if let Some(id) = branch.get("originSnapshotId") {
            stored["originSnapshotId"] = id.clone();
        }
        let checkpoint = rows(&value, "snapshots")
            .iter()
            .filter(|snapshot| {
                crate::core2_repository::same(&snapshot["scope"], scope)
                    && snapshot["coreSeq"].as_f64() <= branch["state"]["head"]["coreSeq"].as_f64()
                    && snapshot["memoryRevision"].as_f64()
                        <= branch["state"]["head"]["memoryRevision"].as_f64()
            })
            .max_by(|a, b| {
                a["coreSeq"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b["coreSeq"].as_f64().unwrap())
                    .then_with(|| {
                        a["memoryRevision"]
                            .as_f64()
                            .unwrap()
                            .total_cmp(&b["memoryRevision"].as_f64().unwrap())
                    })
            })
            .ok_or("CORE2_IMPORT_BASELINE")?;
        stored["checkpointId"] = checkpoint["snapshotId"].clone();
        tx.add("branches", base, stored)?;
    }
    for source in rows(&value, "sources") {
        crate::core2_sources::write_position(
            &mut tx,
            &source["record"],
            source["commitSeq"].clone(),
        )?;
        tx.add(
            "sources",
            source_key(&source["record"]["ref"])?,
            source.clone(),
        )?;
    }
    for operation in rows(&value, "operations") {
        tx.add(
            "operations",
            scoped(&operation["scope"], &operation["operationId"])?,
            operation.clone(),
        )?;
    }
    for event in rows(&value, "events") {
        let scope = event_scope(event);
        let key = event_key(
            &scope,
            integer(&event["commitSeq"])?,
            text(&event["eventId"])?,
        )?;
        tx.add("events", key.clone(), event.clone())?;
        tx.add(
            "eventIds",
            text(&event["eventId"])?.into(),
            json!({"eventKey":key}),
        )?;
        for change in rows(event, "committedChanges") {
            tx.add("effects",scoped(&scope,&change["effectKey"])?,json!({"scope":scope,"effectKey":change["effectKey"],"operationId":event["operationId"],"commitSeq":event["commitSeq"]}))?;
        }
    }
    for (table, id) in [
        ("memories", "memoryId"),
        ("knowledge", "knowledgeId"),
        ("commitments", "commitmentId"),
        ("jobs", "jobId"),
    ] {
        for row in rows(&value, table) {
            let scope = &row["record"]["scope"];
            let mut key = scoped(scope, &row["record"][id])?;
            if table != "jobs" {
                key = format!("{key}/{:016}", integer(&row["record"]["version"])?);
            }
            let mut stored = row.clone();
            if table == "jobs" {
                stored["record"]
                    .as_object_mut()
                    .unwrap()
                    .remove("publicationReceipt");
            }
            stored["scope"] = scope.clone();
            tx.add(table, key, stored)?;
        }
    }
    for asset in rows(&value, "assets") {
        let bytes = checked_asset(asset)?;
        let block = tx.write_binary(&bytes)?;
        let mut metadata = asset.clone();
        metadata.as_object_mut().unwrap().remove("bytesBase64");
        tx.add(
            "assets",
            text(&asset["assetId"])?.into(),
            json!({"asset":metadata,"block":block}),
        )?;
    }
    for (table, id) in [("snapshots", "snapshotId"), ("slots", "slotId")] {
        for row in rows(&value, table) {
            tx.add(table, text(&row[id])?.into(), row.clone())?;
        }
    }
    tx.finish_with_fault(fault)?;
    Ok(head)
}
