use crate::core2_json::stable_json;
use crate::core2_repository::{
    array, assert_id, checked, integer, same, scope_key, source_key, text, unique_by,
    CoreFileTransaction,
};
use serde_json::Value;
use std::path::Path;

impl CoreFileTransaction {
    pub(crate) fn sources_committed(
        &self,
        scope: &Value,
        references: &Value,
    ) -> Result<bool, String> {
        if !unique_by(array(references)?, |reference| {
            stable_json(reference).unwrap_or_default()
        }) {
            return Ok(false);
        }
        for reference in array(references)? {
            let Some(source) = self.get("sources", &source_key(reference)?)? else {
                return Ok(false);
            };
            checked("source", &source["record"])?;
            if source["commitSeq"].is_null()
                || !self.reachable(
                    scope,
                    &source["record"]["scope"],
                    integer(&source["commitSeq"])?,
                )?
            {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
pub(crate) fn job_holder_matches(job: &Value, head: &Value, claim: &Value) -> bool {
    job["status"] == "running"
        && head["sessionId"] == claim["sessionId"]
        && job["sessionId"] == claim["sessionId"]
        && job["leaseId"] == claim["leaseId"]
        && same(&job["sourceRefs"], &claim["sourceRefs"])
}
pub(crate) fn claim_job(root: &Path, claim: Value) -> Result<Value, String> {
    checked("jobClaim", &claim)?;
    let scope = &claim["scope"];
    let mut tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(scope)?["head"].clone();
    let key = format!("{}/{}", scope_key(scope)?, text(&claim["jobId"])?);
    let Some(mut stored) = tx.get("jobs", &key)? else {
        return Ok(Value::Null);
    };
    checked("job", &stored["record"])?;
    let previous = &stored["record"];
    if head["sessionId"] != claim["sessionId"]
        || previous.get("retriedByJobId").is_some()
        || integer(&previous["version"])? != integer(&claim["expectedVersion"])?
        || !same(&previous["sourceRefs"], &claim["sourceRefs"])
        || !tx.sources_committed(scope, &claim["sourceRefs"])?
    {
        return Ok(Value::Null);
    }
    if previous["status"] == "running" && previous["sessionId"] == claim["sessionId"] {
        return Ok(if previous["leaseId"] == claim["leaseId"] {
            previous.clone()
        } else {
            Value::Null
        });
    }
    if ["completed", "cancelled"].contains(&previous["status"].as_str().unwrap_or("")) {
        return Ok(Value::Null);
    }
    let mut leases = stored
        .get("leaseIds")
        .map(array)
        .transpose()?
        .cloned()
        .unwrap_or_default();
    if leases.contains(&claim["leaseId"]) {
        return Ok(Value::Null);
    }
    for other in tx.scan("jobs", &format!("{}/", scope_key(scope)?))? {
        let other = &other["record"];
        checked("job", other)?;
        if other["jobId"] == claim["jobId"] && same(&other["scope"], scope) {
            continue;
        }
        let maintenance = ["turn_summary", "compression", "rebuild"];
        let overlap = maintenance.contains(&text(&other["kind"])?)
            && maintenance.contains(&text(&previous["kind"])?)
            && array(&other["sourceRefs"])?.iter().any(|a| {
                array(&previous["sourceRefs"])
                    .unwrap()
                    .iter()
                    .any(|b| same(a, b))
            });
        if (other["kind"] == previous["kind"] || overlap)
            && other["status"] == "running"
            && head["sessionId"] == other["sessionId"]
        {
            return Ok(Value::Null);
        }
    }
    let mut record = previous.clone();
    record.as_object_mut().unwrap().remove("failure");
    record["status"] = serde_json::json!("running");
    record["sessionId"] = claim["sessionId"].clone();
    record["leaseId"] = claim["leaseId"].clone();
    record["attempts"] = serde_json::json!(integer(&previous["attempts"])? + 1);
    record["version"] = serde_json::json!(integer(&previous["version"])? + 1);
    checked("job", &record)?;
    leases.push(claim["leaseId"].clone());
    stored["record"] = record.clone();
    stored["leaseIds"] = serde_json::json!(leases);
    tx.put("jobs", key, stored)?;
    tx.finish()?;
    Ok(record)
}
pub(crate) fn finish_job(root: &Path, finish: Value) -> Result<(), String> {
    checked("jobFinish", &finish)?;
    let mut tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(&finish["scope"])?["head"].clone();
    let key = format!(
        "{}/{}",
        scope_key(&finish["scope"])?,
        text(&finish["jobId"])?
    );
    let mut stored = tx.get("jobs", &key)?.ok_or("CORE2_JOB_HOLDER_CHANGED")?;
    checked("job", &stored["record"])?;
    let record = &stored["record"];
    if !job_holder_matches(record, &head, &finish)
        || integer(&record["version"])? != integer(&finish["expectedVersion"])?
    {
        return Err("CORE2_JOB_HOLDER_CHANGED".into());
    }
    let mut next = record.clone();
    next.as_object_mut().unwrap().remove("failure");
    next["status"] = finish["status"].clone();
    next["leaseId"] = Value::Null;
    next["version"] = serde_json::json!(integer(&record["version"])? + 1);
    if let Some(failure) = finish.get("failure") {
        next["failure"] = failure.clone();
    }
    checked("job", &next)?;
    stored["record"] = next;
    tx.put("jobs", key, stored)?;
    tx.finish()
}
pub(crate) fn cancel_job(root: &Path, scope: Value, id: String) -> Result<(), String> {
    assert_id(&id)?;
    let mut tx = CoreFileTransaction::open(root)?;
    tx.branch(&scope)?;
    let key = format!("{}/{id}", scope_key(&scope)?);
    let mut stored = tx.get("jobs", &key)?.ok_or("CORE2_JOB_NOT_FOUND")?;
    checked("job", &stored["record"])?;
    if ["completed", "cancelled"].contains(&stored["record"]["status"].as_str().unwrap_or("")) {
        return Ok(());
    }
    stored["record"]["status"] = serde_json::json!("cancelled");
    stored["record"]["leaseId"] = Value::Null;
    stored["record"]["version"] = serde_json::json!(integer(&stored["record"]["version"])? + 1);
    checked("job", &stored["record"])?;
    tx.put("jobs", key, stored)?;
    tx.finish()
}
pub(crate) fn enqueue_job(root: &Path, job: Value) -> Result<(), String> {
    checked("job", &job)?;
    if job.get("publicationReceipt").is_some()
        || job.get("retriedByJobId").is_some()
        || job["status"] != "pending"
        || !job["leaseId"].is_null()
        || !array(&job["steps"])?.is_empty()
        || integer(&job["version"])? != 1
        || integer(&job["attempts"])? != 0
    {
        return Err("CORE2_INVALID_JOB_ENQUEUE".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(&job["scope"])?["head"].clone();
    if head["sessionId"] != job["sessionId"] {
        return Err("CORE2_SESSION_CHANGED".into());
    }
    let key = format!("{}/{}", scope_key(&job["scope"])?, text(&job["jobId"])?);
    if let Some(previous) = tx.get("jobs", &key)? {
        if [
            "scope",
            "jobId",
            "kind",
            "sourceRefs",
            "operationId",
            "configFingerprint",
            "retryOfJobId",
        ]
        .iter()
        .any(|field| !same(&previous["record"][*field], &job[*field]))
        {
            return Err("CORE2_JOB_IDENTITY_EXISTS".into());
        }
        return Ok(());
    }
    if tx
        .operation(&job["scope"], text(&job["operationId"])?)?
        .is_none_or(|operation| operation["status"] != "committed")
        || !tx.sources_committed(&job["scope"], &job["sourceRefs"])?
    {
        return Err("CORE2_JOB_SOURCE_NOT_COMMITTED".into());
    }
    if let Some(previous_id) = job.get("retryOfJobId") {
        let previous_key = format!("{}/{}", scope_key(&job["scope"])?, text(previous_id)?);
        let mut previous = tx
            .get("jobs", &previous_key)?
            .ok_or("CORE2_JOB_RETRY_IDENTITY")?;
        let record = &previous["record"];
        if record["jobId"] == job["jobId"]
            || ["kind", "operationId", "sourceRefs"]
                .iter()
                .any(|field| !same(&record[*field], &job[*field]))
        {
            return Err("CORE2_JOB_RETRY_IDENTITY".into());
        }
        if record.get("retriedByJobId").is_some() {
            return Err("CORE2_JOB_REPLACEMENT_EXISTS".into());
        }
        if !["failed", "cancelled"].contains(&record["status"].as_str().unwrap_or(""))
            || previous.get("publication").is_some()
        {
            return Err("CORE2_JOB_RETRY_NOT_TERMINAL".into());
        }
        previous["record"]["version"] = serde_json::json!(integer(&record["version"])? + 1);
        previous["record"]["retriedByJobId"] = job["jobId"].clone();
        tx.put("jobs", previous_key, previous)?;
    }
    tx.add(
        "jobs",
        key,
        serde_json::json!({"scope":job["scope"],"commitSeq":head["coreSeq"],"record":job}),
    )?;
    tx.finish()
}
