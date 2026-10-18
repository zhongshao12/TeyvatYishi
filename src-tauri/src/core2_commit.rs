use crate::core2_json::stable_json;
use crate::core2_repository::{
    array, checked, event_key, field_ids, integer, ref_key, same, scope_key, source_key, text,
    unique_by, CoreFileTransaction,
};
use serde_json::Value;
use std::path::Path;

fn shape_conflict(batch: &Value) -> Result<Option<&'static str>, String> {
    for (field, identity) in [
        ("events", "eventId"),
        ("knowledge", "knowledgeId"),
        ("commitments", "commitmentId"),
        ("jobs", "jobId"),
    ] {
        if !unique_by(array(&batch[field])?, |value| value[identity].to_string()) {
            return Ok(Some("duplicate_identity"));
        }
    }
    if !unique_by(array(&batch["readSet"])?, ref_key)
        || !unique_by(array(&batch["sourceRefs"])?, |reference| {
            stable_json(reference).unwrap_or_default()
        })
        || !unique_by(array(&batch["changes"])?, |change| ref_key(&change["ref"]))
        || !unique_by(array(&batch["changes"])?, |change| {
            change["effectKey"].to_string()
        })
    {
        return Ok(Some("duplicate_identity"));
    }
    for change in array(&batch["changes"])? {
        if !array(&batch["readSet"])?
            .iter()
            .any(|reference| same(reference, &change["ref"]))
        {
            return Ok(Some("write_not_in_read_set"));
        }
        for field in ["before", "after"] {
            let record = &change[field];
            if !record.is_null()
                && (!same(&record["scope"], &batch["scope"])
                    || ref_key(record) != ref_key(&change["ref"]))
            {
                return Ok(Some("change_identity_mismatch"));
            }
        }
        if !change["before"].is_null()
            && integer(&change["before"]["version"])? != integer(&change["ref"]["version"])?
        {
            return Ok(Some("before_version_mismatch"));
        }
        if !change["after"].is_null()
            && integer(&change["after"]["version"])? != integer(&change["ref"]["version"])? + 1
        {
            return Ok(Some("after_version_mismatch"));
        }
    }
    let event_changes: Vec<Value> = array(&batch["events"])?
        .iter()
        .flat_map(|event| {
            event["committedChanges"]
                .as_array()
                .into_iter()
                .flatten()
                .cloned()
        })
        .collect();
    if event_changes.len() != array(&batch["changes"])?.len()
        || !unique_by(&event_changes, |change| change["effectKey"].to_string())
        || array(&batch["changes"])?.iter().any(|change| {
            !event_changes
                .iter()
                .any(|attributed| same(change, attributed))
        })
    {
        return Ok(Some("event_change_mismatch"));
    }
    if array(&batch["events"])?.iter().any(|event| {
        event["operationId"] != batch["operationId"]
            || event["journeyId"] != batch["scope"]["journeyId"]
            || event["branchId"] != batch["scope"]["branchId"]
    }) {
        return Ok(Some("event_identity_mismatch"));
    }
    if array(&batch["jobs"])?.iter().any(|job| {
        job.get("publicationReceipt").is_some()
            || job.get("retryOfJobId").is_some()
            || job.get("retriedByJobId").is_some()
            || job["operationId"] != batch["operationId"]
            || job["sessionId"] != batch["sessionId"]
            || job["status"] != "pending"
            || !job["leaseId"].is_null()
            || job["version"].as_f64() != Some(1.0)
            || !job["steps"].as_array().is_some_and(Vec::is_empty)
    }) {
        return Ok(Some("job_identity_mismatch"));
    }
    Ok(None)
}
pub(crate) fn commit(root: &Path, batch: Value) -> Result<Value, String> {
    commit_with_fault(root, batch, |_| Ok(()))
}
pub(crate) fn commit_with_fault(
    root: &Path,
    batch: Value,
    fault: impl Fn(crate::core2_store::FaultPoint) -> Result<(), String>,
) -> Result<Value, String> {
    checked("commit", &batch)?;
    let scope = &batch["scope"];
    let mut tx = CoreFileTransaction::open(root)?;
    let mut branch = tx.branch(scope)?;
    let operation = tx.operation(scope, text(&batch["operationId"])?)?;
    if let Some(operation) = &operation {
        if operation["status"] == "committed"
            && ["committed", "already_committed"]
                .contains(&operation["receipt"]["status"].as_str().unwrap_or(""))
        {
            let mut receipt = operation["receipt"].clone();
            receipt["status"] = Value::String("already_committed".into());
            receipt["scope"] = scope.clone();
            return Ok(receipt);
        }
    }
    let rejected = |status: &str, reason: &str| serde_json::json!({"status":status,"scope":scope,"operationId":batch["operationId"],"coreSeq":branch["head"]["coreSeq"],"eventIds":[],"jobIds":[],"reason":reason});
    if branch["head"]["sessionId"] != batch["sessionId"]
        || operation
            .as_ref()
            .is_some_and(|op| op["status"] == "cancelled")
    {
        return Ok(rejected("cancelled", "session_changed_or_cancelled"));
    }
    if let Some(guard) = batch.get("jobGuard") {
        let key = format!("{}/{}", scope_key(scope)?, text(&guard["jobId"])?);
        let stored = tx.get("jobs", &key)?;
        if stored
            .as_ref()
            .is_some_and(|row| row["record"]["status"] == "cancelled")
        {
            return Ok(rejected("cancelled", "job_cancelled"));
        }
        let valid = stored.as_ref().is_some_and(|row| {
            let job = &row["record"];
            job["status"] == "running"
                && job["leaseId"] == guard["leaseId"]
                && job["sessionId"] == batch["sessionId"]
                && job["version"] == guard["expectedVersion"]
                && same(&job["sourceRefs"], &guard["sourceRefs"])
        });
        if !valid {
            return Ok(rejected("conflict", "job_lease_changed"));
        }
    }
    if let Some(reason) = shape_conflict(&batch)? {
        return Ok(rejected("conflict", reason));
    }
    let Some(mut operation) = operation else {
        return Ok(rejected("conflict", "operation_not_prepared"));
    };
    if operation["status"] != "prepared"
        || operation.get("stage").is_none()
        || operation["stage"]["sessionId"] != batch["sessionId"]
        || !same(&operation["sourceRefs"], &batch["sourceRefs"])
        || !same(&operation["readSet"], &batch["readSet"])
        || !same(
            &operation["effects"],
            &serde_json::json!(field_ids(&batch["changes"], "effectKey")?),
        )
    {
        return Ok(rejected("conflict", "operation_not_prepared"));
    }
    let base = scope_key(scope)?;
    for reference in array(&batch["readSet"])? {
        let state = tx.get(
            "states",
            &format!(
                "{base}/{}/{}",
                text(&reference["domain"])?,
                text(&reference["entityId"])?
            ),
        )?;
        if state
            .as_ref()
            .map(|state| integer(&state["version"]))
            .transpose()?
            .unwrap_or(0)
            != integer(&reference["version"])?
        {
            return Ok(rejected("conflict", "state_read_version_changed"));
        }
    }
    for change in array(&batch["changes"])? {
        let state = tx.get(
            "states",
            &format!(
                "{base}/{}/{}",
                text(&change["ref"]["domain"])?,
                text(&change["ref"]["entityId"])?
            ),
        )?;
        if !same(
            &state
                .as_ref()
                .map_or(Value::Null, |state| state["record"].clone()),
            &change["before"],
        ) {
            return Ok(rejected("conflict", "before_state_mismatch"));
        }
        for bound in tx.branch_path(scope)? {
            if let Some(effect) = tx.get(
                "effects",
                &format!(
                    "{}/{}",
                    scope_key(&bound.scope)?,
                    text(&change["effectKey"])?
                ),
            )? {
                if integer(&effect["commitSeq"])? <= bound.cutoff {
                    return Ok(rejected("conflict", "effect_already_applied"));
                }
            }
        }
    }
    for reference in array(&batch["sourceRefs"])? {
        let Some(source) = tx.get("sources", &source_key(reference)?)? else {
            return Ok(rejected("conflict", "source_not_reachable"));
        };
        if !tx.source_usable(&source, scope, &batch["operationId"])? {
            return Ok(rejected("conflict", "source_not_reachable"));
        }
        if source["commitSeq"].is_null() && tx.get("sources", &source_key(&serde_json::json!({"sourceId":reference["sourceId"],"sourceVersion":integer(&reference["sourceVersion"])? + 1}))?)?.is_some() { return Ok(rejected("conflict", "source_version_changed")); }
    }
    for event in array(&batch["events"])? {
        if tx.event(text(&event["eventId"])?)?.is_some() {
            return Ok(rejected("conflict", "event_identity_exists"));
        }
        if !tx.evidence_valid(
            &event["evidenceRefs"],
            &batch["sourceRefs"],
            scope,
            &batch["operationId"],
        )? {
            return Ok(rejected("conflict", "invalid_event_evidence"));
        }
        if let Some(id) = event.get("correctionOf") {
            if array(&batch["events"])?
                .iter()
                .any(|created| same(&created["eventId"], id))
                || !tx.event_reachable(scope, id, &batch["events"])?
            {
                return Ok(rejected("conflict", "correction_event_not_reachable"));
            }
        }
        if let Some(id) = event.get("replyToEventId") {
            if array(&batch["events"])?
                .iter()
                .any(|created| same(&created["eventId"], id))
                || !tx.event_reachable(scope, id, &batch["events"])?
            {
                return Ok(rejected("conflict", "reply_event_not_reachable"));
            }
        }
    }
    for record in array(&batch["knowledge"])? {
        if !tx.event_reachable(scope, &record["eventId"], &batch["events"])?
            || !tx.evidence_valid(
                &record["evidenceRefs"],
                &batch["sourceRefs"],
                scope,
                &batch["operationId"],
            )?
        {
            return Ok(rejected("conflict", "invalid_knowledge_evidence"));
        }
        if integer(&record["version"])?
            != tx.latest_version("knowledge", scope, text(&record["knowledgeId"])?)? + 1
        {
            return Ok(rejected("conflict", "knowledge_version_changed"));
        }
    }
    for record in array(&batch["commitments"])? {
        if !tx.event_reachable(scope, &record["establishedEventId"], &batch["events"])? {
            return Ok(rejected("conflict", "commitment_event_not_reachable"));
        }
        for item in array(&record["history"])? {
            if !tx.event_reachable(scope, &item["eventId"], &batch["events"])? {
                return Ok(rejected("conflict", "commitment_history_not_reachable"));
            }
        }
        if integer(&record["version"])?
            != tx.latest_version("commitments", scope, text(&record["commitmentId"])?)? + 1
        {
            return Ok(rejected("conflict", "commitment_version_changed"));
        }
    }
    for job in array(&batch["jobs"])? {
        if tx
            .get("jobs", &format!("{base}/{}", text(&job["jobId"])?))?
            .is_some()
        {
            return Ok(rejected("conflict", "job_identity_exists"));
        }
        if array(&job["sourceRefs"])?.iter().any(|reference| {
            !array(&batch["sourceRefs"])
                .unwrap()
                .iter()
                .any(|declared| same(reference, declared))
        }) {
            return Ok(rejected("conflict", "job_source_not_declared"));
        }
    }
    let seq = integer(&branch["head"]["coreSeq"])? + 1;
    for change in array(&batch["changes"])? {
        let reference = &change["ref"];
        tx.put("states", format!("{base}/{}/{}", text(&reference["domain"])?, text(&reference["entityId"])?), serde_json::json!({"scope":scope,"domain":reference["domain"],"entityId":reference["entityId"],"version":integer(&reference["version"])? + 1,"record":change["after"]}))?;
        tx.add("effects", format!("{base}/{}", text(&change["effectKey"])?), serde_json::json!({"scope":scope,"effectKey":change["effectKey"],"operationId":batch["operationId"],"commitSeq":seq}))?;
    }
    for event in array(&batch["events"])? {
        let mut event = event.clone();
        event["commitSeq"] = serde_json::json!(seq);
        let key = event_key(scope, seq, text(&event["eventId"])?)?;
        tx.add(
            "eventIds",
            text(&event["eventId"])?.into(),
            serde_json::json!({"eventKey":key}),
        )?;
        tx.add("events", key, event)?;
    }
    for (store, id_field) in [
        ("knowledge", "knowledgeId"),
        ("commitments", "commitmentId"),
    ] {
        for record in array(&batch[store])? {
            tx.add(store, format!("{base}/{}/{:016}", text(&record[id_field])?, integer(&record["version"])?), serde_json::json!({"scope":scope,id_field:record[id_field],"version":record["version"],"commitSeq":seq,"record":record}))?;
        }
    }
    for record in array(&batch["jobs"])? {
        tx.add(
            "jobs",
            format!("{base}/{}", text(&record["jobId"])?),
            serde_json::json!({"scope":scope,"commitSeq":seq,"record":record}),
        )?;
    }
    for reference in array(&batch["sourceRefs"])? {
        let key = source_key(reference)?;
        let mut source = tx
            .get("sources", &key)?
            .ok_or("CORE2_SOURCE_NOT_REACHABLE")?;
        if source["commitSeq"].is_null() {
            source["commitSeq"] = serde_json::json!(seq);
            crate::core2_sources::write_position(
                &mut tx,
                &source["record"],
                serde_json::json!(seq),
            )?;
            tx.put("sources", key, source)?;
        }
    }
    let receipt = serde_json::json!({"status":"committed","scope":scope,"operationId":batch["operationId"],"coreSeq":seq,"eventIds":field_ids(&batch["events"],"eventId")?,"jobIds":field_ids(&batch["jobs"],"jobId")?});
    operation["status"] = Value::String("committed".into());
    operation["receipt"] = receipt.clone();
    tx.put(
        "operations",
        format!("{base}/{}", text(&batch["operationId"])?),
        operation,
    )?;
    branch["head"]["coreSeq"] = serde_json::json!(seq);
    checked("head", &branch["head"])?;
    tx.put("branches", base, branch)?;
    if seq % 50 == 0 {
        crate::core2_snapshots::store_checkpoint(&mut tx, scope)?;
    }
    tx.finish_with_fault(fault)?;
    Ok(receipt)
}
