use crate::core2_json::stable_json;
use crate::core2_repository::{
    array, checked, integer, same, scope_key, source_key, text, CoreFileTransaction,
};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

fn matches_filter(values: &[Value], filter: Option<&Value>) -> bool {
    filter.is_none_or(|filter| {
        filter.as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| values.iter().any(|value| same(item, value)))
        })
    })
}
fn travel_date(value: &Value) -> Option<u64> {
    let date = value
        .as_str()?
        .trim_matches(crate::core2_contract::js_whitespace);
    let date = date
        .strip_prefix("旅行历")?
        .trim_start_matches(crate::core2_contract::js_whitespace);
    let parts: Vec<_> = date.split('.').collect();
    if parts.len() != 3
        || parts.iter().zip([6, 2, 2]).any(|(part, max)| {
            part.is_empty() || part.len() > max || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return None;
    }
    let year: u64 = parts[0].parse().ok()?;
    let month: u64 = parts[1].parse().ok()?;
    let day: u64 = parts[2].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(year * 372 + (month - 1) * 31 + day)
}
fn world_clock(value: &Value) -> Option<u64> {
    let clock = value
        .as_str()?
        .trim_matches(crate::core2_contract::js_whitespace);
    let (hour, minute) = clock.split_once(':')?;
    if !(1..=2).contains(&hour.len())
        || minute.len() != 2
        || !hour
            .bytes()
            .chain(minute.bytes())
            .all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let hour: u64 = hour.parse().ok()?;
    let minute: u64 = minute.parse().ok()?;
    (hour <= 23 && minute <= 59).then_some(hour * 60 + minute)
}
fn date_commitment_due(record: &Value, moment: &Value) -> Result<bool, String> {
    if !["pending", "due"].contains(&record["status"].as_str().unwrap_or(""))
        || record["trigger"]["kind"] != "date"
    {
        return Ok(false);
    }
    let target = travel_date(&record["trigger"]["date"]).ok_or("CORE2_INVALID_COMMITMENT_TIME")?;
    let today = travel_date(&moment["date"]).ok_or("CORE2_INVALID_DUE_TIME")?;
    let target_clock = record["trigger"]
        .get("clock")
        .map(world_clock)
        .unwrap_or(Some(0))
        .ok_or("CORE2_INVALID_COMMITMENT_TIME")?;
    if today != target {
        return Ok(today > target);
    }
    if record["trigger"].get("clock").is_none() {
        return Ok(true);
    }
    Ok(world_clock(&moment["clock"]).ok_or("CORE2_DUE_CLOCK_UNKNOWN")? >= target_clock)
}
pub(crate) fn query_records(root: &Path, kind: &str, query: Value) -> Result<Value, String> {
    query_records_in_tx(&CoreFileTransaction::open(root)?, kind, query)
}
pub(crate) fn query_journeys(root: &Path, query: Value) -> Result<Value, String> {
    checked("journeyQuery", &query)?;
    let tx = CoreFileTransaction::open(root)?;
    let branches = tx.scan("branches", "")?;
    let mut descriptor = query.clone();
    descriptor.as_object_mut().unwrap().remove("cursor");
    let prefix = format!("core2-page/{}/", stable_json(&descriptor)?);
    let offset = if let Some(cursor) = query.get("cursor").and_then(Value::as_str) {
        let previous = cursor
            .strip_prefix(&prefix)
            .ok_or("CORE2_CURSOR_MISMATCH")?;
        branches
            .iter()
            .position(|branch| scope_key(&branch["head"]["scope"]).is_ok_and(|key| key == previous))
            .map(|index| index + 1)
            .ok_or("CORE2_CURSOR_STALE")?
    } else {
        0
    };
    let end = (offset + query.get("limit").map(integer).transpose()?.unwrap_or(50) as usize)
        .min(branches.len());
    let mut items = Vec::new();
    for branch in &branches[offset..end] {
        let scope = &branch["head"]["scope"];
        let key = scope_key(scope)?;
        let player = tx
            .get(
                "states",
                &format!("{key}/traveler/{}", text(&branch["playerId"])?),
            )?
            .ok_or("CORE2_JOURNEY_DIRECTORY_STATE")?;
        let worlds = tx.scan("states", &format!("{key}/world/"))?;
        if worlds.len() != 1
            || player["record"]["domain"] != "traveler"
            || worlds[0]["record"]["domain"] != "world"
        {
            return Err("CORE2_JOURNEY_DIRECTORY_STATE".into());
        }
        let mut entry = serde_json::json!({"scope":scope,"name":player["record"]["value"]["姓名"],"turn":worlds[0]["record"]["value"]["completedMainTurns"],"coreSeq":branch["head"]["coreSeq"]});
        if let Some(parent) = branch["head"].get("parent") {
            entry["parentBranchId"] = parent["branchId"].clone();
        }
        checked("journeyEntry", &entry)?;
        items.push(entry);
    }
    let mut result = serde_json::json!({"items":items});
    if end < branches.len() {
        result["nextCursor"] = serde_json::json!(format!(
            "{prefix}{}",
            scope_key(&branches[end - 1]["head"]["scope"])?
        ));
    }
    Ok(result)
}
pub(crate) fn query_memory_rows(root: &Path, query: Value) -> Result<Value, String> {
    let tx = CoreFileTransaction::open(root)?;
    let mut page = query_records_in_tx(&tx, "memories", query.clone())?;
    let mut items = Vec::new();
    for record in page["items"].as_array().unwrap() {
        let row = tx
            .latest_memory_at(
                &query["scope"],
                text(&record["memoryId"])?,
                integer(&query["cutoffSeq"])?,
                integer(&query["memoryRevision"])?,
            )?
            .ok_or("CORE2_MEMORY_POSITION_MISSING")?;
        if !same(&row["record"], record) {
            return Err("CORE2_MEMORY_POSITION_MISMATCH".into());
        }
        items.push(serde_json::json!({"record":record,"commitSeq":row["commitSeq"],"publishedRevision":row["publishedRevision"]}));
    }
    page["items"] = serde_json::json!(items);
    Ok(page)
}
fn query_records_in_tx(
    tx: &CoreFileTransaction,
    kind: &str,
    query: Value,
) -> Result<Value, String> {
    let live_operation_view = kind == "operations" && query.get("statuses").is_some();
    let filter_keys: &[&str] = match kind {
        "events" => &[
            "eventIds",
            "npcIds",
            "types",
            "turns",
            "locations",
            "channelIds",
            "direction",
        ],
        "knowledge" => &["npcIds", "eventIds"],
        "commitments" => &["participantIds", "statuses"],
        "jobs" => &["statuses", "kinds", "jobIds", "activeAttemptsOnly"],
        "memories" => &[
            "memoryIds",
            "npcIds",
            "layers",
            "statuses",
            "turns",
            "keywords",
            "locations",
        ],
        "sources" => &["refs", "kinds", "operationId"],
        "operations" => &["statuses", "kinds", "direction"],
        _ => return Err("CORE2_INVALID_QUERY_KIND".into()),
    };
    if stable_json(&query).is_err()
        || !query.is_object()
        || query.as_object().unwrap().keys().any(|key| {
            !["scope", "cutoffSeq", "cursor", "limit"].contains(&key.as_str())
                && !(kind == "memories" && key == "memoryRevision")
                && !(kind == "commitments" && key == "dueAt")
                && !(kind == "operations" && key == "afterSeq")
                && !(kind == "events" && key == "afterSeq")
                && !(kind == "memories" && key == "afterRevision")
                && !filter_keys.contains(&key.as_str())
        })
    {
        return Err("CORE2_INVALID_QUERY".into());
    }
    if kind == "sources" {
        checked("sourceQuery", &query).map_err(|_| "CORE2_INVALID_QUERY")?;
    }
    if kind == "operations" {
        checked(
            if live_operation_view {
                "operationQuery"
            } else {
                "committedOperationQuery"
            },
            &query,
        )
        .map_err(|_| "CORE2_INVALID_QUERY")?;
    }
    if let Some(moment) = query.get("dueAt") {
        checked("worldMoment", moment)?;
        if travel_date(&moment["date"]).is_none()
            || (!moment["clock"].is_null() && world_clock(&moment["clock"]).is_none())
        {
            return Err("CORE2_INVALID_DUE_TIME".into());
        }
    }
    checked("scope", &query["scope"])?;
    let cutoff = integer(&query["cutoffSeq"]).map_err(|_| "CORE2_INVALID_QUERY")?;
    if kind == "operations" && !live_operation_view && integer(&query["afterSeq"])? > cutoff {
        return Err("CORE2_INVALID_QUERY".into());
    }
    if kind == "events"
        && query
            .get("afterSeq")
            .is_some_and(|value| integer(value).map_or(true, |after| after > cutoff))
    {
        return Err("CORE2_INVALID_QUERY".into());
    }
    let limit = match query.get("limit") {
        Some(limit) => integer(limit).map_err(|_| "CORE2_INVALID_QUERY")?,
        None => 50,
    };
    if !(1..=200).contains(&limit)
        || query.get("cursor").is_some_and(|cursor| {
            !cursor
                .as_str()
                .is_some_and(|cursor| cursor.encode_utf16().count() <= 1000)
        })
    {
        return Err("CORE2_INVALID_QUERY".into());
    }
    for key in filter_keys {
        if *key == "activeAttemptsOnly" {
            if query.get(*key).is_some_and(|value| !value.is_boolean()) {
                return Err("CORE2_INVALID_QUERY".into());
            }
            continue;
        }
        if *key == "direction" {
            if query
                .get("direction")
                .is_some_and(|value| value != "asc" && value != "desc")
            {
                return Err("CORE2_INVALID_QUERY".into());
            }
            continue;
        }
        if kind == "sources" {
            continue;
        } // Exact structural source-query whitelist already checked.
        if let Some(filter) = query.get(*key) {
            if !filter.as_array().is_some_and(|items| {
                items.iter().all(|item| {
                    if *key == "turns" {
                        integer(item).is_ok()
                    } else {
                        crate::core2_contract::non_empty_text(item)
                    }
                })
            }) {
                return Err("CORE2_INVALID_QUERY".into());
            }
        }
    }
    let branch = tx.branch(&query["scope"])?;
    if cutoff > integer(&branch["head"]["coreSeq"])? {
        return Err("CORE2_FUTURE_CUTOFF".into());
    }
    if live_operation_view && cutoff != integer(&branch["head"]["coreSeq"])? {
        return Err("CORE2_OPERATION_VIEW_POSITION".into());
    }
    if kind == "sources" {
        return crate::core2_sources::query_sources(&tx, &query);
    }
    let memory_revision = if kind == "memories" {
        let revision = integer(&query["memoryRevision"]).map_err(|_| "CORE2_INVALID_QUERY")?;
        if revision > integer(&branch["head"]["memoryRevision"])? {
            return Err("CORE2_FUTURE_CUTOFF".into());
        }
        Some(revision)
    } else {
        None
    };
    if kind == "memories"
        && query.get("afterRevision").is_some_and(|value| {
            integer(value).map_or(true, |after| after > memory_revision.unwrap())
        })
    {
        return Err("CORE2_INVALID_QUERY".into());
    }
    let mut path = tx.branch_path(&query["scope"])?;
    if kind == "jobs" || live_operation_view {
        path.truncate(1);
    }
    let dto_kind = match kind {
        "events" => "event",
        "knowledge" => "knowledge",
        "commitments" => "commitment",
        "memories" => "memory",
        "sources" => "source",
        "operations" => "operation",
        _ => "job",
    };
    let identity = match kind {
        "events" => "eventId",
        "knowledge" => "knowledgeId",
        "commitments" => "commitmentId",
        "memories" => "memoryId",
        "sources" => "sourceId",
        "operations" => "operationId",
        _ => "jobId",
    };
    let source_rows = if kind == "sources" {
        if let Some(references) = query.get("refs") {
            let mut rows = Vec::new();
            for reference in array(references)? {
                if let Some(source) = tx.get("sources", &source_key(reference)?)? {
                    rows.push(source);
                }
            }
            rows
        } else {
            tx.scan("sources", "")?
        }
    } else {
        Vec::new()
    };
    let record_id = |record: &Value| -> Result<String, String> {
        if kind == "sources" {
            Ok(format!(
                "{}:{}",
                text(&record["ref"]["sourceId"])?,
                integer(&record["ref"]["sourceVersion"])?
            ))
        } else {
            Ok(text(&record[identity])?.into())
        }
    };
    let mut latest: BTreeMap<String, Value> = BTreeMap::new();
    for bound in path {
        let rows = if kind == "jobs" && query.get("jobIds").is_some() {
            let mut found = Vec::new();
            for id in array(&query["jobIds"])? {
                crate::core2_repository::assert_id(text(id)?)?;
                if let Some(row) = tx.get(
                    "jobs",
                    &format!("{}/{}", scope_key(&bound.scope)?, text(id)?),
                )? {
                    found.push(row);
                }
            }
            found
        } else if kind == "memories" && query.get("memoryIds").is_some() {
            let mut found = Vec::new();
            for id in array(&query["memoryIds"])? {
                crate::core2_repository::assert_id(text(id)?)?;
                found.extend(tx.scan(
                    "memories",
                    &format!("{}/{}/", scope_key(&bound.scope)?, text(id)?),
                )?);
            }
            found
        } else if kind == "sources" {
            source_rows.clone()
        } else {
            tx.scan(kind, &format!("{}/", scope_key(&bound.scope)?))?
        };
        for row in rows {
            if kind == "operations" && !live_operation_view && row["status"] != "committed" {
                continue;
            }
            if kind == "sources"
                && (row["commitSeq"].is_null() || !same(&row["record"]["scope"], &bound.scope))
            {
                continue;
            }
            if kind == "memories"
                && integer(&row["publishedRevision"])?
                    > memory_revision.unwrap().min(bound.memory_revision)
            {
                continue;
            }
            let seq = if live_operation_view && row["status"] != "committed" {
                0
            } else {
                integer(if kind == "operations" {
                    &row["receipt"]["coreSeq"]
                } else {
                    &row["commitSeq"]
                })?
            };
            if kind == "operations" && !live_operation_view && seq <= integer(&query["afterSeq"])? {
                continue;
            }
            if kind == "events"
                && seq <= query.get("afterSeq").map(integer).transpose()?.unwrap_or(0)
            {
                continue;
            }
            if seq > cutoff.min(bound.cutoff) {
                continue;
            }
            let publication = if kind == "jobs" {
                row.get("publication")
                    .and_then(|value| value.get("receipt"))
                    .cloned()
            } else {
                None
            };
            let mut record = if kind == "events" || kind == "operations" {
                row
            } else {
                row["record"].clone()
            };
            if let Some(receipt) = publication {
                record["publicationReceipt"] = receipt;
            }
            checked(dto_kind, &record)?;
            let id = record_id(&record)?;
            if kind == "events"
                || kind == "operations"
                || kind == "sources"
                || latest
                    .get(&id)
                    .is_none_or(|old| old["version"].as_f64() < record["version"].as_f64())
            {
                latest.insert(id, record);
            }
        }
    }
    let mut items: Vec<_> = latest
        .into_values()
        .filter(|record| match kind {
            "events" => {
                let mut npcs = record["actorIds"].as_array().unwrap().clone();
                npcs.extend(record["targetIds"].as_array().unwrap().clone());
                matches_filter(&[record["eventId"].clone()], query.get("eventIds"))
                    && matches_filter(&npcs, query.get("npcIds"))
                    && matches_filter(&[record["type"].clone()], query.get("types"))
                    && matches_filter(&[record["turn"].clone()], query.get("turns"))
                    && matches_filter(
                        &record
                            .get("channelId")
                            .cloned()
                            .into_iter()
                            .collect::<Vec<_>>(),
                        query.get("channelIds"),
                    )
                    && matches_filter(
                        &record["occurredMoment"]
                            .get("location")
                            .filter(|location| location.is_string())
                            .cloned()
                            .into_iter()
                            .collect::<Vec<_>>(),
                        query.get("locations"),
                    )
            }
            "memories" => {
                matches_filter(&[record["memoryId"].clone()], query.get("memoryIds"))
                    && matches_filter(record["npcIds"].as_array().unwrap(), query.get("npcIds"))
                    && matches_filter(&[record["layer"].clone()], query.get("layers"))
                    && matches_filter(&[record["status"].clone()], query.get("statuses"))
                    && matches_filter(record["turns"].as_array().unwrap(), query.get("turns"))
                    && matches_filter(
                        record["locations"].as_array().unwrap(),
                        query.get("locations"),
                    )
                    && query.get("keywords").is_none_or(|words| {
                        words.as_array().unwrap().iter().any(|word| {
                            record["text"]
                                .as_str()
                                .unwrap()
                                .contains(word.as_str().unwrap())
                        })
                    })
            }
            "sources" => {
                matches_filter(&[record["kind"].clone()], query.get("kinds"))
                    && query
                        .get("operationId")
                        .is_none_or(|id| record["operationId"] == *id)
            }
            "knowledge" => {
                matches_filter(&[record["npcId"].clone()], query.get("npcIds"))
                    && matches_filter(&[record["eventId"].clone()], query.get("eventIds"))
            }
            "commitments" => {
                matches_filter(
                    record["participantIds"].as_array().unwrap(),
                    query.get("participantIds"),
                ) && matches_filter(&[record["status"].clone()], query.get("statuses"))
            }
            "operations" => {
                matches_filter(&[record["status"].clone()], query.get("statuses"))
                    && matches_filter(&[record["kind"].clone()], query.get("kinds"))
            }
            _ => {
                matches_filter(&[record["status"].clone()], query.get("statuses"))
                    && matches_filter(&[record["kind"].clone()], query.get("kinds"))
                    && matches_filter(&[record["jobId"].clone()], query.get("jobIds"))
                    && (query.get("activeAttemptsOnly") != Some(&Value::Bool(true))
                        || record.get("retriedByJobId").is_none())
            }
        })
        .collect();
    if let Some(moment) = query.get("dueAt") {
        let mut due = Vec::new();
        for record in items {
            if date_commitment_due(&record, moment)? {
                due.push(record);
            }
        }
        items = due;
    }
    if kind == "memories" {
        if let Some(after) = query.get("afterRevision") {
            let after = integer(after)?;
            let mut changed = Vec::new();
            for item in items {
                let row = tx
                    .latest_memory_at(
                        &query["scope"],
                        text(&item["memoryId"])?,
                        cutoff,
                        memory_revision.unwrap(),
                    )?
                    .ok_or("CORE2_MEMORY_POSITION_MISSING")?;
                if integer(&row["publishedRevision"])? > after {
                    changed.push(item);
                }
            }
            items = changed;
        }
    }
    items.sort_by(|a, b| {
        let position = if kind == "operations" && !live_operation_view {
            a["receipt"]["coreSeq"]
                .as_f64()
                .unwrap()
                .total_cmp(&b["receipt"]["coreSeq"].as_f64().unwrap())
        } else if kind == "events" {
            a["commitSeq"]
                .as_f64()
                .unwrap()
                .total_cmp(&b["commitSeq"].as_f64().unwrap())
                .then_with(|| {
                    a.get("sourceOrder")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        .cmp(&b.get("sourceOrder").and_then(Value::as_u64).unwrap_or(0))
                })
        } else {
            std::cmp::Ordering::Equal
        };
        if kind == "sources" {
            return a["ref"]["sourceId"]
                .as_str()
                .unwrap()
                .cmp(b["ref"]["sourceId"].as_str().unwrap())
                .then_with(|| {
                    a["ref"]["sourceVersion"]
                        .as_f64()
                        .unwrap()
                        .total_cmp(&b["ref"]["sourceVersion"].as_f64().unwrap())
                });
        }
        position.then_with(|| {
            a[identity]
                .as_str()
                .unwrap()
                .cmp(b[identity].as_str().unwrap())
        })
    });
    if (kind == "events" || kind == "operations")
        && query.get("direction").is_some_and(|value| value == "desc")
    {
        items.reverse();
    }
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
            .position(|item| record_id(item).is_ok_and(|id| id == previous))
            .map(|index| index + 1)
            .ok_or("CORE2_CURSOR_STALE")?
    } else {
        0
    };
    let end = (offset + limit as usize).min(items.len());
    let mut result = serde_json::json!({"items":items[offset..end]});
    if end < items.len() {
        let cursor = format!("{prefix}{}", record_id(&items[end - 1])?);
        if cursor.encode_utf16().count() > 1000 {
            return Err("CORE2_CURSOR_TOO_LARGE".into());
        }
        result["nextCursor"] = serde_json::json!(cursor);
    }
    Ok(result)
}
