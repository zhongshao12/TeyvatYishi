//! Consistent read-only metadata bridge for export. No arbitrary store or path API.
use crate::core2_repository::{checked, same, text, CoreFileTransaction};
use serde_json::{json, Value};
use std::path::Path;

pub(crate) fn read_export_records(root: &Path, scope: Value) -> Result<Value, String> {
    checked("scope", &scope)?;
    let tx = CoreFileTransaction::open(root)?;
    let path = tx.branch_path(&scope)?;
    let in_path = |scope: &Value| path.iter().any(|bound| same(&bound.scope, scope));
    let mut branches = Vec::new();
    for bound in &path {
        let stored = tx.branch(&bound.scope)?;
        let mut row = json!({"head":stored["head"],"playerId":stored["playerId"]});
        if let Some(origin) = stored.get("originSnapshotId") {
            row["originSnapshotId"] = origin.clone();
        }
        branches.push(row);
    }
    let mut result = json!({"scope":scope,"branches":branches});
    for kind in [
        "sources",
        "events",
        "operations",
        "memories",
        "knowledge",
        "commitments",
        "jobs",
        "snapshots",
    ] {
        let mut rows = Vec::new();
        for mut row in tx.scan(kind, "")? {
            let position_scope = match kind {
                "events" => json!({"journeyId":row["journeyId"],"branchId":row["branchId"]}),
                "sources" | "memories" | "knowledge" | "commitments" | "jobs" => {
                    row["record"]["scope"].clone()
                }
                _ => row["scope"].clone(),
            };
            if !in_path(&position_scope) {
                continue;
            }
            if ["memories", "knowledge", "commitments", "jobs"].contains(&kind) {
                let object = row.as_object_mut().ok_or("CORE2_INVALID_EXPORT")?;
                object.remove("scope");
                object.remove("knowledgeId");
                object.remove("commitmentId");
                object.remove("version");
                if kind == "jobs" {
                    object.entry("leaseIds").or_insert(json!([]));
                }
            }
            rows.push(row);
        }
        result[kind] = json!(rows);
    }
    result["slots"] = json!(tx
        .scan("slots", "")?
        .into_iter()
        .filter(|row| row["journeyId"] == scope["journeyId"])
        .collect::<Vec<_>>());
    let mut assets = Vec::new();
    for row in tx.scan("assets", "")? {
        if in_path(&row["asset"]["scope"]) {
            assets.push(crate::core2_assets::asset_from_transaction(
                &tx,
                text(&row["asset"]["assetId"])?,
            )?);
        }
    }
    result["assets"] = json!(assets);
    Ok(result)
}
