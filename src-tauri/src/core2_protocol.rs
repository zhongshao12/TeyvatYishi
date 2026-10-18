//! Registered requests only. Storage roots are provided by the host, never the caller.
use crate::{
    core2_assets as assets, core2_indexes as indexes, core2_repository as repo,
    core2_snapshots as saves,
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize)]
#[serde(
    tag = "action",
    content = "args",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum CoreStoreRequest {
    ImportPrepared([Value; 1]),
    Initialize([Value; 1]),
    QueryJourneys([Value; 1]),
    ReadHead([Value; 1]),
    ReadState([Value; 1]),
    ReadRecoveryCheckpoint([Value; 1]),
    ReadExportRecords([Value; 1]),
    ActivateSession([Value; 2]),
    PutSource([Value; 1]),
    AppendOperationSource([Value; 1]),
    ReadSource([Value; 1]),
    PrepareOperation([Value; 1]),
    StageOperation([Value; 1]),
    CancelOperation([Value; 2]),
    ReadOperation([Value; 2]),
    Commit([Value; 1]),
    PublishDerived([Value; 1]),
    QueryEvents([Value; 1]),
    QueryCommittedOperations([Value; 1]),
    QueryOperations([Value; 1]),
    QueryMemories([Value; 1]),
    QueryMemoryRows([Value; 1]),
    ReadMemoryVersions([Value; 1]),
    QuerySources([Value; 1]),
    QueryKnowledge([Value; 1]),
    QueryCommitments([Value; 1]),
    QueryJobs([Value; 1]),
    EnqueueJob([Value; 1]),
    CancelJob([Value; 2]),
    ClaimJob([Value; 1]),
    FinishJob([Value; 1]),
    SaveJobStep([Value; 1]),
    PublishSnapshot([Value; 2]),
    ReadSnapshot([Value; 1]),
    ListSaveSlots([Value; 1]),
    Fork([Value; 1]),
    ReadAsset([Value; 1]),
    PublishAsset([Value; 1]),
    ReadIndexStatus([Value; 1]),
    QueryPostings([Value; 1]),
    PublishIndex([Value; 1]),
}
fn void(result: Result<(), String>) -> Result<Value, String> {
    result.map(|()| Value::Null)
}
fn id(value: Value) -> Result<String, String> {
    Ok(repo::text(&value)?.into())
}
fn dispatch_once(root: &Path, request: CoreStoreRequest) -> Result<Value, String> {
    match request {
        CoreStoreRequest::ImportPrepared([v]) => crate::core2_imports::import_prepared(root, v),
        CoreStoreRequest::Initialize([v]) => repo::initialize(root, v),
        CoreStoreRequest::QueryJourneys([v]) => crate::core2_queries::query_journeys(root, v),
        CoreStoreRequest::ReadHead([v]) => repo::read_head(root, v),
        CoreStoreRequest::ReadState([v]) => repo::read_state(root, v),
        CoreStoreRequest::ReadRecoveryCheckpoint([v]) => saves::read_recovery_checkpoint(root, v),
        CoreStoreRequest::ReadExportRecords([v]) => {
            crate::core2_exports::read_export_records(root, v)
        }
        CoreStoreRequest::ActivateSession([scope, session]) => {
            repo::activate_session(root, scope, id(session)?)
        }
        CoreStoreRequest::PutSource([v]) => repo::put_source(root, v),
        CoreStoreRequest::AppendOperationSource([v]) => repo::append_operation_source(root, v),
        CoreStoreRequest::ReadSource([v]) => repo::read_source(root, v),
        CoreStoreRequest::PrepareOperation([v]) => void(repo::prepare_operation(root, v)),
        CoreStoreRequest::StageOperation([v]) => void(repo::stage_operation(root, v)),
        CoreStoreRequest::CancelOperation([scope, v]) => {
            void(repo::cancel_operation(root, scope, id(v)?))
        }
        CoreStoreRequest::ReadOperation([scope, v]) => repo::read_operation(root, scope, id(v)?),
        CoreStoreRequest::Commit([v]) => repo::commit(root, v),
        CoreStoreRequest::PublishDerived([v]) => repo::publish_derived(root, v),
        CoreStoreRequest::QueryEvents([v]) => repo::query_records(root, "events", v),
        CoreStoreRequest::QueryCommittedOperations([v]) => {
            repo::query_records(root, "operations", v)
        }
        CoreStoreRequest::QueryOperations([v]) => repo::query_records(root, "operations", v),
        CoreStoreRequest::QueryMemories([v]) => repo::query_records(root, "memories", v),
        CoreStoreRequest::QueryMemoryRows([v]) => crate::core2_queries::query_memory_rows(root, v),
        CoreStoreRequest::ReadMemoryVersions([v]) => {
            crate::core2_memories::read_memory_versions(root, v)
        }
        CoreStoreRequest::QuerySources([v]) => repo::query_records(root, "sources", v),
        CoreStoreRequest::QueryKnowledge([v]) => repo::query_records(root, "knowledge", v),
        CoreStoreRequest::QueryCommitments([v]) => repo::query_records(root, "commitments", v),
        CoreStoreRequest::QueryJobs([v]) => repo::query_records(root, "jobs", v),
        CoreStoreRequest::EnqueueJob([v]) => void(repo::enqueue_job(root, v)),
        CoreStoreRequest::CancelJob([scope, v]) => void(repo::cancel_job(root, scope, id(v)?)),
        CoreStoreRequest::ClaimJob([v]) => repo::claim_job(root, v),
        CoreStoreRequest::FinishJob([v]) => void(repo::finish_job(root, v)),
        CoreStoreRequest::SaveJobStep([v]) => void(repo::save_job_step(root, v)),
        CoreStoreRequest::PublishSnapshot([v, slot]) => {
            void(saves::publish_snapshot(root, v, slot))
        }
        CoreStoreRequest::ReadSnapshot([v]) => saves::read_snapshot(root, id(v)?),
        CoreStoreRequest::ListSaveSlots([v]) => saves::list_slots(root, id(v)?),
        CoreStoreRequest::Fork([v]) => saves::fork(root, v),
        CoreStoreRequest::ReadAsset([v]) => assets::read_asset(root, id(v)?),
        CoreStoreRequest::PublishAsset([v]) => void(assets::publish_asset(root, v)),
        CoreStoreRequest::ReadIndexStatus([v]) => indexes::read_status(root, v),
        CoreStoreRequest::QueryPostings([v]) => indexes::query_postings(root, v),
        CoreStoreRequest::PublishIndex([v]) => indexes::publish_index(root, v),
    }
}
pub(crate) fn dispatch(root: &Path, request: CoreStoreRequest) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match dispatch_once(root, request.clone()) {
            Err(error) if error == "CORE2_STORAGE_BUSY" && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(5))
            }
            result => return result,
        }
    }
}
