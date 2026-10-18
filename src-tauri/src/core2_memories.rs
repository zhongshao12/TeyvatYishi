use crate::core2_json::stable_json;
use crate::core2_repository::{
    array, checked, field_ids, integer, same, scope_key, text, unique_by, CoreFileTransaction,
};
use serde_json::Value;
use std::path::Path;

use crate::core2_jobs::job_holder_matches;
pub(crate) fn read_memory_versions(root: &Path, query: Value) -> Result<Value, String> {
    checked("memoryVersionQuery", &query)?;
    let tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(&query["scope"])?["head"].clone();
    let cutoff = integer(&query["cutoffSeq"])?;
    let revision = integer(&query["memoryRevision"])?;
    if cutoff > integer(&head["coreSeq"])? || revision > integer(&head["memoryRevision"])? {
        return Err("CORE2_FUTURE_CUTOFF".into());
    }
    let path = tx.branch_path(&query["scope"])?;
    let mut result = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for reference in array(&query["refs"])? {
        let id = text(&reference["memoryId"])?;
        let version = integer(&reference["version"])?;
        if !seen.insert((id.to_owned(), version)) {
            continue;
        }
        for bound in &path {
            let key = format!("{}/{}/{:016}", scope_key(&bound.scope)?, id, version);
            if let Some(row) = tx.get("memories", &key)? {
                if integer(&row["commitSeq"])? <= cutoff.min(bound.cutoff)
                    && integer(&row["publishedRevision"])? <= revision.min(bound.memory_revision)
                {
                    checked("memory", &row["record"])?;
                    result.push(row["record"].clone());
                    break;
                }
            }
        }
    }
    Ok(serde_json::json!(result))
}
impl CoreFileTransaction {
    fn latest_memory(&self, scope: &Value, id: &str) -> Result<Option<Value>, String> {
        let head = self.branch(scope)?["head"].clone();
        self.latest_memory_at(
            scope,
            id,
            integer(&head["coreSeq"])?,
            integer(&head["memoryRevision"])?,
        )
    }
    pub(crate) fn latest_memory_at(
        &self,
        scope: &Value,
        id: &str,
        cutoff: u64,
        revision: u64,
    ) -> Result<Option<Value>, String> {
        let mut latest: Option<Value> = None;
        for bound in self.branch_path(scope)? {
            for row in self.scan("memories", &format!("{}/{id}/", scope_key(&bound.scope)?))? {
                if integer(&row["commitSeq"])? > bound.cutoff.min(cutoff)
                    || integer(&row["publishedRevision"])? > bound.memory_revision.min(revision)
                {
                    continue;
                }
                checked("memory", &row["record"])?;
                if latest.as_ref().is_none_or(|old| {
                    old["record"]["version"].as_f64() < row["record"]["version"].as_f64()
                }) {
                    latest = Some(row);
                }
            }
        }
        Ok(latest)
    }
    fn memory_provenance_valid(
        &self,
        memories: &Value,
        declared: &Value,
        scope: &Value,
        reads: &Value,
    ) -> Result<bool, String> {
        for memory in array(memories)? {
            if array(&memory["sourceRefs"])?.iter().any(|reference| {
                !array(declared)
                    .unwrap()
                    .iter()
                    .any(|allowed| same(reference, allowed))
            }) || !self.sources_committed(scope, &memory["sourceRefs"])?
            {
                return Ok(false);
            }
            for id in array(&memory["eventIds"])? {
                if !self.event_reachable(scope, id, &serde_json::json!([]))? {
                    return Ok(false);
                }
            }
            for reference in array(&memory["memoryRefs"])? {
                if !array(reads)?.iter().any(|read| same(read, reference)) {
                    return Ok(false);
                }
                let Some(latest) = self.latest_memory(scope, text(&reference["memoryId"])?)? else {
                    return Ok(false);
                };
                if integer(&latest["record"]["version"])? != integer(&reference["version"])? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}
pub(crate) fn save_job_step(root: &Path, step: Value) -> Result<(), String> {
    checked("jobStep", &step)?;
    let mut tx = CoreFileTransaction::open(root)?;
    let head = tx.branch(&step["scope"])?["head"].clone();
    let key = format!("{}/{}", scope_key(&step["scope"])?, text(&step["jobId"])?);
    let mut stored = tx.get("jobs", &key)?.ok_or("CORE2_JOB_HOLDER_CHANGED")?;
    checked("job", &stored["record"])?;
    if !job_holder_matches(&stored["record"], &head, &step)
        || !tx.sources_committed(&step["scope"], &step["sourceRefs"])?
    {
        return Err("CORE2_JOB_HOLDER_CHANGED".into());
    }
    let steps = array(&stored["record"]["steps"])?;
    if let Some(previous) = steps
        .iter()
        .find(|previous| previous["stepId"] == step["stepId"])
    {
        if same(previous, &step) {
            return Ok(());
        }
        if previous["status"] == "completed" {
            return Err("CORE2_JOB_STEP_IMMUTABLE".into());
        }
    }
    let reads: Vec<Value> = array(&step["memories"])?
        .iter()
        .flat_map(|memory| {
            memory["memoryRefs"]
                .as_array()
                .into_iter()
                .flatten()
                .cloned()
        })
        .collect();
    if !tx.memory_provenance_valid(
        &step["memories"],
        &step["sourceRefs"],
        &step["scope"],
        &serde_json::json!(reads),
    )? {
        return Err("CORE2_INVALID_MEMORY_PROVENANCE".into());
    }
    let mut next: Vec<_> = steps
        .iter()
        .filter(|previous| previous["stepId"] != step["stepId"])
        .cloned()
        .collect();
    next.push(step);
    stored["record"]["steps"] = serde_json::json!(next);
    stored["record"]["version"] = serde_json::json!(integer(&stored["record"]["version"])? + 1);
    checked("job", &stored["record"])?;
    tx.put("jobs", key, stored)?;
    tx.finish()
}
pub(crate) fn publish_derived(root: &Path, patch: Value) -> Result<Value, String> {
    publish_derived_with_fault(root, patch, |_| Ok(()))
}
pub(crate) fn publish_derived_with_fault(
    root: &Path,
    patch: Value,
    fault: impl Fn(crate::core2_store::FaultPoint) -> Result<(), String>,
) -> Result<Value, String> {
    checked("derived", &patch)?;
    let scope = &patch["scope"];
    let mut tx = CoreFileTransaction::open(root)?;
    let mut branch = tx.branch(scope)?;
    let key = format!("{}/{}", scope_key(scope)?, text(&patch["jobId"])?);
    let job = tx.get("jobs", &key)?;
    let fingerprint = crate::core2_store::checksum_bytes(stable_json(&patch)?.as_bytes());
    let mut descriptor = patch.clone();
    descriptor.as_object_mut().unwrap().remove("additions");
    if let Some(job) = &job {
        checked("job", &job["record"])?;
        if let Some(publication) = job.get("publication") {
            if publication["leaseId"] == patch["leaseId"]
                && publication["fingerprint"] == fingerprint
                && same(&publication["descriptor"], &descriptor)
                && publication["receipt"]["memoryIds"]
                    .as_array()
                    .is_some_and(|ids| ids.len() == patch["additions"].as_array().unwrap().len())
            {
                let mut equal = true;
                for memory in array(&patch["additions"])? {
                    let saved = tx.get(
                        "memories",
                        &format!(
                            "{}/{}/{:016}",
                            scope_key(scope)?,
                            text(&memory["memoryId"])?,
                            integer(&memory["version"])?
                        ),
                    )?;
                    if saved.is_none_or(|saved| !same(&saved["record"], memory)) {
                        equal = false;
                        break;
                    }
                }
                if equal {
                    return Ok(publication["receipt"].clone());
                }
            }
        }
    }
    let rejected = |status: &str, reason: &str| serde_json::json!({"status":status,"reason":reason,"memoryRevision":branch["head"]["memoryRevision"],"memoryIds":[]});
    let Some(mut job) = job else {
        return Ok(rejected("cancelled", "job_holder_changed"));
    };
    if !job_holder_matches(&job["record"], &branch["head"], &patch) {
        return Ok(rejected("cancelled", "job_holder_changed"));
    }
    if job.get("publication").is_some() {
        return Ok(rejected("conflict", "job_already_published"));
    }
    if integer(&patch["expectedMemoryRevision"])? > integer(&branch["head"]["memoryRevision"])?
        || !unique_by(array(&patch["readSet"])?, |read| {
            read["memoryId"].to_string()
        })
        || !unique_by(array(&patch["additions"])?, |memory| {
            memory["memoryId"].to_string()
        })
        || !unique_by(array(&patch["supersededIds"])?, Value::to_string)
    {
        return Ok(rejected("conflict", "invalid_memory_read_set"));
    }
    if array(&patch["additions"])?.is_empty() && array(&patch["supersededIds"])?.is_empty() {
        return Ok(rejected("conflict", "empty_memory_patch"));
    }
    if !tx.sources_committed(scope, &patch["sourceRefs"])? {
        return Ok(rejected("conflict", "source_not_committed"));
    }
    for read in array(&patch["readSet"])? {
        let latest = tx.latest_memory(scope, text(&read["memoryId"])?)?;
        if latest
            .as_ref()
            .is_none_or(|latest| latest["record"]["version"].as_f64() != read["version"].as_f64())
        {
            return Ok(rejected("conflict", "memory_read_version_changed"));
        }
    }
    for memory in array(&patch["additions"])? {
        let latest = tx.latest_memory(scope, text(&memory["memoryId"])?)?;
        let previous = latest
            .as_ref()
            .map(|latest| integer(&latest["record"]["version"]))
            .transpose()?
            .unwrap_or(0);
        if integer(&memory["version"])? != previous + 1
            || (latest.is_some()
                && !array(&patch["readSet"])?.iter().any(|read| {
                    read["memoryId"] == memory["memoryId"]
                        && read["version"].as_f64() == Some(previous as f64)
                }))
            || array(&patch["supersededIds"])?.contains(&memory["memoryId"])
        {
            return Ok(rejected("conflict", "memory_write_version_changed"));
        }
    }
    for id in array(&patch["supersededIds"])? {
        if !array(&patch["readSet"])?
            .iter()
            .any(|read| read["memoryId"] == *id)
        {
            return Ok(rejected("conflict", "replacement_not_in_read_set"));
        }
    }
    if !tx.memory_provenance_valid(
        &patch["additions"],
        &patch["sourceRefs"],
        scope,
        &patch["readSet"],
    )? {
        return Ok(rejected("conflict", "invalid_memory_provenance"));
    }
    let revision = integer(&branch["head"]["memoryRevision"])? + 1;
    let sequence = branch["head"]["coreSeq"].clone();
    let base = scope_key(scope)?;
    for memory in array(&patch["additions"])? {
        tx.add("memories", format!("{base}/{}/{:016}", text(&memory["memoryId"])?, integer(&memory["version"])?), serde_json::json!({"scope":scope,"commitSeq":sequence,"publishedRevision":revision,"record":memory}))?;
    }
    for id in array(&patch["supersededIds"])? {
        let mut memory = tx
            .latest_memory(scope, text(id)?)?
            .ok_or("CORE2_MEMORY_NOT_FOUND")?["record"]
            .clone();
        memory["scope"] = scope.clone();
        memory["version"] = serde_json::json!(integer(&memory["version"])? + 1);
        memory["status"] = serde_json::json!("superseded");
        checked("memory", &memory)?;
        tx.add("memories", format!("{base}/{}/{:016}", text(id)?, integer(&memory["version"])?), serde_json::json!({"scope":scope,"commitSeq":sequence,"publishedRevision":revision,"record":memory}))?;
    }
    let receipt = serde_json::json!({"status":"published","memoryRevision":revision,"memoryIds":field_ids(&patch["additions"],"memoryId")?});
    job["publication"] = serde_json::json!({"leaseId":patch["leaseId"],"fingerprint":fingerprint,"descriptor":descriptor,"receipt":receipt});
    tx.put("jobs", key, job)?;
    branch["head"]["memoryRevision"] = serde_json::json!(revision);
    checked("head", &branch["head"])?;
    tx.put("branches", base, branch)?;
    tx.finish_with_fault(fault)?;
    Ok(receipt)
}
