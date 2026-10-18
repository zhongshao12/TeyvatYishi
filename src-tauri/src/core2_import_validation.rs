//! Validate a closed, versioned import graph before opening its destination store.
use crate::core2_assets::checked_asset;
use crate::core2_json::stable_json;
use crate::core2_repository::{assert_id, checked, integer, same, scope_key, source_key, text};
use crate::core2_snapshots::checked_snapshot;
use crate::core2_store::checksum_bytes;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn ensure(ok: bool, error: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(error.into())
    }
}
pub(crate) fn rows<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value[key].as_array().expect("structure checked")
}
// A registered staged output is data, not committed history. Final delivery
// still checks its full task plan, source and live session in one transaction.
fn registered_staged_source(source: &Value, job: &Value) -> bool {
    if job["kind"] == "profile" && source["kind"] == "content" {
        let Some(raw) = job["configFingerprint"]
            .as_str()
            .and_then(|value| value.strip_prefix("core2-profile-plan-v1:"))
        else {
            return false;
        };
        let Ok(plan) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        return plan.as_object().is_some_and(|fields| {
            fields.len() == 6
                && fields.keys().all(|key| {
                    [
                        "version",
                        "scope",
                        "anchorOperationId",
                        "publicationOperationId",
                        "outputSourceRef",
                        "npcId",
                    ]
                    .contains(&key.as_str())
                })
        }) && plan["version"].as_u64() == Some(1)
            && same(&plan["scope"], &job["scope"])
            && same(&source["scope"], &job["scope"])
            && plan["anchorOperationId"] == job["operationId"]
            && plan["publicationOperationId"] == source["operationId"]
            && same(&plan["outputSourceRef"], &source["ref"])
            && source["ref"]["sourceVersion"].as_u64() == Some(1)
            && ["anchorOperationId", "publicationOperationId", "npcId"]
                .iter()
                .all(|key| plan[*key].as_str().is_some_and(|id| assert_id(id).is_ok()))
            && source["blocks"].as_array().is_some_and(|blocks| {
                blocks.len() == 1
                    && blocks[0]["kind"] == "content"
                    && blocks[0].get("speakerId").is_none()
            });
    }
    if job["kind"] == "image" && source["kind"] == "image" {
        let Some(raw) = job["configFingerprint"]
            .as_str()
            .and_then(|value| value.strip_prefix("core2-image-plan-v1:"))
        else {
            return false;
        };
        let Ok(plan) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        return plan.as_object().is_some_and(|fields| {
            fields.len() == 9
                && fields.keys().all(|key| {
                    [
                        "version",
                        "scope",
                        "anchorOperationId",
                        "publicationOperationId",
                        "entryId",
                        "assetId",
                        "outputSourceRef",
                        "modelIdentity",
                        "request",
                    ]
                    .contains(&key.as_str())
                })
        }) && plan["version"].as_u64() == Some(1)
            && same(&plan["scope"], &job["scope"])
            && same(&source["scope"], &job["scope"])
            && plan["anchorOperationId"] == job["operationId"]
            && plan["publicationOperationId"] == source["operationId"]
            && same(&plan["outputSourceRef"], &source["ref"])
            && source["ref"]["sourceVersion"].as_u64() == Some(1)
            && same(&source["assetRefs"], &json!([plan["assetId"]]))
            && [
                "anchorOperationId",
                "publicationOperationId",
                "entryId",
                "assetId",
            ]
            .iter()
            .all(|key| plan[*key].as_str().is_some_and(|id| assert_id(id).is_ok()))
            && source["blocks"].as_array().is_some_and(|blocks| {
                blocks.len() == 1
                    && blocks[0]["kind"] == "message"
                    && blocks[0].get("speakerId").is_none()
            });
    }
    if job["kind"] == "news"
        && source["kind"] == "news"
        && same(&source["scope"], &job["scope"])
        && source["ref"]["sourceVersion"].as_u64() == Some(1)
    {
        let Some(raw) = job["configFingerprint"]
            .as_str()
            .and_then(|value| value.strip_prefix("core2-news-plan-v1:"))
        else {
            return false;
        };
        let Ok(plan) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        return plan["version"].as_u64() == Some(1)
            && same(&plan["scope"], &job["scope"])
            && plan["anchorOperationId"] == job["operationId"]
            && plan["publicationOperationId"] == source["operationId"]
            && same(&plan["outputSourceRef"], &source["ref"])
            && source["blocks"].as_array().is_some_and(|blocks| {
                blocks
                    .iter()
                    .all(|block| block["kind"] == "message" && block.get("speakerId").is_none())
            });
    }
    if job["kind"] != "courier"
        || !same(&source["scope"], &job["scope"])
        || source["ref"]["sourceVersion"].as_u64() != Some(1)
        || source["blocks"]
            .as_array()
            .is_none_or(|rows| rows.len() != 1)
    {
        return false;
    }
    let Some(fingerprint) = job["configFingerprint"].as_str() else {
        return false;
    };
    for (prefix, anchor, kind) in [
        ("core2-phone-plan-v1:", "playerOperationId", "courier"),
        ("core2-moment-plan-v1:", "postOperationId", "moment"),
        ("core2-proactive-plan-v1:", "anchorOperationId", "courier"),
    ] {
        let Some(raw) = fingerprint.strip_prefix(prefix) else {
            continue;
        };
        let Ok(plan) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        return plan["version"].as_u64() == Some(1)
            && plan["npcId"].is_string()
            && same(&plan["scope"], &job["scope"])
            && plan[anchor] == job["operationId"]
            && source["kind"] == kind
            && source["operationId"] == plan["replyOperationId"]
            && same(&source["ref"], &plan["outputSourceRef"])
            && source["blocks"][0]["kind"] == "message"
            && source["blocks"][0]["speakerId"] == plan["npcId"];
    }
    false
}
fn fields(value: &Value, expected: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("CORE2_INVALID_IMPORT")?;
    ensure(
        object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key)),
        "CORE2_INVALID_IMPORT",
    )
}
pub(crate) fn scoped(scope: &Value, id: &Value) -> Result<String, String> {
    Ok(format!("{}/{}", scope_key(scope)?, text(id)?))
}
pub(crate) fn entity(record: &Value) -> Result<String, String> {
    Ok(format!(
        "{}/{}",
        text(&record["domain"])?,
        text(&record["entityId"])?
    ))
}
pub(crate) fn event_scope(event: &Value) -> Value {
    json!({"journeyId":event["journeyId"],"branchId":event["branchId"]})
}
fn sorted_ids(values: &[Value]) -> Vec<Value> {
    let mut result = values.to_vec();
    result.sort_by(|a, b| a.as_str().unwrap().cmp(b.as_str().unwrap()));
    result
}

