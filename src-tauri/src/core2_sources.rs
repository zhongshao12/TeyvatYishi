//! Authoritative source positions are small rows; original bodies are point-read
//! only after scope, commit position, filters and pagination select the final page.
use crate::core2_json::stable_json;
use crate::core2_repository::{checked, integer, same, scope_key, source_key, CoreFileTransaction};
use serde_json::{json, Value};

pub(crate) fn position(source: &Value, seq: Value) -> Value {
    json!({"ref":source["ref"],"scope":source["scope"],"operationId":source["operationId"],"kind":source["kind"],"commitSeq":seq})
}
pub(crate) fn write_position(
    tx: &mut CoreFileTransaction,
    source: &Value,
    seq: Value,
) -> Result<(), String> {
    tx.put(
        "sourcePositions",
        format!(
            "{}/{}",
            scope_key(&source["scope"])?,
            source_key(&source["ref"])?
        ),
        position(source, seq),
    )
}
pub(crate) fn query_sources(tx: &CoreFileTransaction, query: &Value) -> Result<Value, String> {
    let path = tx.branch_path(&query["scope"])?;
    let cutoff = integer(&query["cutoffSeq"])?;
    let mut positions = Vec::new();
    if let Some(refs) = query.get("refs") {
        for reference in refs.as_array().unwrap() {
            let mut found = false;
            for bound in &path {
                if let Some(row) = tx.get(
                    "sourcePositions",
                    &format!("{}/{}", scope_key(&bound.scope)?, source_key(reference)?),
                )? {
                    positions.push(row);
                    found = true;
                    break;
                }
            }
            if !found {
                if let Some(original) = tx.get("sources", &source_key(reference)?)? {
                    if !original["commitSeq"].is_null()
                        && path.iter().any(|bound| {
                            same(&bound.scope, &original["record"]["scope"])
                                && integer(&original["commitSeq"])
                                    .is_ok_and(|seq| seq <= bound.cutoff.min(cutoff))
                        })
                    {
                        return Err("CORE2_SOURCE_INDEX_CORRUPT".into());
                    }
                }
            }
        }
    } else {
        for bound in &path {
            let rows = tx.scan("sourcePositions", &format!("{}/", scope_key(&bound.scope)?))?;
            if rows.len() as u64 != integer(&tx.branch(&bound.scope)?["sourceCount"])? {
                return Err("CORE2_SOURCE_INDEX_CORRUPT".into());
            }
            positions.extend(rows);
        }
    }
    let mut matched = Vec::new();
    for row in positions {
        checked("scope", &row["scope"])?;
        checked("sourceRef", &row["ref"])?;
        if row["commitSeq"].is_null() {
            continue;
        }
        let seq = integer(&row["commitSeq"])?;
        if !path
            .iter()
            .any(|bound| same(&bound.scope, &row["scope"]) && seq <= bound.cutoff.min(cutoff))
        {
            continue;
        }
        if query
            .get("kinds")
            .is_some_and(|kinds| !kinds.as_array().unwrap().contains(&row["kind"]))
            || query
                .get("operationId")
                .is_some_and(|id| *id != row["operationId"])
        {
            continue;
        }
        matched.push(row);
    }
    matched.sort_by(|a, b| {
        a["ref"]["sourceId"]
            .as_str()
            .unwrap()
            .cmp(b["ref"]["sourceId"].as_str().unwrap())
            .then_with(|| {
                a["ref"]["sourceVersion"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b["ref"]["sourceVersion"].as_f64().unwrap())
            })
    });
    matched.dedup_by(|a, b| same(&a["ref"], &b["ref"]));
    let id = |row: &Value| {
        format!(
            "{}:{}",
            row["ref"]["sourceId"].as_str().unwrap(),
            row["ref"]["sourceVersion"].as_f64().unwrap() as u64
        )
    };
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
        matched
            .iter()
            .position(|row| id(row) == previous)
            .map(|index| index + 1)
            .ok_or("CORE2_CURSOR_STALE")?
    } else {
        0
    };
    let end = (offset + query.get("limit").map(integer).transpose()?.unwrap_or(50) as usize)
        .min(matched.len());
    let mut items = Vec::new();
    for metadata in &matched[offset..end] {
        let row = tx
            .get("sources", &source_key(&metadata["ref"])?)?
            .ok_or("CORE2_SOURCE_INDEX_CORRUPT")?;
        checked("source", &row["record"])?;
        if !same(
            metadata,
            &position(&row["record"], row["commitSeq"].clone()),
        ) {
            return Err("CORE2_SOURCE_INDEX_CORRUPT".into());
        }
        items.push(row["record"].clone());
    }
    let mut result = json!({"items":items});
    if end < matched.len() {
        let cursor = format!("{prefix}{}", id(&matched[end - 1]));
        if cursor.encode_utf16().count() > 1000 {
            return Err("CORE2_CURSOR_TOO_LARGE".into());
        }
        result["nextCursor"] = json!(cursor);
    }
    Ok(result)
}