fn own_import(value: &Value) -> Result<(), String> {
    let validate = || -> Result<(), String> {
        stable_json(value)?;
        fields(
            value,
            &[
                "manifest",
                "branches",
                "sources",
                "events",
                "operations",
                "memories",
                "knowledge",
                "commitments",
                "jobs",
                "snapshots",
                "slots",
                "assets",
            ],
        )?;
        checked("manifest", &value["manifest"])?;
        for key in [
            "branches",
            "sources",
            "events",
            "operations",
            "memories",
            "knowledge",
            "commitments",
            "jobs",
            "snapshots",
            "slots",
            "assets",
        ] {
            ensure(value[key].is_array(), "CORE2_INVALID_IMPORT")?;
        }
        for row in rows(value, "branches") {
            fields(
                row,
                if row.get("originSnapshotId").is_some() {
                    &["playerId", "state", "originSnapshotId"]
                } else {
                    &["playerId", "state"]
                },
            )?;
            checked("snapshot", &row["state"])?;
            assert_id(text(&row["playerId"])?)?;
            if let Some(id) = row.get("originSnapshotId") {
                assert_id(text(id)?)?;
            }
        }
        for (key, kind) in [
            ("sources", "source"),
            ("memories", "memory"),
            ("knowledge", "knowledge"),
            ("commitments", "commitment"),
            ("jobs", "job"),
        ] {
            for row in rows(value, key) {
                let keys: &[&str] = if kind == "memory" {
                    &["record", "commitSeq", "publishedRevision"]
                } else if kind == "job" {
                    if row.get("publication").is_some() {
                        &["record", "commitSeq", "leaseIds", "publication"]
                    } else {
                        &["record", "commitSeq", "leaseIds"]
                    }
                } else {
                    &["record", "commitSeq"]
                };
                fields(row, keys)?;
                checked(kind, &row["record"])?;
                if row["commitSeq"].is_null() {
                    ensure(kind == "source", "CORE2_INVALID_IMPORT")?;
                } else {
                    integer(&row["commitSeq"])?;
                }
            }
        }
        for (key, kind) in [
            ("events", "event"),
            ("operations", "operation"),
            ("snapshots", "snapshotRecord"),
            ("slots", "saveSlot"),
        ] {
            for row in rows(value, key) {
                checked(kind, row)?;
            }
        }
        for asset in rows(value, "assets") {
            checked_asset(asset)?;
        }
        Ok(())
    };
    validate().map_err(|_| "CORE2_INVALID_IMPORT".into())
}

struct Bound {
    scope: Value,
    seq: u64,
    revision: u64,
}
struct Graph<'a> {
    value: &'a Value,
    branches: BTreeMap<String, &'a Value>,
    snapshots: BTreeMap<String, &'a Value>,
    events: BTreeMap<String, &'a Value>,
    sources: BTreeMap<String, &'a Value>,
    operations: BTreeMap<String, &'a Value>,
}
fn unique_map<'a>(
    values: &'a [Value],
    key: impl Fn(&Value) -> Result<String, String>,
) -> Result<BTreeMap<String, &'a Value>, String> {
    let mut map = BTreeMap::new();
    for row in values {
        ensure(
            map.insert(key(row)?, row).is_none(),
            "CORE2_IMPORT_DUPLICATE_ID",
        )?;
    }
    Ok(map)
}
impl<'a> Graph<'a> {
    fn new(value: &'a Value) -> Result<Self, String> {
        Ok(Self {
            value,
            branches: unique_map(rows(value, "branches"), |row| {
                scope_key(&row["state"]["head"]["scope"])
            })?,
            snapshots: unique_map(rows(value, "snapshots"), |row| {
                Ok(text(&row["snapshotId"])?.into())
            })?,
            events: unique_map(rows(value, "events"), |row| {
                Ok(text(&row["eventId"])?.into())
            })?,
            sources: unique_map(rows(value, "sources"), |row| {
                source_key(&row["record"]["ref"])
            })?,
            operations: unique_map(rows(value, "operations"), |row| {
                scoped(&row["scope"], &row["operationId"])
            })?,
        })
    }
    fn branch(&self, scope: &Value) -> Result<&'a Value, String> {
        self.branches
            .get(&scope_key(scope)?)
            .copied()
            .ok_or("CORE2_IMPORT_LINEAGE".into())
    }
    fn path(
        &self,
        scope: &Value,
        seq: Option<u64>,
        revision: Option<u64>,
    ) -> Result<Vec<Bound>, String> {
        let mut row = self.branch(scope)?;
        let mut seq = seq.unwrap_or(integer(&row["state"]["head"]["coreSeq"])?);
        let mut revision = revision.unwrap_or(integer(&row["state"]["head"]["memoryRevision"])?);
        let mut path = Vec::new();
        let mut seen = BTreeSet::new();
        loop {
            let head = &row["state"]["head"];
            ensure(
                head["scope"]["journeyId"] == self.value["manifest"]["scope"]["journeyId"]
                    && seen.insert(scope_key(&head["scope"])?)
                    && seq <= integer(&head["coreSeq"])?
                    && revision <= integer(&head["memoryRevision"])?,
                "CORE2_IMPORT_LINEAGE",
            )?;
            path.push(Bound {
                scope: head["scope"].clone(),
                seq,
                revision,
            });
            let Some(parent) = head.get("parent") else {
                return Ok(path);
            };
            seq = seq.min(integer(&head["forkSeq"])?);
            revision = revision.min(integer(&head["forkMemoryRevision"])?);
            row = self.branch(parent)?;
        }
    }
    fn positioned(
        &self,
        scope: &Value,
        seq: &Value,
        revision: Option<&Value>,
    ) -> Result<(), String> {
        let head = &self.branch(scope)?["state"]["head"];
        ensure(
            integer(seq)? <= integer(&head["coreSeq"])?,
            "CORE2_IMPORT_POSITION",
        )?;
        if let Some(rev) = revision {
            let rev = integer(rev).map_err(|_| "CORE2_IMPORT_POSITION")?;
            ensure(
                rev > 0 && rev <= integer(&head["memoryRevision"])?,
                "CORE2_IMPORT_POSITION",
            )?;
        }
        Ok(())
    }
    fn reachable(
        &self,
        from: &Value,
        seq: u64,
        target: &Value,
        target_seq: u64,
        revision: Option<u64>,
        target_revision: Option<u64>,
    ) -> Result<bool, String> {
        Ok(self.path(from, Some(seq), revision)?.iter().any(|bound| {
            same(&bound.scope, target)
                && target_seq <= bound.seq
                && target_revision.is_none_or(|rev| rev <= bound.revision)
        }))
    }
    fn source_refs(
        &self,
        refs: &[Value],
        scope: &Value,
        seq: u64,
        pending_operation: Option<&Value>,
    ) -> Result<(), String> {
        for reference in refs {
            let source = self
                .sources
                .get(&source_key(reference)?)
                .ok_or("CORE2_IMPORT_SOURCE_NOT_REACHABLE")?;
            let usable = if source["commitSeq"].is_null() {
                pending_operation.is_some_and(|id| {
                    same(scope, &source["record"]["scope"])
                        && *id == source["record"]["operationId"]
                })
            } else {
                self.reachable(
                    scope,
                    seq,
                    &source["record"]["scope"],
                    integer(&source["commitSeq"])?,
                    None,
                    None,
                )?
            };
            ensure(usable, "CORE2_IMPORT_SOURCE_NOT_REACHABLE")?;
        }
        Ok(())
    }
    fn evidence(&self, refs: &[Value], scope: &Value, seq: u64) -> Result<(), String> {
        self.source_refs(
            &refs
                .iter()
                .map(|row| row["ref"].clone())
                .collect::<Vec<_>>(),
            scope,
            seq,
            None,
        )?;
        for evidence in refs {
            let source = self.sources[&source_key(&evidence["ref"])?];
            let matches: Vec<_> = rows(&source["record"], "blocks")
                .iter()
                .filter(|block| block["blockId"] == evidence["blockId"])
                .collect();
            ensure(matches.len() == 1, "CORE2_IMPORT_INVALID_EVIDENCE")?;
            let units: Vec<_> = text(&matches[0]["text"])?.encode_utf16().collect();
            let start = integer(&evidence["start"])? as usize;
            let end = integer(&evidence["end"])? as usize;
            ensure(
                start < end
                    && end <= units.len()
                    && units[start..end]
                        == text(&evidence["quote"])?.encode_utf16().collect::<Vec<_>>(),
                "CORE2_IMPORT_INVALID_EVIDENCE",
            )?;
        }
        Ok(())
    }
    fn event_reachable(&self, id: &Value, scope: &Value, seq: u64) -> Result<bool, String> {
        match self.events.get(text(id)?) {
            None => Ok(false),
            Some(event) => self.reachable(
                scope,
                seq,
                &event_scope(event),
                integer(&event["commitSeq"])?,
                None,
                None,
            ),
        }
    }
    fn memory_parent(&self, row: &Value, reference: &Value) -> Result<&'a Value, String> {
        for parent in rows(self.value, "memories") {
            if parent["record"]["memoryId"] == reference["memoryId"]
                && parent["record"]["version"].as_f64() == reference["version"].as_f64()
                && self.reachable(
                    &row["record"]["scope"],
                    integer(&row["commitSeq"])?,
                    &parent["record"]["scope"],
                    integer(&parent["commitSeq"])?,
                    Some(integer(&row["publishedRevision"])?),
                    Some(integer(&parent["publishedRevision"])?),
                )?
            {
                return Ok(parent);
            }
        }
        Err("CORE2_IMPORT_MEMORY_PROVENANCE".into())
    }
    fn visit_memory(
        &self,
        row: &Value,
        active: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        let key = format!(
            "{}/{}",
            scoped(&row["record"]["scope"], &row["record"]["memoryId"])?,
            integer(&row["record"]["version"])?
        );
        ensure(!active.contains(&key), "CORE2_IMPORT_MEMORY_PROVENANCE")?;
        if done.contains(&key) {
            return Ok(());
        }
        active.insert(key.clone());
        for reference in rows(&row["record"], "memoryRefs") {
            self.visit_memory(self.memory_parent(row, reference)?, active, done)?;
        }
        active.remove(&key);
        done.insert(key);
        Ok(())
    }
    fn validate(&self) -> Result<(), String> {
        let selected = self.branch(&self.value["manifest"]["scope"])?;
        let closure = self.path(&self.value["manifest"]["scope"], None, None)?;
        ensure(
            closure.len() == self.branches.len() && !closure.is_empty(),
            "CORE2_IMPORT_LINEAGE",
        )?;
        for bound in closure {
            let head = &self.branch(&bound.scope)?["state"]["head"];
            ensure(
                integer(&head["coreSeq"])? == bound.seq
                    && integer(&head["memoryRevision"])? == bound.revision,
                "CORE2_IMPORT_LINEAGE_FUTURE",
            )?;
        }
        for (table, id, version) in [
            ("memories", "memoryId", true),
            ("knowledge", "knowledgeId", true),
            ("commitments", "commitmentId", true),
            ("jobs", "jobId", false),
        ] {
            unique_map(rows(self.value, table), |row| {
                Ok(format!(
                    "{}{}",
                    scoped(&row["record"]["scope"], &row["record"][id])?,
                    if version {
                        format!("/{}", integer(&row["record"]["version"])?)
                    } else {
                        String::new()
                    }
                ))
            })?;
        }
        for (table, id) in [("slots", "slotId"), ("assets", "assetId")] {
            unique_map(rows(self.value, table), |row| Ok(text(&row[id])?.into()))?;
        }
        for source in self.sources.values() {
            let record = &source["record"];
            self.branch(&record["scope"])?;
            if let Some(refs) = record.get("assetRefs") {
                ensure(record["kind"] == "image", "CORE2_IMPORT_IMAGE_ASSET")?;
                let mut seen = BTreeSet::new();
                for id in refs.as_array().unwrap() {
                    ensure(
                        seen.insert(text(id)?)
                            && rows(self.value, "assets").iter().any(|asset| {
                                asset["assetId"] == *id && same(&asset["scope"], &record["scope"])
                            }),
                        "CORE2_IMPORT_IMAGE_ASSET",
                    )?;
                }
            }
            if let Some(citations) = record.get("publicCitations") {
                ensure(record["kind"] == "news", "CORE2_IMPORT_NEWS_CITATION")?;
                let cutoff = if source["commitSeq"].is_null() {
                    integer(&self.branch(&record["scope"])?["state"]["head"]["coreSeq"])?
                } else {
                    integer(&source["commitSeq"])?.saturating_sub(1)
                };
                let mut cited_blocks = BTreeSet::new();
                for citation in citations.as_array().unwrap() {
                    ensure(
                        cited_blocks.insert(text(&citation["blockId"])?),
                        "CORE2_IMPORT_NEWS_CITATION",
                    )?;
                    ensure(
                        rows(record, "blocks")
                            .iter()
                            .any(|block| block["blockId"] == citation["blockId"]),
                        "CORE2_IMPORT_NEWS_CITATION",
                    )?;
                    for id in citation["eventIds"].as_array().unwrap() {
                        let event = self
                            .events
                            .get(text(id)?)
                            .ok_or("CORE2_IMPORT_NEWS_CITATION")?;
                        let event_type = text(&event["type"])?;
                        ensure(
                            self.event_reachable(id, &record["scope"], cutoff)?
                                && event["visibility"]["kind"] == "public"
                                && event_type != "turn.complete"
                                && !["communication.", "player.", "publication."]
                                    .iter()
                                    .any(|prefix| event_type.starts_with(prefix)),
                            "CORE2_IMPORT_NEWS_CITATION",
                        )?;
                    }
                }
            }
            unique_map(rows(record, "blocks"), |row| {
                Ok(text(&row["blockId"])?.into())
            })
            .map_err(|_| "CORE2_IMPORT_INVALID_SOURCE")?;
            if !source["commitSeq"].is_null() {
                self.positioned(&record["scope"], &source["commitSeq"], None)?;
            }
            let version = integer(&record["ref"]["sourceVersion"])?;
            if version > 1 {
                let previous = self
                    .sources
                    .get(&source_key(
                        &json!({"sourceId":record["ref"]["sourceId"],"sourceVersion":version-1}),
                    )?)
                    .ok_or("CORE2_IMPORT_INVALID_SOURCE")?;
                ensure(
                    same(&record["scope"], &previous["record"]["scope"])
                        && record["kind"] == previous["record"]["kind"],
                    "CORE2_IMPORT_INVALID_SOURCE",
                )?;
            }
            if source["commitSeq"].as_f64() != Some(0.0) {
                let operation = self
                    .operations
                    .get(&scoped(&record["scope"], &record["operationId"])?);
                if let Some(operation) = operation {
                    ensure(
                        source["commitSeq"].is_null()
                            || operation["status"] == "committed"
                                && operation["receipt"]["coreSeq"].as_f64()
                                    == source["commitSeq"].as_f64(),
                        "CORE2_IMPORT_SOURCE_POSITION",
                    )?;
                } else {
                    ensure(
                        source["commitSeq"].is_null()
                            && same(&record["scope"], &self.value["manifest"]["scope"])
                            && rows(self.value, "jobs")
                                .iter()
                                .any(|row| registered_staged_source(record, &row["record"])),
                        "CORE2_IMPORT_SOURCE_POSITION",
                    )?;
                }
            }
        }
        let mut effects = Vec::new();
        for event in self.events.values() {
            let scope = event_scope(event);
            let seq = integer(&event["commitSeq"])?;
            self.positioned(&scope, &event["commitSeq"], None)?;
            self.evidence(rows(event, "evidenceRefs"), &scope, seq)?;
            if let Some(id) = event.get("replyToEventId") {
                ensure(
                    seq > 0 && self.event_reachable(id, &scope, seq.saturating_sub(1))?,
                    "CORE2_IMPORT_REPLY_PROVENANCE",
                )?;
            }
            let op = self
                .operations
                .get(&scoped(&scope, &event["operationId"])?)
                .ok_or("CORE2_IMPORT_RECEIPT")?;
            ensure(
                op["status"] == "committed"
                    && op["receipt"]["coreSeq"].as_f64() == Some(seq as f64)
                    && rows(&op["receipt"], "eventIds").contains(&event["eventId"]),
                "CORE2_IMPORT_RECEIPT",
            )?;
            for change in rows(event, "committedChanges") {
                effects.push((scope.clone(), seq, change["effectKey"].clone()));
            }
        }
        for (i, (scope, seq, key)) in effects.iter().enumerate() {
            for (j, (target, target_seq, target_key)) in effects.iter().enumerate() {
                if i != j && key == target_key {
                    ensure(
                        !self.reachable(scope, *seq, target, *target_seq, None, None)?,
                        "CORE2_IMPORT_EFFECT_REPLAY",
                    )?;
                }
            }
        }
        for operation in self.operations.values() {
            let head = &self.branch(&operation["scope"])?["state"]["head"];
            let seq = operation
                .get("receipt")
                .map(|r| integer(&r["coreSeq"]))
                .transpose()?
                .unwrap_or(integer(&head["coreSeq"])?);
            self.source_refs(
                rows(operation, "sourceRefs"),
                &operation["scope"],
                seq,
                if operation["status"] == "committed" {
                    None
                } else {
                    Some(&operation["operationId"])
                },
            )?;
            if operation["status"] != "committed" {
                ensure(operation.get("receipt").is_none(), "CORE2_IMPORT_RECEIPT")?;
                continue;
            }
            let receipt = operation.get("receipt").ok_or("CORE2_IMPORT_RECEIPT")?;
            ensure(
                ["committed", "already_committed"].contains(&receipt["status"].as_str().unwrap())
                    && receipt["operationId"] == operation["operationId"]
                    && same(&receipt["scope"], &operation["scope"]),
                "CORE2_IMPORT_RECEIPT",
            )?;
            self.positioned(&operation["scope"], &receipt["coreSeq"], None)?;
            let own_events: Vec<_> = self
                .events
                .values()
                .filter(|e| {
                    e["operationId"] == operation["operationId"]
                        && e["branchId"] == operation["scope"]["branchId"]
                })
                .collect();
            let event_ids: Vec<_> = own_events.iter().map(|e| e["eventId"].clone()).collect();
            let effect_ids: Vec<_> = own_events
                .iter()
                .flat_map(|e| {
                    rows(e, "committedChanges")
                        .iter()
                        .map(|change| change["effectKey"].clone())
                })
                .collect();
            ensure(
                sorted_ids(rows(receipt, "eventIds")) == sorted_ids(&event_ids)
                    && sorted_ids(rows(operation, "effects")) == sorted_ids(&effect_ids)
                    && rows(receipt, "eventIds")
                        .iter()
                        .map(|id| id.as_str().unwrap())
                        .collect::<BTreeSet<_>>()
                        .len()
                        == rows(receipt, "eventIds").len()
                    && rows(operation, "effects")
                        .iter()
                        .map(|id| id.as_str().unwrap())
                        .collect::<BTreeSet<_>>()
                        .len()
                        == rows(operation, "effects").len(),
                "CORE2_IMPORT_RECEIPT",
            )?;
            for id in rows(receipt, "jobIds") {
                ensure(
                    rows(self.value, "jobs").iter().any(|job| {
                        job["record"]["jobId"] == *id
                            && same(&job["record"]["scope"], &operation["scope"])
                            && job["record"]["operationId"] == operation["operationId"]
                    }),
                    "CORE2_IMPORT_RECEIPT",
                )?;
            }
        }
        for row in rows(self.value, "knowledge") {
            self.positioned(&row["record"]["scope"], &row["commitSeq"], None)?;
            self.evidence(
                rows(&row["record"], "evidenceRefs"),
                &row["record"]["scope"],
                integer(&row["commitSeq"])?,
            )?;
            ensure(
                self.event_reachable(
                    &row["record"]["eventId"],
                    &row["record"]["scope"],
                    integer(&row["commitSeq"])?,
                )?,
                "CORE2_IMPORT_KNOWLEDGE_PROVENANCE",
            )?;
        }
        for row in rows(self.value, "commitments") {
            self.positioned(&row["record"]["scope"], &row["commitSeq"], None)?;
            ensure(
                self.event_reachable(
                    &row["record"]["establishedEventId"],
                    &row["record"]["scope"],
                    integer(&row["commitSeq"])?,
                )?,
                "CORE2_IMPORT_COMMITMENT_PROVENANCE",
            )?;
            for history in rows(&row["record"], "history") {
                ensure(
                    self.event_reachable(
                        &history["eventId"],
                        &row["record"]["scope"],
                        integer(&row["commitSeq"])?,
                    )?,
                    "CORE2_IMPORT_COMMITMENT_PROVENANCE",
                )?;
            }
        }
        for row in rows(self.value, "memories") {
            self.positioned(
                &row["record"]["scope"],
                &row["commitSeq"],
                Some(&row["publishedRevision"]),
            )?;
            self.source_refs(
                rows(&row["record"], "sourceRefs"),
                &row["record"]["scope"],
                integer(&row["commitSeq"])?,
                None,
            )
            .map_err(|_| "CORE2_IMPORT_MEMORY_PROVENANCE")?;
            for id in rows(&row["record"], "eventIds") {
                ensure(
                    self.event_reachable(id, &row["record"]["scope"], integer(&row["commitSeq"])?)?,
                    "CORE2_IMPORT_MEMORY_PROVENANCE",
                )?;
            }
            for reference in rows(&row["record"], "memoryRefs") {
                let parent = self.memory_parent(row, reference)?;
                ensure(
                    !same(&row["record"]["scope"], &parent["record"]["scope"])
                        || integer(&parent["publishedRevision"])?
                            < integer(&row["publishedRevision"])?,
                    "CORE2_IMPORT_MEMORY_PROVENANCE",
                )?;
            }
        }
        let mut visited = BTreeSet::new();
        for row in rows(self.value, "memories") {
            self.visit_memory(row, &mut BTreeSet::new(), &mut visited)?;
        }
        self.validate_jobs()?;
        for snapshot in self.snapshots.values() {
            self.positioned(&snapshot["scope"], &snapshot["coreSeq"], None)?;
            checked_snapshot(snapshot).map_err(|_| "CORE2_IMPORT_SNAPSHOT")?;
            let head = &self.branch(&snapshot["scope"])?["state"]["head"];
            ensure(
                integer(&snapshot["memoryRevision"])? <= integer(&head["memoryRevision"])?
                    && same(&snapshot["state"]["head"]["parent"], &head["parent"])
                    && snapshot["state"]["head"]["forkSeq"].as_f64() == head["forkSeq"].as_f64()
                    && snapshot["state"]["head"]["forkMemoryRevision"].as_f64()
                        == head["forkMemoryRevision"].as_f64(),
                "CORE2_IMPORT_SNAPSHOT",
            )?;
        }
        for branch in self.branches.values() {
            self.validate_state_history(branch)?;
        }
        let chosen = self
            .snapshots
            .get(text(&self.value["manifest"]["snapshotId"])?)
            .ok_or("CORE2_IMPORT_SNAPSHOT")?;
        ensure(
            same(&chosen["scope"], &self.value["manifest"]["scope"])
                && same(&chosen["state"], &selected["state"]),
            "CORE2_IMPORT_SNAPSHOT",
        )?;
        for slot in rows(self.value, "slots") {
            ensure(
                slot["journeyId"] == self.value["manifest"]["scope"]["journeyId"]
                    && self.snapshots.contains_key(text(&slot["snapshotId"])?),
                "CORE2_IMPORT_SLOT",
            )?;
        }
        for asset in rows(self.value, "assets") {
            ensure(
                self.branches.contains_key(&scope_key(&asset["scope"])?),
                "CORE2_IMPORT_ASSET_SCOPE",
            )?;
        }
        for branch in self.branches.values() {
            self.inspect_state(&branch["state"])?;
        }
        for snapshot in self.snapshots.values() {
            self.inspect_state(&snapshot["state"])?;
        }
        Ok(())
    }
    fn validate_jobs(&self) -> Result<(), String> {
        for job in rows(self.value, "jobs") {
            let record = &job["record"];
            let mut current = record;
            let mut chain = BTreeSet::new();
            chain.insert(text(&record["jobId"])?);
            while let Some(next_id) = current.get("retriedByJobId") {
                let next = rows(self.value, "jobs")
                    .iter()
                    .find(|row| {
                        same(&row["record"]["scope"], &current["scope"])
                            && row["record"]["jobId"] == *next_id
                    })
                    .ok_or("CORE2_IMPORT_JOB_RETRY")?;
                ensure(
                    chain.insert(text(&next["record"]["jobId"])?)
                        && next["record"]["retryOfJobId"] == current["jobId"]
                        && ["failed", "cancelled"]
                            .contains(&current["status"].as_str().unwrap_or(""))
                        && ["kind", "operationId", "sourceRefs"]
                            .iter()
                            .all(|field| same(&current[*field], &next["record"][*field])),
                    "CORE2_IMPORT_JOB_RETRY",
                )?;
                current = &next["record"];
            }
            if let Some(previous_id) = record.get("retryOfJobId") {
                let previous = rows(self.value, "jobs")
                    .iter()
                    .find(|row| {
                        same(&row["record"]["scope"], &record["scope"])
                            && row["record"]["jobId"] == *previous_id
                    })
                    .ok_or("CORE2_IMPORT_JOB_RETRY")?;
                ensure(
                    previous["record"]["retriedByJobId"] == record["jobId"]
                        && integer(&previous["commitSeq"])? <= integer(&job["commitSeq"])?,
                    "CORE2_IMPORT_JOB_RETRY",
                )?;
            }
            if let Some(receipt) = record.get("publicationReceipt") {
                ensure(
                    job.get("publication")
                        .and_then(|publication| publication.get("receipt"))
                        .is_some_and(|published| same(receipt, published)),
                    "CORE2_IMPORT_JOB_PUBLICATION",
                )?;
            }
            self.positioned(&record["scope"], &job["commitSeq"], None)?;
            self.source_refs(
                rows(record, "sourceRefs"),
                &record["scope"],
                integer(&job["commitSeq"])?,
                None,
            )?;
            let leases = job["leaseIds"].as_array().ok_or("CORE2_IMPORT_JOB")?;
            let mut seen = BTreeSet::new();
            for lease in leases {
                assert_id(text(lease)?).map_err(|_| "CORE2_IMPORT_JOB")?;
                ensure(seen.insert(text(lease)?), "CORE2_IMPORT_JOB")?;
            }
            ensure(
                record["status"] != "running"
                    && (record["leaseId"].is_null() || leases.contains(&record["leaseId"])),
                "CORE2_IMPORT_JOB",
            )?;
            let operation = self
                .operations
                .get(&scoped(&record["scope"], &record["operationId"])?)
                .ok_or("CORE2_IMPORT_JOB")?;
            ensure(operation["status"] == "committed", "CORE2_IMPORT_JOB")?;
            for step in rows(record, "steps") {
                ensure(
                    step["jobId"] == record["jobId"]
                        && leases.contains(&step["leaseId"])
                        && same(&step["scope"], &record["scope"])
                        && same(&step["sourceRefs"], &record["sourceRefs"]),
                    "CORE2_IMPORT_JOB",
                )?;
            }
            if let Some(publication) = job.get("publication") {
                let check = || -> Result<(), String> {
                    fields(
                        publication,
                        &["leaseId", "fingerprint", "descriptor", "receipt"],
                    )?;
                    fields(
                        &publication["receipt"],
                        &["status", "memoryRevision", "memoryIds"],
                    )?;
                    let receipt = &publication["receipt"];
                    let ids = receipt["memoryIds"]
                        .as_array()
                        .ok_or("CORE2_IMPORT_JOB_PUBLICATION")?;
                    let mut seen = BTreeSet::new();
                    for id in ids {
                        assert_id(text(id)?)?;
                        ensure(seen.insert(text(id)?), "CORE2_IMPORT_JOB_PUBLICATION")?;
                    }
                    integer(&receipt["memoryRevision"])?;
                    let additions: Vec<_> = rows(self.value, "memories")
                        .iter()
                        .filter(|row| {
                            same(&row["record"]["scope"], &record["scope"])
                                && row["publishedRevision"].as_f64()
                                    == receipt["memoryRevision"].as_f64()
                                && ids.contains(&row["record"]["memoryId"])
                        })
                        .map(|row| row["record"].clone())
                        .collect();
                    ensure(additions.len() == ids.len(), "CORE2_IMPORT_JOB_PUBLICATION")?;
                    let mut ordered = Vec::new();
                    for id in ids {
                        ordered.push(
                            additions
                                .iter()
                                .find(|row| row["memoryId"] == *id)
                                .ok_or("CORE2_IMPORT_JOB_PUBLICATION")?
                                .clone(),
                        );
                    }
                    let descriptor = &publication["descriptor"];
                    let mut patch = descriptor.clone();
                    patch
                        .as_object_mut()
                        .ok_or("CORE2_IMPORT_JOB_PUBLICATION")?
                        .insert("additions".into(), json!(ordered));
                    checked("derived", &patch)?;
                    ensure(
                        receipt["status"] == "published"
                            && leases.contains(&publication["leaseId"])
                            && same(&descriptor["scope"], &record["scope"])
                            && descriptor["jobId"] == record["jobId"]
                            && descriptor["leaseId"] == publication["leaseId"]
                            && same(&descriptor["sourceRefs"], &record["sourceRefs"])
                            && publication["fingerprint"]
                                == checksum_bytes(stable_json(&patch)?.as_bytes()),
                        "CORE2_IMPORT_JOB_PUBLICATION",
                    )?;
                    Ok(())
                };
                check().map_err(|_| "CORE2_IMPORT_JOB_PUBLICATION")?;
            }
        }
        Ok(())
    }
    fn validate_state_history(&self, branch: &Value) -> Result<(), String> {
        let head = &branch["state"]["head"];
        let scope = &head["scope"];
        let mut seen = BTreeSet::new();
        for record in rows(&branch["state"], "records").iter().chain(
            branch["state"]
                .get("tombstones")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        ) {
            ensure(seen.insert(entity(record)?), "CORE2_IMPORT_STATE")?;
        }
        ensure(
            rows(&branch["state"], "records")
                .iter()
                .any(|row| row["domain"] == "traveler" && row["entityId"] == branch["playerId"]),
            "CORE2_IMPORT_STATE",
        )?;
        let baseline = if head.get("parent").is_some() {
            let baseline = self
                .snapshots
                .get(text(&branch["originSnapshotId"]).map_err(|_| "CORE2_IMPORT_LINEAGE")?)
                .copied()
                .ok_or("CORE2_IMPORT_LINEAGE")?;
            ensure(
                same(&baseline["scope"], &head["parent"])
                    && baseline["coreSeq"].as_f64() == head["forkSeq"].as_f64()
                    && baseline["memoryRevision"].as_f64() == head["forkMemoryRevision"].as_f64(),
                "CORE2_IMPORT_LINEAGE",
            )?;
            baseline
        } else {
            self.snapshots
                .values()
                .copied()
                .find(|row| {
                    same(&row["scope"], scope)
                        && row["coreSeq"].as_f64() == Some(0.0)
                        && row["memoryRevision"].as_f64() == Some(0.0)
                })
                .ok_or("CORE2_IMPORT_BASELINE")?
        };
        let mut state: BTreeMap<String, (Value, u64)> = BTreeMap::new();
        for record in rows(&baseline["state"], "records") {
            let mut record = record.clone();
            record["scope"] = scope.clone();
            state.insert(
                entity(&record)?,
                (record.clone(), integer(&record["version"])?),
            );
        }
        if let Some(refs) = baseline["state"].get("tombstones") {
            for reference in refs.as_array().unwrap() {
                state.insert(
                    entity(reference)?,
                    (Value::Null, integer(&reference["version"])?),
                );
            }
        }
        let mut sequence = head.get("forkSeq").map(integer).transpose()?.unwrap_or(0);
        let projection = |values: &BTreeMap<String, (Value, u64)>| -> Value {
            let records: Vec<_> = values
                .values()
                .filter(|(record, _)| !record.is_null())
                .map(|(record, _)| record.clone())
                .collect();
            let tombstones: Vec<_> = values
                .iter()
                .filter(|(_, (record, _))| record.is_null())
                .map(|(key, (_, version))| {
                    let (domain, id) = key.split_once('/').unwrap();
                    json!({"domain":domain,"entityId":id,"version":version})
                })
                .collect();
            json!({"records":records,"tombstones":tombstones,"contentRefs":baseline["state"]["contentRefs"]})
        };
        let normalize = |snapshot: &Value| -> Result<Value, String> {
            let mut records = rows(snapshot, "records").clone();
            records.sort_by_key(|row| entity(row).unwrap());
            let mut tombstones = snapshot
                .get("tombstones")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            tombstones.sort_by_key(|row| entity(row).unwrap());
            Ok(
                json!({"records":records,"tombstones":tombstones,"contentRefs":snapshot["contentRefs"]}),
            )
        };
        let check_snapshots =
            |seq: u64, state: &BTreeMap<String, (Value, u64)>| -> Result<(), String> {
                for snapshot in self.snapshots.values().filter(|row| {
                    same(&row["scope"], scope) && row["coreSeq"].as_f64() == Some(seq as f64)
                }) {
                    ensure(
                        same(&normalize(&snapshot["state"])?, &projection(state)),
                        "CORE2_IMPORT_SNAPSHOT_STATE",
                    )?;
                }
                Ok(())
            };
        check_snapshots(sequence, &state)?;
        let mut operations: Vec<_> = self
            .operations
            .values()
            .filter(|op| same(&op["scope"], scope) && op["status"] == "committed")
            .collect();
        operations.sort_by_key(|op| integer(&op["receipt"]["coreSeq"]).unwrap());
        ensure(
            operations.len() as u64 == integer(&head["coreSeq"])? - sequence,
            "CORE2_IMPORT_COMMIT_GAP",
        )?;
        for operation in operations {
            sequence += 1;
            ensure(
                integer(&operation["receipt"]["coreSeq"])? == sequence,
                "CORE2_IMPORT_COMMIT_GAP",
            )?;
            for read in rows(operation, "readSet") {
                ensure(
                    state.get(&entity(read)?).map_or(0, |(_, version)| *version)
                        == integer(&read["version"])?,
                    "CORE2_IMPORT_STATE_HISTORY",
                )?;
            }
            let changes: Vec<_> = self
                .events
                .values()
                .filter(|event| {
                    event["operationId"] == operation["operationId"]
                        && event["branchId"] == scope["branchId"]
                })
                .flat_map(|event| rows(event, "committedChanges"))
                .collect();
            let mut seen = BTreeSet::new();
            for change in changes {
                let key = entity(&change["ref"])?;
                ensure(seen.insert(key.clone()), "CORE2_IMPORT_STATE_HISTORY")?;
                let current = state.get(&key);
                let before = current.map_or(&Value::Null, |(record, _)| record);
                let version = integer(&change["ref"]["version"])?;
                ensure(
                    rows(operation, "readSet")
                        .iter()
                        .any(|read| same(read, &change["ref"]))
                        && same(before, &change["before"])
                        && current.map_or(0, |(_, version)| *version) == version,
                    "CORE2_IMPORT_STATE_HISTORY",
                )?;
                if !change["after"].is_null() {
                    ensure(
                        integer(&change["after"]["version"])? == version + 1
                            && entity(&change["after"])? == key
                            && same(&change["after"]["scope"], scope),
                        "CORE2_IMPORT_STATE_HISTORY",
                    )?;
                }
                state.insert(key, (change["after"].clone(), version + 1));
            }
            check_snapshots(sequence, &state)?;
        }
        ensure(
            same(&normalize(&branch["state"])?, &projection(&state)),
            "CORE2_IMPORT_STATE_HISTORY",
        )
    }
    fn inspect_state(&self, state: &Value) -> Result<(), String> {
        let scope = &state["head"]["scope"];
        let seq = integer(&state["head"]["coreSeq"])?;
        let has_asset = |id: &Value| {
            rows(self.value, "assets")
                .iter()
                .any(|asset| asset["assetId"] == *id)
        };
        for record in rows(state, "records") {
            let value = &record["value"];
            if ["traveler", "npc"].contains(&record["domain"].as_str().unwrap()) {
                let mut links = vec![
                    &value["头像"],
                    &value["avatar"],
                    &value["visualArchive"]["profileImage"],
                    &value["visualArchive"]["fullPortrait"],
                ];
                if let Some(slots) = value["visualArchive"]["slotImages"].as_object() {
                    links.extend(slots.values());
                }
                if let Some(parts) = value["matureArchive"]["partImages"].as_object() {
                    links.extend(parts.values());
                }
                for link in links {
                    if let Some(id) = link.as_str().and_then(|link| link.strip_prefix("asset:")) {
                        ensure(has_asset(&json!(id)), "CORE2_IMPORT_ASSET_MISSING")?;
                    }
                }
            }
            match record["domain"].as_str().unwrap() {
                "album" => {
                    ensure(has_asset(&value["assetId"]), "CORE2_IMPORT_ASSET_MISSING")?;
                    self.source_refs(rows(value, "sourceRefs"), scope, seq, None)?;
                    if let Some(origin) = value.get("phoneOrigin") {
                        let anchor = self
                            .events
                            .get(text(&origin["playerEventId"])?)
                            .ok_or("CORE2_IMPORT_PHONE_PHOTO")?;
                        let player = &self.branch(scope)?["playerId"];
                        ensure(
                            self.event_reachable(&origin["playerEventId"], scope, seq)?
                                && same(&anchor["actorIds"], &json!([player]))
                                && anchor["channelId"] == origin["conversationId"]
                                && ["communication.private", "communication.group"]
                                    .contains(&text(&anchor["type"])?)
                                && rows(anchor, "targetIds").contains(&origin["npcId"])
                                && value["kind"] == "character"
                                && same(&value["npcIds"], &json!([origin["npcId"]])),
                            "CORE2_IMPORT_PHONE_PHOTO",
                        )?;
                        let mut replied = false;
                        for reply in self.events.values() {
                            if reply["replyToEventId"] == origin["playerEventId"]
                                && reply["channelId"] == origin["conversationId"]
                                && reply["type"] == anchor["type"]
                                && same(&reply["actorIds"], &json!([origin["npcId"]]))
                                && self.event_reachable(&reply["eventId"], scope, seq)?
                            {
                                replied = true;
                                break;
                            }
                        }
                        ensure(replied, "CORE2_IMPORT_PHONE_PHOTO")?;
                    }
                }
                "news" => {
                    self.source_refs(&[value["sourceRef"].clone()], scope, seq, None)?;
                    for id in rows(value, "eventIds") {
                        ensure(
                            self.event_reachable(id, scope, seq)?,
                            "CORE2_IMPORT_STATE_PROVENANCE",
                        )?;
                    }
                }
                "courier" if value["kind"] == "contact" => {
                    if let Some(id) = value.get("avatarAssetId") {
                        ensure(has_asset(id), "CORE2_IMPORT_ASSET_MISSING")?;
                    }
                }
                "courier" if value["kind"] == "moment" => {
                    self.source_refs(&[value["sourceRef"].clone()], scope, seq, None)?;
                    for id in rows(value, "imageAssetIds") {
                        ensure(has_asset(id), "CORE2_IMPORT_ASSET_MISSING")?;
                    }
                }
                _ => (),
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_import(value: &Value) -> Result<Value, String> {
    own_import(value)?;
    let graph = Graph::new(value)?;
    graph.validate()?;
    Ok(graph.branch(&value["manifest"]["scope"])?["state"]["head"].clone())
}
