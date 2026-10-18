use crate::core2_store::{checksum_bytes, BlockRef, FaultPoint, LockedStore, RowChange, TableRow};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static NEXT: AtomicU64 = AtomicU64::new(0);
#[test]
fn core2_single_row_read_does_not_decode_two_hundred_unrelated_payloads() {
    let dir = FixtureDir::new();
    {
        let store = LockedStore::open(&dir.path).unwrap();
        let changes = (0..200)
            .map(|index| {
                row(
                    &format!("event-{index:04}"),
                    &format!("{{\"text\":\"{}\"}}", "story".repeat(200)),
                )
            })
            .collect();
        store.apply_rows(0, changes).unwrap();
    }
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    crate::core2_store::take_io_profile();
    assert!(store
        .get_row(&view, "events", "event-0199")
        .unwrap()
        .is_some());
    let metrics = crate::core2_store::take_io_profile();
    assert_eq!(metrics["row_json_checks"], 1.0, "only the returned row payload is needed; page structure and checksum still cover the full page");
}
#[test]
fn core2_lazy_payload_checks_never_return_poisoned_or_invalid_json_rows() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let rows = vec![
        TableRow {
            key: "event-0000".into(),
            value_json: "{\"ok\":true}".into(),
        },
        TableRow {
            key: "event-0001".into(),
            value_json: "{\"constructor\":{}}".into(),
        },
        TableRow {
            key: "event-0002".into(),
            value_json: "not json".into(),
        },
    ];
    let page = store
        .write_binary(&serde_json::to_vec(&rows).unwrap())
        .unwrap();
    let root = serde_json::json!({"pages":[{"first":"event-0000","last":"event-0002","count":3,"block":page}]});
    let view = store
        .publish(
            0,
            BTreeMap::from([("events".into(), serde_json::to_vec(&root).unwrap())]),
        )
        .unwrap();
    assert!(store
        .get_row(&view, "events", "event-0000")
        .unwrap()
        .is_some());
    for key in ["event-0001", "event-0002"] {
        assert!(store
            .get_row(&view, "events", key)
            .unwrap_err()
            .contains("CORE2_INVALID_ROW_JSON"));
    }
    assert_eq!(
        store
            .scan_rows(&view, "events", "event-", None, 1)
            .unwrap()
            .len(),
        1
    );
    assert!(store
        .scan_rows(&view, "events", "event-", None, 3)
        .unwrap_err()
        .contains("CORE2_INVALID_ROW_JSON"));
}
#[test]
fn core2_same_transaction_does_not_decode_an_unchanged_branch_record_three_times() {
    use crate::core2_repository::{self as repo, CoreFileTransaction};
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let mut tx = CoreFileTransaction::open(&dir.path).unwrap();
    let scope = &seed["head"]["scope"];
    let key = repo::scope_key(scope).unwrap();
    let mut first = tx.get("branches", &key).unwrap().unwrap();
    first["playerId"] = serde_json::json!("caller-mutation");
    let second = tx.get("branches", &key).unwrap().unwrap();
    assert_ne!(second["playerId"], first["playerId"]);
    assert_eq!(tx.get("branches", &key).unwrap().unwrap(), second);
    assert_eq!(
        tx.record_decode_count(),
        1,
        "an immutable row inside the same locked transaction should be parsed once"
    );
    let mut updated = second.clone();
    updated["playerId"] = serde_json::json!("pending-edit");
    tx.put("branches", key.clone(), updated.clone()).unwrap();
    assert_eq!(tx.get("branches", &key).unwrap().unwrap(), updated);
    tx.delete("branches", key.clone());
    assert!(tx.get("branches", &key).unwrap().is_none());
}
#[test]
fn core2_manifest_checked_table_root_is_not_read_from_disk_again_in_the_same_lock() {
    let dir = FixtureDir::new();
    {
        let store = LockedStore::open(&dir.path).unwrap();
        store
            .apply_rows(0, vec![row("event-0001", "{\"turn\":1}")])
            .unwrap();
    }
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    let checked = store.block_read_count();
    assert!(store
        .get_row(&view, "events", "event-0001")
        .unwrap()
        .is_some());
    assert_eq!(
        store.block_read_count() - checked,
        1,
        "only the previously unchecked leaf page should be read"
    );
}
struct FixtureDir {
    path: PathBuf,
    parent: PathBuf,
}
impl FixtureDir {
    fn new() -> Self {
        let parent = fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = parent.join(format!(
            "core2-file-tests-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self { path, parent }
    }
}
impl Drop for FixtureDir {
    fn drop(&mut self) {
        if let Ok(actual) = fs::canonicalize(&self.path) {
            if actual.starts_with(&self.parent)
                && actual != self.parent
                && self
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("core2-file-tests-")
            {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
}
fn updates(text: &str) -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([("states".into(), text.as_bytes().to_vec())])
}

fn row(key: &str, value: &str) -> RowChange {
    RowChange {
        store: "events".into(),
        key: key.into(),
        value_json: Some(value.into()),
    }
}

#[test]
fn core2_paged_append_preserves_sealed_pages_and_old_views() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let first = store
        .apply_rows(
            0,
            (0..501)
                .map(|i| row(&format!("event-{i:04}"), &format!("{{\"turn\":{i}}}")))
                .collect(),
        )
        .unwrap();
    let root = store.table_root(&first, "events").unwrap();
    assert_eq!(
        root.pages.iter().map(|p| p.count).collect::<Vec<_>>(),
        vec![200, 200, 101]
    );
    for page in &root.pages {
        let rows: Vec<TableRow> =
            serde_json::from_slice(&store.read_block(&page.block).unwrap()).unwrap();
        assert!(rows.len() <= 200);
    }
    assert_eq!(
        store
            .get_row(&first, "events", "event-0420")
            .unwrap()
            .as_deref(),
        Some("{\"turn\":420}")
    );
    let next = store
        .apply_rows(1, vec![row("event-0501", "{\"turn\":501}")])
        .unwrap();
    let next_root = store.table_root(&next, "events").unwrap();
    assert_eq!(next_root.pages[0].block.path, root.pages[0].block.path);
    assert_eq!(next_root.pages[1].block.path, root.pages[1].block.path);
    assert_ne!(next_root.pages[2].block.path, root.pages[2].block.path);
    assert_eq!(store.get_row(&first, "events", "event-0501").unwrap(), None);
    assert_eq!(
        store
            .get_row(&next, "events", "event-0501")
            .unwrap()
            .as_deref(),
        Some("{\"turn\":501}")
    );
}

#[test]
fn core2_single_row_edit_does_not_rewrite_unrelated_history() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let before = store
        .apply_rows(
            0,
            (0..501)
                .map(|i| row(&format!("event-{i:04}"), "0"))
                .collect(),
        )
        .unwrap();
    let old_root = store.table_root(&before, "events").unwrap();
    let after = store.apply_rows(1, vec![row("event-0234", "1")]).unwrap();
    let new_root = store.table_root(&after, "events").unwrap();
    assert_eq!(old_root.pages.len(), 3);
    assert_eq!(new_root.pages.len(), 3);
    assert_eq!(old_root.pages[0].block.path, new_root.pages[0].block.path);
    assert_ne!(old_root.pages[1].block.path, new_root.pages[1].block.path);
    assert_eq!(old_root.pages[2].block.path, new_root.pages[2].block.path);
    assert_eq!(
        store
            .get_row(&before, "events", "event-0234")
            .unwrap()
            .as_deref(),
        Some("0")
    );
    assert_eq!(
        store
            .get_row(&after, "events", "event-0234")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    let encoded = store.read_block(&after.manifest.roots["events"]).unwrap();
    assert!(
        encoded.len() < 1500,
        "table root must contain references, not all rows"
    );
}

#[test]
fn core2_point_lookup_reads_only_the_selected_history_page() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store
        .apply_rows(
            0,
            (0..501)
                .map(|i| row(&format!("event-{i:04}"), "0"))
                .collect(),
        )
        .unwrap();
    let root = store.table_root(&view, "events").unwrap();
    assert_eq!(root.pages.len(), 3);
    fs::write(
        dir.path.join("core2").join(&root.pages[2].block.path),
        b"corrupt unrelated page",
    )
    .unwrap();
    assert_eq!(
        store
            .get_row(&view, "events", "event-0001")
            .unwrap()
            .as_deref(),
        Some("0")
    );
    assert!(store
        .get_row(&view, "events", "event-0500")
        .unwrap_err()
        .contains("checksum"));
}

#[test]
fn core2_bad_row_batches_are_rejected_before_any_blocks_are_written() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    for batch in [
        vec![row("same", "0"), row("same", "1")],
        vec![row("bad", "not-json")],
        vec![row("bad", "{\"__proto__\":{}}")],
        vec![RowChange {
            store: "../foreign".into(),
            key: "a".into(),
            value_json: Some("0".into()),
        }],
    ] {
        assert!(store.apply_rows(0, batch).is_err());
        assert!(store.load().unwrap().is_none());
        assert_eq!(
            fs::read_dir(dir.path.join("core2/blocks")).unwrap().count(),
            0
        );
    }
}

#[test]
fn core2_range_scan_stays_inside_prefix_and_resumes_after_the_last_key() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store
        .apply_rows(
            0,
            (0..501)
                .map(|i| row(&format!("a/{i:04}"), "0"))
                .chain([row("b/0000", "1")])
                .collect(),
        )
        .unwrap();
    let first = store.scan_rows(&view, "events", "a/", None, 200).unwrap();
    assert_eq!(first.len(), 200);
    assert_eq!(first.first().unwrap().key, "a/0000");
    assert_eq!(first.last().unwrap().key, "a/0199");
    let next = store
        .scan_rows(&view, "events", "a/", Some("a/0199"), 200)
        .unwrap();
    assert_eq!(next.len(), 200);
    assert_eq!(next.first().unwrap().key, "a/0200");
    let last = store
        .scan_rows(&view, "events", "a/", Some("a/0399"), 200)
        .unwrap();
    assert_eq!(last.len(), 101);
    assert_eq!(last.last().unwrap().key, "a/0500");
    for limit in [0, 201] {
        assert!(store.scan_rows(&view, "events", "a/", None, limit).is_err());
    }
    assert!(store
        .scan_rows(&view, "events", "a/", Some("b/0000"), 10)
        .is_err());
    let root = store.table_root(&view, "events").unwrap();
    fs::write(
        dir.path.join("core2").join(&root.pages[2].block.path),
        b"corrupt unrelated page",
    )
    .unwrap();
    assert_eq!(
        store
            .scan_rows(&view, "events", "a/", None, 10)
            .unwrap()
            .len(),
        10
    );
}

#[test]
fn core2_paged_faults_leave_a_reconnectable_old_view_at_every_written_block() {
    // Two new leaves, a new table root, then manifest/staged pointer/published pointer.
    for fail_at in 1..=6 {
        let dir = FixtureDir::new();
        {
            let store = LockedStore::open(&dir.path).unwrap();
            store.apply_rows(0, vec![row("a", "0")]).unwrap();
            let seen = std::cell::Cell::new(0);
            let result = store.apply_rows_with_fault(
                1,
                (0..201).map(|i| row(&format!("b/{i:04}"), "1")).collect(),
                |_| {
                    seen.set(seen.get() + 1);
                    if seen.get() == fail_at {
                        Err("injected-paged-write".into())
                    } else {
                        Ok(())
                    }
                },
            );
            assert!(result.unwrap_err().contains("injected-paged-write"));
        }
        let store = LockedStore::open(&dir.path).unwrap();
        let view = store.load().unwrap().unwrap();
        assert_eq!(view.manifest.revision, if fail_at == 6 { 2 } else { 1 });
        assert_eq!(
            store.get_row(&view, "events", "a").unwrap().as_deref(),
            Some("0")
        );
        assert_eq!(
            store.get_row(&view, "events", "b/0200").unwrap().as_deref(),
            if fail_at == 6 { Some("1") } else { None }
        );
    }
}

#[test]
fn core2_delete_and_split_keep_keys_ordered_across_reconnect() {
    let dir = FixtureDir::new();
    {
        let store = LockedStore::open(&dir.path).unwrap();
        store
            .apply_rows(
                0,
                (0..401)
                    .map(|i| row(&format!("key-{:04}", i * 2), "0"))
                    .collect(),
            )
            .unwrap();
        let mut changes: Vec<_> = (0..200)
            .map(|i| row(&format!("key-{:04}", i * 2 + 1), "1"))
            .collect();
        changes.push(RowChange {
            store: "events".into(),
            key: "key-0000".into(),
            value_json: None,
        });
        let view = store.apply_rows(1, changes).unwrap();
        assert_eq!(store.get_row(&view, "events", "key-0000").unwrap(), None);
        let root = store.table_root(&view, "events").unwrap();
        assert!(root.pages.iter().all(|page| page.count <= 200));
        assert_eq!(root.pages.iter().map(|page| page.count).sum::<usize>(), 600);
    }
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    assert_eq!(
        store
            .get_row(&view, "events", "key-0001")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    assert_eq!(
        store
            .get_row(&view, "events", "key-0800")
            .unwrap()
            .as_deref(),
        Some("0")
    );
}

fn seed_fixture() -> serde_json::Value {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../tests/fixtures/core2-native-contract-corpus.json"
    ))
    .unwrap();
    cases[0]["input"].clone()
}
#[test]
fn core2_native_five_thousand_source_page_does_not_materialize_unrelated_original_records() {
    use crate::core2_repository::{self as repo, CoreFileTransaction};
    let dir = FixtureDir::new();
    let mut seed = seed_fixture();
    let base = seed["sources"][0].clone();
    let mut sources = vec![base.clone()];
    sources.extend(
        (0..4999)
            .map(|index| {
                let mut source = base.clone();
                source["ref"]["sourceId"] = serde_json::json!(format!("cold-{index:05}"));
                source["blocks"][0]["text"] =
                    serde_json::json!(format!("原文{index} {}", "长原文".repeat(50)));
                source
            })
            .collect::<Vec<_>>(),
    );
    seed["sources"] = serde_json::json!(sources);
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let tx = CoreFileTransaction::open(&dir.path).unwrap();
    let query = serde_json::json!({"scope":seed["head"]["scope"],"cutoffSeq":0});
    let page = crate::core2_sources::query_sources(&tx, &query).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 50);
    assert_eq!(
        tx.record_read_count("sources"),
        50,
        "cold paging should materialize only the selected original records"
    );
    assert!(tx.record_read_count("sourcePositions") >= 5000);
    assert_eq!(page["items"][0]["ref"]["sourceId"], "cold-00000");
    let mut next = query;
    next["cursor"] = page["nextCursor"].clone();
    let second = crate::core2_sources::query_sources(&tx, &next).unwrap();
    assert_eq!(second["items"][0]["ref"]["sourceId"], "cold-00050");
    assert_eq!(tx.record_read_count("sources"), 100);
}

#[test]
fn core2_same_locked_view_does_not_reread_and_revalidate_the_same_page_for_every_field() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store
        .apply_rows(0, vec![row("event-A", "1"), row("event-Z", "2")])
        .unwrap();
    assert_eq!(
        store
            .get_row(&view, "events", "event-A")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    let reads = store.block_read_count();
    assert_eq!(
        store
            .get_row(&view, "events", "event-Z")
            .unwrap()
            .as_deref(),
        Some("2")
    );
    assert_eq!(
        store.block_read_count(),
        reads,
        "an immutable page already validated while this OS lock is held was reread"
    );
}

#[test]
fn core2_native_recovery_error_retains_the_recovered_revision_and_damage_cause() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let scope = seed["head"]["scope"].clone();
    repo::initialize(&dir.path, seed).unwrap();
    repo::activate_session(&dir.path, scope.clone(), "replacement-session".into()).unwrap();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    let damaged = dir
        .path
        .join("core2")
        .join(&view.manifest.roots["branches"].path);
    drop(store);
    fs::write(damaged, b"broken block").unwrap();
    let error = repo::read_head(&dir.path, scope).unwrap_err();
    assert!(error.contains("CORE2_RECOVERY_REQUIRES_CONFIRMATION"));
    assert!(
        error.contains("revision=1") && error.contains("checksum"),
        "recovery detail lost: {error}"
    );
}

#[test]
#[ignore = "explicitly launched by shared TypeScript contracts with an owned temporary root"]
fn core2_protocol_test_server() {
    use crate::core2_protocol::{dispatch, CoreStoreRequest};
    use std::io::{BufRead, Write};
    let root =
        std::path::PathBuf::from(std::env::var("CORE2_TEST_ROOT").expect("owned fixture root"));
    let root = std::fs::canonicalize(root).unwrap();
    let temp = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    assert!(
        root.starts_with(&temp)
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("core2-rpc-")
    );
    for line in std::io::stdin().lock().lines() {
        let input: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        let started = std::time::Instant::now();
        let request = serde_json::from_value::<CoreStoreRequest>(input["request"].clone());
        let result = request
            .map_err(|e| format!("CORE2_INVALID_REQUEST: {e}"))
            .and_then(|request| {
                if let Some(failure) = input.get("failure") {
                    match request {
                        CoreStoreRequest::ImportPrepared([value]) => {
                            crate::core2_imports::import_prepared_with_fault(
                                &root,
                                value,
                                |point| {
                                    let injected = (failure["point"] == "publication-blocks"
                                        && point == FaultPoint::BlocksSynced)
                                        || (failure["point"] == "publication-manifest"
                                            && point == FaultPoint::ManifestSynced);
                                    if injected {
                                        Err(failure["error"].as_str().unwrap().into())
                                    } else {
                                        Ok(())
                                    }
                                },
                            )
                        }
                        CoreStoreRequest::PublishDerived([patch]) => {
                            crate::core2_repository::publish_derived_with_fault(
                                &root,
                                patch,
                                |point| {
                                    let injected = (failure["point"] == "derived:memories"
                                        && point == FaultPoint::BlocksSynced)
                                        || (failure["point"] == "derived:receipt"
                                            && point == FaultPoint::ManifestSynced);
                                    if injected {
                                        Err(failure["error"].as_str().unwrap().into())
                                    } else {
                                        Ok(())
                                    }
                                },
                            )
                        }
                        _ => Err("CORE2_TEST_FAULT_ACTION_MISMATCH".into()),
                    }
                } else {
                    dispatch(&root, request)
                }
            });
        let mut output = match result {
            Ok(value) => serde_json::json!({"id":input["id"],"ok":true,"result":value}),
            Err(error) => serde_json::json!({"id":input["id"],"ok":false,"error":error}),
        };
        output["elapsedMs"] = serde_json::json!(started.elapsed().as_secs_f64() * 1000.0);
        output["ioProfile"] = serde_json::json!(crate::core2_store::take_io_profile());
        println!("CORE2_TEST_RESPONSE:{output}");
        std::io::stdout().flush().unwrap();
    }
}

fn capture_native(root: &Path, scope: &serde_json::Value, id: &str) -> serde_json::Value {
    let state = crate::core2_repository::read_state(root, scope.clone()).unwrap();
    serde_json::json!({"snapshotId":id,"scope":scope,"coreSeq":state["head"]["coreSeq"],"memoryRevision":state["head"]["memoryRevision"],"checksum":checksum_bytes(crate::core2_json::stable_json(&state).unwrap().as_bytes()),"state":state,"createdAt":10})
}
fn native_slot(snapshot: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"slotId":"slot-manual","journeyId":snapshot["scope"]["journeyId"],"snapshotId":snapshot["snapshotId"],"kind":"manual","name":"云","turn":1,"updatedAt":10})
}

#[test]
fn core2_native_indexes_validate_targets_and_publish_cache_without_advancing_the_world() {
    use crate::core2_indexes as indexes;
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let before = repo::read_head(&dir.path, batch["scope"].clone()).unwrap();
    assert_eq!(
        indexes::read_status(&dir.path, batch["scope"].clone()).unwrap()["status"],
        "missing"
    );
    let patch = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"cutoffSeq":1,"memoryRevision":0,"expectedIndexVersion":0,"postings":[{"scope":batch["scope"],"kind":"keyword","key":"苹果","target":"event","targetId":batch["events"][0]["eventId"],"commitSeq":1,"memoryRevision":0}]});
    let mut invalid = patch.clone();
    invalid["postings"][0]["targetId"] = serde_json::json!("missing");
    assert_eq!(
        indexes::publish_index(&dir.path, invalid).unwrap()["reason"],
        "invalid_index_target"
    );
    assert_eq!(
        indexes::publish_index(&dir.path, patch.clone()).unwrap()["status"],
        "published"
    );
    assert_eq!(
        indexes::publish_index(&dir.path, patch).unwrap()["status"],
        "conflict"
    );
    assert_eq!(
        indexes::read_status(&dir.path, batch["scope"].clone()).unwrap()["status"],
        "ready"
    );
    assert_eq!(
        repo::read_head(&dir.path, batch["scope"].clone()).unwrap(),
        before
    );
}

#[test]
fn core2_native_binary_assets_preserve_bytes_without_replacing_ids_or_crossing_sessions() {
    use crate::core2_assets as assets;
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let bytes = [0_u8, 255, 128, 10];
    let mut publication = serde_json::json!({"scope":seed["head"]["scope"],"sessionId":seed["head"]["sessionId"],"asset":{"assetId":"asset-photo","scope":seed["head"]["scope"],"mimeType":"image/webp","bytesBase64":"AP+ACg==","checksum":checksum_bytes(&bytes)}});
    let before = repo::read_head(&dir.path, seed["head"]["scope"].clone()).unwrap();
    assets::publish_asset(&dir.path, publication.clone()).unwrap();
    assets::publish_asset(&dir.path, publication.clone()).unwrap();
    assert_eq!(
        assets::read_asset(&dir.path, "asset-photo".into()).unwrap(),
        publication["asset"]
    );
    assert_eq!(
        repo::read_head(&dir.path, seed["head"]["scope"].clone()).unwrap(),
        before
    );
    publication["asset"]["bytesBase64"] = serde_json::json!("AQ==");
    publication["asset"]["checksum"] = serde_json::json!(checksum_bytes(&[1]));
    assert!(assets::publish_asset(&dir.path, publication)
        .unwrap_err()
        .contains("CORE2_ASSET_IMMUTABLE"));
    repo::activate_session(
        &dir.path,
        seed["head"]["scope"].clone(),
        "new-session".into(),
    )
    .unwrap();
    let old = assets::read_asset(&dir.path, "asset-photo".into()).unwrap();
    assert!(assets::publish_asset(&dir.path, serde_json::json!({"scope":seed["head"]["scope"],"sessionId":seed["head"]["sessionId"],"asset":old})).unwrap_err().contains("CORE2_SESSION_CHANGED"));
    assert!(assets::read_asset(&dir.path, "missing".into())
        .unwrap()
        .is_null());
}
#[test]
fn core2_native_snapshots_are_immutable_and_forks_freeze_both_positions() {
    use crate::core2_repository as repo;
    use crate::core2_snapshots as saves;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let snapshot = capture_native(&dir.path, &batch["scope"], "snapshot-1");
    let slot = native_slot(&snapshot);
    saves::publish_snapshot(&dir.path, snapshot.clone(), slot.clone()).unwrap();
    assert_eq!(
        saves::read_snapshot(&dir.path, "snapshot-1".into()).unwrap(),
        snapshot
    );
    let mut forged = snapshot.clone();
    forged["state"]["records"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|record| record["domain"] == "inventory")
        .unwrap()["value"]["quantity"] = serde_json::json!(999);
    forged["checksum"] = serde_json::json!(checksum_bytes(
        crate::core2_json::stable_json(&forged["state"])
            .unwrap()
            .as_bytes()
    ));
    assert!(saves::publish_snapshot(&dir.path, forged, slot.clone()).is_err());
    let request = serde_json::json!({"snapshotId":"snapshot-1","parentScope":batch["scope"],"branchId":"child","sessionId":"child-session"});
    let child = saves::fork(&dir.path, request.clone()).unwrap();
    assert_eq!(child["coreSeq"], 1);
    assert_eq!(child["forkSeq"], 1);
    assert_eq!(child["forkMemoryRevision"], 0);
    assert_eq!(saves::fork(&dir.path, request).unwrap(), child);
    let child_state = repo::read_state(&dir.path, child["scope"].clone()).unwrap();
    assert!(child_state["records"]
        .as_array()
        .unwrap()
        .iter()
        .all(|record| record["scope"] == child["scope"]));
    assert_eq!(
        repo::query_records(
            &dir.path,
            "events",
            serde_json::json!({"scope":child["scope"],"cutoffSeq":1})
        )
        .unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        repo::query_records(
            &dir.path,
            "jobs",
            serde_json::json!({"scope":child["scope"],"cutoffSeq":1})
        )
        .unwrap()["items"],
        serde_json::json!([])
    );
    assert_eq!(
        saves::list_slots(
            &dir.path,
            batch["scope"]["journeyId"].as_str().unwrap().into()
        )
        .unwrap(),
        serde_json::json!([slot])
    );
}
#[test]
fn core2_native_snapshot_rejects_stale_sessions_and_forged_current_state() {
    use crate::core2_repository as repo;
    use crate::core2_snapshots as saves;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let mut snapshot = capture_native(&dir.path, &seed["head"]["scope"], "snapshot-1");
    snapshot["state"]["records"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|record| record["domain"] == "inventory")
        .unwrap()["value"]["quantity"] = serde_json::json!(999);
    snapshot["checksum"] = serde_json::json!(checksum_bytes(
        crate::core2_json::stable_json(&snapshot["state"])
            .unwrap()
            .as_bytes()
    ));
    assert!(
        saves::publish_snapshot(&dir.path, snapshot.clone(), native_slot(&snapshot))
            .unwrap_err()
            .contains("CORE2_SNAPSHOT_STATE_MISMATCH")
    );
    assert!(saves::read_snapshot(&dir.path, "snapshot-1".into())
        .unwrap()
        .is_null());
    let snapshot = capture_native(&dir.path, &seed["head"]["scope"], "snapshot-2");
    repo::activate_session(
        &dir.path,
        seed["head"]["scope"].clone(),
        "new-session".into(),
    )
    .unwrap();
    assert!(
        saves::publish_snapshot(&dir.path, snapshot.clone(), native_slot(&snapshot))
            .unwrap_err()
            .contains("CORE2_SESSION_CHANGED")
    );
}

#[test]
fn core2_native_cancel_operation_keeps_committed_state_but_cancels_its_jobs() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let batch = enriched_batch();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let before = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
    repo::cancel_operation(
        &dir.path,
        batch["scope"].clone(),
        batch["operationId"].as_str().unwrap().into(),
    )
    .unwrap();
    assert_eq!(
        repo::read_state(&dir.path, batch["scope"].clone()).unwrap(),
        before
    );
    assert_eq!(
        repo::read_operation(
            &dir.path,
            batch["scope"].clone(),
            batch["operationId"].as_str().unwrap().into()
        )
        .unwrap()["status"],
        "committed"
    );
    let jobs = repo::query_records(
        &dir.path,
        "jobs",
        serde_json::json!({"scope":batch["scope"],"cutoffSeq":1}),
    )
    .unwrap();
    assert_eq!(jobs["items"][0]["status"], "cancelled");
    assert_eq!(jobs["items"][0]["version"], 2);
    repo::cancel_operation(
        &dir.path,
        batch["scope"].clone(),
        batch["operationId"].as_str().unwrap().into(),
    )
    .unwrap();
    assert_eq!(
        repo::query_records(
            &dir.path,
            "jobs",
            serde_json::json!({"scope":batch["scope"],"cutoffSeq":1})
        )
        .unwrap(),
        jobs
    );
    repo::cancel_operation(&dir.path, batch["scope"].clone(), "never-started".into()).unwrap();
    assert_eq!(
        repo::read_operation(&dir.path, batch["scope"].clone(), "never-started".into()).unwrap()
            ["status"],
        "cancelled"
    );
}

#[test]
fn core2_native_due_commitments_use_the_world_calendar_and_clock_without_mutation() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let mut batch = commit_fixture();
    let promise = serde_json::json!({"commitmentId":"promise","scope":batch["scope"],"participantIds":["npc-amber"],"text":"明天见","recurring":false,"trigger":{"kind":"date","date":"旅行历 1000.02.31","clock":"10:30"},"status":"pending","establishedEventId":batch["events"][0]["eventId"],"history":[],"version":1});
    batch["commitments"] = serde_json::json!([promise]);
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let before = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
    let mut moment = batch["events"][0]["occurredMoment"].clone();
    moment["date"] = serde_json::json!("旅行历 1000.02.31");
    moment["clock"] = serde_json::json!("10:29");
    let mut query = serde_json::json!({"scope":batch["scope"],"cutoffSeq":1,"dueAt":moment});
    assert_eq!(
        repo::query_records(&dir.path, "commitments", query.clone()).unwrap()["items"],
        serde_json::json!([])
    );
    query["dueAt"]["clock"] = serde_json::json!("10:30");
    assert_eq!(
        repo::query_records(&dir.path, "commitments", query.clone()).unwrap()["items"][0]
            ["commitmentId"],
        "promise"
    );
    query["dueAt"]["clock"] = serde_json::Value::Null;
    assert!(repo::query_records(&dir.path, "commitments", query.clone())
        .unwrap_err()
        .contains("CORE2_DUE_CLOCK_UNKNOWN"));
    query["dueAt"]["date"] = serde_json::json!("旅行历 1000.03.01");
    assert_eq!(
        repo::query_records(&dir.path, "commitments", query.clone()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    query["dueAt"]["date"] = serde_json::json!("旅行历 1000.13.01");
    assert!(repo::query_records(&dir.path, "commitments", query)
        .unwrap_err()
        .contains("CORE2_INVALID_DUE_TIME"));
    assert_eq!(
        repo::read_state(&dir.path, batch["scope"].clone()).unwrap(),
        before
    );
}

#[test]
fn core2_native_bootstrap_reconnects_state_and_session_without_touching_game_time() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let scope = seed["head"]["scope"].clone();
    assert_eq!(
        repo::initialize(&dir.path, seed.clone()).unwrap(),
        seed["head"]
    );
    assert_eq!(
        repo::read_head(&dir.path, scope.clone()).unwrap(),
        seed["head"]
    );
    let state = repo::read_state(&dir.path, scope.clone()).unwrap();
    let mut expected_records = seed["records"].as_array().unwrap().clone();
    expected_records.sort_by(|a, b| {
        (a["domain"].as_str(), a["entityId"].as_str())
            .cmp(&(b["domain"].as_str(), b["entityId"].as_str()))
    });
    assert_eq!(state["records"], serde_json::json!(expected_records));
    assert_eq!(state["tombstones"], serde_json::json!([]));
    let next = repo::activate_session(&dir.path, scope.clone(), "session-new".into()).unwrap();
    assert_eq!(next["sessionId"], "session-new");
    assert_eq!(next["coreSeq"], 0);
    assert_eq!(next["memoryRevision"], 0);
    assert_eq!(
        repo::read_state(&dir.path, scope.clone()).unwrap()["records"],
        state["records"]
    );
    assert!(repo::initialize(&dir.path, seed)
        .unwrap_err()
        .contains("CORE2_BRANCH_EXISTS"));
    assert_eq!(
        repo::read_head(&dir.path, scope).unwrap()["sessionId"],
        "session-new"
    );
}

#[test]
fn core2_native_bootstrap_rejects_bad_dto_before_publishing_a_head() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let mut seed = seed_fixture();
    seed["records"][0]["value"]["history"] = serde_json::json!([]);
    assert!(repo::initialize(&dir.path, seed)
        .unwrap_err()
        .contains("CORE2_INVALID_SEED"));
    assert!(LockedStore::open(&dir.path)
        .unwrap()
        .load()
        .unwrap()
        .is_none());
    let mut seed = seed_fixture();
    seed["head"]["coreSeq"] = serde_json::json!(1);
    assert!(repo::initialize(&dir.path, seed)
        .unwrap_err()
        .contains("CORE2_INVALID_INITIALIZATION"));
}

#[test]
fn core2_native_sources_are_immutable_and_versioned_without_invented_positions() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let original = seed["sources"][0].clone();
    let reference = original["ref"].clone();
    assert_eq!(
        repo::read_source(&dir.path, reference.clone()).unwrap(),
        original
    );
    assert_eq!(
        repo::put_source(&dir.path, original.clone()).unwrap(),
        reference
    );
    let mut replacement = original.clone();
    replacement["blocks"][0]["text"] = serde_json::json!("changed");
    assert!(repo::put_source(&dir.path, replacement.clone())
        .unwrap_err()
        .contains("CORE2_SOURCE_IMMUTABLE"));
    replacement["ref"]["sourceVersion"] = serde_json::json!(2);
    assert_eq!(
        repo::put_source(&dir.path, replacement.clone()).unwrap(),
        replacement["ref"]
    );
    assert_eq!(
        repo::read_source(&dir.path, original["ref"].clone()).unwrap(),
        original
    );
    replacement["ref"]["sourceVersion"] = serde_json::json!(4);
    assert!(repo::put_source(&dir.path, replacement)
        .unwrap_err()
        .contains("CORE2_SOURCE_VERSION_CONFLICT"));
}

fn commit_fixture() -> serde_json::Value {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../tests/fixtures/core2-native-contract-corpus.json"
    ))
    .unwrap();
    cases
        .iter()
        .find(|case| case["kind"] == "commit" && case["accepted"] == true)
        .unwrap()["input"]
        .clone()
}
fn prepare_native(root: &Path, seed: &serde_json::Value, batch: &serde_json::Value) {
    use crate::core2_repository as repo;
    let mut source = seed["sources"][0].clone();
    source["ref"] = batch["sourceRefs"][0].clone();
    source["operationId"] = batch["operationId"].clone();
    repo::put_source(root, source).unwrap();
    repo::prepare_operation(root, serde_json::json!({"scope":batch["scope"],"operationId":batch["operationId"],"kind":"main","status":"prepared","sourceRefs":batch["sourceRefs"],"readSet":batch["readSet"],"candidateRefs":[],"effects":batch["changes"].as_array().unwrap().iter().map(|change| change["effectKey"].clone()).collect::<Vec<_>>(),"attempts":1})).unwrap();
    repo::stage_operation(root, serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"operationId":batch["operationId"],"sourceRefs":batch["sourceRefs"],"candidates":[],"review":[],"stageVersion":1})).unwrap();
}

#[test]
fn core2_native_commits_state_events_and_receipt_only_once_across_reconnect() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = commit_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    let receipt = repo::commit(&dir.path, batch.clone()).unwrap();
    assert_eq!(receipt["status"], "committed");
    assert_eq!(receipt["coreSeq"], 1);
    for _ in 0..100 {
        assert_eq!(
            repo::commit(&dir.path, batch.clone()).unwrap()["status"],
            "already_committed"
        );
    }
    let state = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
    let apple = state["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["entityId"] == "apple")
        .unwrap();
    assert_eq!(apple["value"]["quantity"], 2);
    assert_eq!(state["head"]["coreSeq"], 1);
    assert_eq!(
        repo::read_operation(
            &dir.path,
            batch["scope"].clone(),
            batch["operationId"].as_str().unwrap().into()
        )
        .unwrap()["receipt"],
        receipt
    );
    let event = repo::read_event(
        &dir.path,
        batch["events"][0]["eventId"].as_str().unwrap().into(),
    )
    .unwrap();
    assert_eq!(event["commitSeq"], 1);
}

#[test]
fn core2_native_rejects_invalid_evidence_and_late_session_without_partial_effects() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let mut batch = commit_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    batch["events"][0]["evidenceRefs"][0]["quote"] = serde_json::json!("xxxxxxxxxxxxxx");
    let rejected = repo::commit(&dir.path, batch.clone()).unwrap();
    assert_eq!(rejected["status"], "conflict");
    assert_eq!(rejected["reason"], "invalid_event_evidence");
    assert_eq!(
        repo::read_head(&dir.path, batch["scope"].clone()).unwrap()["coreSeq"],
        0
    );
    repo::activate_session(&dir.path, batch["scope"].clone(), "new-owner".into()).unwrap();
    assert_eq!(
        repo::commit(&dir.path, commit_fixture()).unwrap()["status"],
        "cancelled"
    );
    assert_eq!(
        repo::read_head(&dir.path, batch["scope"].clone()).unwrap()["coreSeq"],
        0
    );
}

fn enriched_batch() -> serde_json::Value {
    let mut batch = commit_fixture();
    let event = batch["events"][0].clone();
    batch["knowledge"] = serde_json::json!([{"knowledgeId":"knowledge-apple","scope":batch["scope"],"npcId":"npc-amber","eventId":event["eventId"],"mode":"witnessed","evidenceRefs":event["evidenceRefs"],"learnedMoment":event["occurredMoment"],"nature":"fact","version":1}]);
    batch["commitments"] = serde_json::json!([{"commitmentId":"promise-apple","scope":batch["scope"],"participantIds":["npc-amber"],"text":"明天一起吃苹果","establishedEventId":event["eventId"],"trigger":{"kind":"date","date":"旅行历 1000.03.08"},"recurring":false,"status":"pending","history":[],"version":1}]);
    batch["jobs"] = serde_json::json!([{"jobId":"job-summary","scope":batch["scope"],"sessionId":batch["sessionId"],"kind":"turn_summary","sourceRefs":batch["sourceRefs"],"operationId":batch["operationId"],"status":"pending","leaseId":null,"configFingerprint":"test-config","attempts":0,"steps":[],"version":1}]);
    batch
}

#[test]
fn core2_native_all_domain_rows_publish_together_or_not_at_all() {
    use crate::core2_repository as repo;
    for fault in [
        FaultPoint::BlocksSynced,
        FaultPoint::ManifestSynced,
        FaultPoint::PointerStaged,
        FaultPoint::PointerPublished,
    ] {
        let dir = FixtureDir::new();
        let seed = seed_fixture();
        let batch = enriched_batch();
        repo::initialize(&dir.path, seed.clone()).unwrap();
        prepare_native(&dir.path, &seed, &batch);
        let result = repo::commit_with_fault(&dir.path, batch.clone(), |point| {
            if point == fault {
                Err("injected-native-commit".into())
            } else {
                Ok(())
            }
        });
        assert!(result.unwrap_err().contains("injected-native-commit"));
        let committed = fault == FaultPoint::PointerPublished;
        let state = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
        assert_eq!(state["head"]["coreSeq"], if committed { 1 } else { 0 });
        let saved = repo::read_operation(
            &dir.path,
            batch["scope"].clone(),
            batch["operationId"].as_str().unwrap().into(),
        )
        .unwrap();
        assert_eq!(
            saved["status"],
            if committed { "committed" } else { "prepared" }
        );
        {
            let store = LockedStore::open(&dir.path).unwrap();
            let view = store.load().unwrap().unwrap();
            for table in ["events", "effects", "knowledge", "commitments", "jobs"] {
                let pages = store.table_root(&view, table).unwrap();
                assert_eq!(
                    pages.pages.iter().map(|page| page.count).sum::<usize>(),
                    if committed { 1 } else { 0 },
                    "{table}"
                );
            }
        }
        if committed {
            assert_eq!(
                repo::commit(&dir.path, batch).unwrap()["status"],
                "already_committed"
            );
        }
    }
}

#[test]
fn core2_native_the_fifty_first_commit_does_not_rewrite_sealed_event_payloads() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let mut sealed = String::new();
    for turn in 1..=51 {
        let mut batch = commit_fixture();
        let op = format!("operation-round-{turn}");
        let source_id = format!("source-round-{turn}");
        batch["operationId"] = serde_json::json!(op);
        batch["sourceRefs"][0]["sourceId"] = serde_json::json!(source_id);
        batch["changes"][0]["ref"]["version"] = serde_json::json!(turn);
        batch["readSet"][0]["version"] = serde_json::json!(turn);
        batch["changes"][0]["before"]["version"] = serde_json::json!(turn);
        batch["changes"][0]["before"]["value"]["quantity"] = serde_json::json!(turn);
        batch["changes"][0]["after"]["version"] = serde_json::json!(turn + 1);
        batch["changes"][0]["after"]["value"]["quantity"] = serde_json::json!(turn + 1);
        batch["changes"][0]["effectKey"] = serde_json::json!(format!("effect-round-{turn}"));
        batch["events"][0]["operationId"] = batch["operationId"].clone();
        batch["events"][0]["eventId"] = serde_json::json!(format!("event-round-{turn}"));
        batch["events"][0]["turn"] = serde_json::json!(turn);
        batch["events"][0]["evidenceRefs"][0]["ref"] = batch["sourceRefs"][0].clone();
        batch["events"][0]["committedChanges"] = batch["changes"].clone();
        prepare_native(&dir.path, &seed, &batch);
        let receipt = repo::commit(&dir.path, batch).unwrap();
        assert_eq!(receipt["status"], "committed", "turn {turn}: {receipt}");
        assert_eq!(receipt["coreSeq"], turn);
        if turn >= 50 {
            let store = LockedStore::open(&dir.path).unwrap();
            let view = store.load().unwrap().unwrap();
            let root = store.table_root(&view, "events").unwrap();
            if turn == 50 {
                assert_eq!(root.pages.len(), 1);
                assert_eq!(root.pages[0].count, 50);
                sealed = root.pages[0].block.path.clone();
            } else {
                assert_eq!(
                    root.pages[0].block.path, sealed,
                    "sealed segment was rewritten"
                );
                assert_eq!(
                    root.pages.iter().map(|page| page.count).collect::<Vec<_>>(),
                    vec![50, 1]
                );
            }
        }
    }
}

#[test]
fn core2_native_queries_show_only_committed_rows_inside_the_requested_cutoff() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let query = serde_json::json!({"scope":batch["scope"],"cutoffSeq":1});
    for (kind, field, wanted) in [
        ("events", "eventId", "event-apple-1"),
        ("knowledge", "npcId", "npc-amber"),
        ("commitments", "status", "pending"),
        ("jobs", "status", "pending"),
    ] {
        let page = repo::query_records(&dir.path, kind, query.clone()).unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), 1, "{kind}");
        assert_eq!(page["items"][0][field], wanted);
        let mut old = query.clone();
        old["cutoffSeq"] = serde_json::json!(0);
        assert!(repo::query_records(&dir.path, kind, old).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    let mut filtered = query.clone();
    filtered["npcIds"] = serde_json::json!(["not-amber"]);
    assert!(
        repo::query_records(&dir.path, "events", filtered).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let mut bad = query.clone();
    bad["npcIds"] = serde_json::json!([7]);
    assert!(repo::query_records(&dir.path, "events", bad).is_err());
    let mut future = query.clone();
    future["cutoffSeq"] = serde_json::json!(2);
    assert!(repo::query_records(&dir.path, "events", future)
        .unwrap_err()
        .contains("CORE2_FUTURE_CUTOFF"));
    assert!(repo::query_records(&dir.path, "../files", query).is_err());
}

#[test]
fn core2_native_query_rejects_ecmascript_whitespace_only_filters() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    let query =
        serde_json::json!({"scope":seed["head"]["scope"],"cutoffSeq":0,"npcIds":["\u{feff}"]});
    assert!(repo::query_records(&dir.path, "events", query)
        .unwrap_err()
        .contains("CORE2_INVALID_QUERY"));
}

#[test]
fn core2_native_pagination_cursor_is_bound_to_filters_and_cutoff() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let mut batch = commit_fixture();
    let mut extra = batch["events"][0].clone();
    extra["eventId"] = serde_json::json!("event-z");
    extra["committedChanges"] = serde_json::json!([]);
    batch["events"].as_array_mut().unwrap().push(extra);
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let mut query = serde_json::json!({"scope":batch["scope"],"cutoffSeq":1,"limit":1});
    let first = repo::query_records(&dir.path, "events", query.clone()).unwrap();
    assert_eq!(first["items"][0]["eventId"], "event-apple-1");
    query["cursor"] = first["nextCursor"].clone();
    let last = repo::query_records(&dir.path, "events", query.clone()).unwrap();
    assert_eq!(last["items"][0]["eventId"], "event-z");
    assert!(last.get("nextCursor").is_none());
    query["types"] = serde_json::json!(["inventory.gain"]);
    assert!(repo::query_records(&dir.path, "events", query)
        .unwrap_err()
        .contains("CORE2_CURSOR_MISMATCH"));
}

#[test]
fn core2_native_job_holders_are_versioned_and_cannot_reuse_an_old_lease() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let mut claim = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"expectedVersion":1});
    let running = repo::claim_job(&dir.path, claim.clone()).unwrap();
    assert_eq!(running["status"], "running");
    assert_eq!(running["attempts"], 1);
    assert_eq!(running["version"], 2);
    claim["expectedVersion"] = serde_json::json!(2);
    assert_eq!(repo::claim_job(&dir.path, claim.clone()).unwrap(), running);
    claim["leaseId"] = serde_json::json!("different-lease");
    assert!(repo::claim_job(&dir.path, claim.clone()).unwrap().is_null());
    repo::activate_session(&dir.path, batch["scope"].clone(), "session-new".into()).unwrap();
    claim["sessionId"] = serde_json::json!("session-new");
    claim["leaseId"] = serde_json::json!("lease-1");
    assert!(repo::claim_job(&dir.path, claim.clone()).unwrap().is_null());
    claim["leaseId"] = serde_json::json!("lease-2");
    let next = repo::claim_job(&dir.path, claim.clone()).unwrap();
    assert_eq!(next["version"], 3);
    assert_eq!(next["attempts"], 2);
    let mut finish = claim;
    finish["expectedVersion"] = serde_json::json!(3);
    finish["status"] = serde_json::json!("completed");
    repo::finish_job(&dir.path, finish).unwrap();
    repo::cancel_job(&dir.path, batch["scope"].clone(), "job-summary".into()).unwrap();
    let job = repo::query_records(
        &dir.path,
        "jobs",
        serde_json::json!({"scope":batch["scope"],"cutoffSeq":1}),
    )
    .unwrap();
    assert_eq!(job["items"][0]["status"], "completed");
    assert_eq!(job["items"][0]["version"], 4);
}

#[test]
fn core2_native_enqueued_jobs_require_a_committed_operation_and_one_current_holder_per_kind() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    let mut job = batch["jobs"][0].clone();
    job["jobId"] = serde_json::json!("job-extra");
    assert!(repo::enqueue_job(&dir.path, job.clone())
        .unwrap_err()
        .contains("CORE2_JOB_SOURCE_NOT_COMMITTED"));
    repo::commit(&dir.path, batch.clone()).unwrap();
    repo::enqueue_job(&dir.path, job.clone()).unwrap();
    repo::enqueue_job(&dir.path, job).unwrap();
    let mut claim = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"expectedVersion":1});
    assert_eq!(
        repo::claim_job(&dir.path, claim.clone()).unwrap()["status"],
        "running"
    );
    claim["jobId"] = serde_json::json!("job-extra");
    claim["leaseId"] = serde_json::json!("lease-extra");
    assert!(repo::claim_job(&dir.path, claim.clone()).unwrap().is_null());
    repo::cancel_job(&dir.path, batch["scope"].clone(), "job-summary".into()).unwrap();
    assert_eq!(
        repo::claim_job(&dir.path, claim).unwrap()["status"],
        "running"
    );
}

fn memory_fixture(batch: &serde_json::Value) -> serde_json::Value {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../tests/fixtures/core2-native-contract-corpus.json"
    ))
    .unwrap();
    let mut memory = cases
        .iter()
        .find(|case| case["kind"] == "memory" && case["accepted"] == true)
        .unwrap()["input"]
        .clone();
    memory["scope"] = batch["scope"].clone();
    memory["sourceRefs"] = batch["sourceRefs"].clone();
    memory["eventIds"] = serde_json::json!([batch["events"][0]["eventId"]]);
    memory["momentRange"] = serde_json::json!({"start":batch["events"][0]["occurredMoment"],"end":batch["events"][0]["occurredMoment"],"sourceIds":[batch["sourceRefs"][0]["sourceId"]]});
    memory
}

#[test]
fn core2_native_derived_memory_publishes_once_without_advancing_core_or_game_time() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let claim = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"expectedVersion":1});
    repo::claim_job(&dir.path, claim).unwrap();
    let before = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
    let patch = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"readSet":[],"expectedMemoryRevision":0,"additions":[memory_fixture(&batch)],"supersededIds":[]});
    let receipt = repo::publish_derived(&dir.path, patch.clone()).unwrap();
    assert_eq!(receipt["status"], "published");
    assert_eq!(receipt["memoryRevision"], 1);
    assert_eq!(
        repo::publish_derived(&dir.path, patch.clone()).unwrap(),
        receipt
    );
    let after = repo::read_state(&dir.path, batch["scope"].clone()).unwrap();
    assert_eq!(after["records"], before["records"]);
    assert_eq!(after["head"]["coreSeq"], 1);
    assert_eq!(after["head"]["memoryRevision"], 1);
    let mut altered = patch;
    altered["additions"][0]["text"] = serde_json::json!("changed after acknowledgement");
    assert_eq!(
        repo::publish_derived(&dir.path, altered).unwrap()["status"],
        "conflict"
    );
}

#[test]
fn core2_native_successful_job_steps_are_immutable_and_remain_staging_until_publication() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let claim = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"expectedVersion":1});
    repo::claim_job(&dir.path, claim).unwrap();
    let step = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"stepId":"step-1","status":"completed","memories":[memory_fixture(&batch)]});
    repo::save_job_step(&dir.path, step.clone()).unwrap();
    repo::save_job_step(&dir.path, step.clone()).unwrap();
    let mut changed = step;
    changed["memories"][0]["text"] = serde_json::json!("overwrite completed step");
    assert!(repo::save_job_step(&dir.path, changed)
        .unwrap_err()
        .contains("CORE2_JOB_STEP_IMMUTABLE"));
    assert_eq!(
        repo::read_head(&dir.path, batch["scope"].clone()).unwrap()["memoryRevision"],
        0
    );
    let job = repo::query_records(
        &dir.path,
        "jobs",
        serde_json::json!({"scope":batch["scope"],"cutoffSeq":1}),
    )
    .unwrap();
    assert_eq!(job["items"][0]["steps"].as_array().unwrap().len(), 1);
    assert_eq!(job["items"][0]["version"], 3);
}

#[test]
fn core2_native_memory_queries_keep_the_requested_publication_revision() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    repo::commit(&dir.path, batch.clone()).unwrap();
    let claim = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"expectedVersion":1});
    repo::claim_job(&dir.path, claim).unwrap();
    let patch = serde_json::json!({"scope":batch["scope"],"sessionId":batch["sessionId"],"jobId":"job-summary","leaseId":"lease-1","sourceRefs":batch["sourceRefs"],"readSet":[],"expectedMemoryRevision":0,"additions":[memory_fixture(&batch)],"supersededIds":[]});
    repo::publish_derived(&dir.path, patch).unwrap();
    let mut query = serde_json::json!({"scope":batch["scope"],"cutoffSeq":1,"memoryRevision":1});
    let page = repo::query_records(&dir.path, "memories", query.clone()).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["version"], 1);
    query["memoryRevision"] = serde_json::json!(0);
    assert!(
        repo::query_records(&dir.path, "memories", query.clone()).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    query["memoryRevision"] = serde_json::json!(2);
    assert!(repo::query_records(&dir.path, "memories", query.clone())
        .unwrap_err()
        .contains("CORE2_FUTURE_CUTOFF"));
    query["memoryRevision"] = serde_json::json!(1);
    query["keywords"] = serde_json::json!(["苹果"]);
    assert_eq!(
        repo::query_records(&dir.path, "memories", query.clone()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    query["keywords"] = serde_json::json!(["无关内容"]);
    assert!(
        repo::query_records(&dir.path, "memories", query).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn core2_native_source_queries_hide_pending_sources_but_direct_refs_still_allow_preparation() {
    use crate::core2_repository as repo;
    let dir = FixtureDir::new();
    let seed = seed_fixture();
    let batch = enriched_batch();
    repo::initialize(&dir.path, seed.clone()).unwrap();
    prepare_native(&dir.path, &seed, &batch);
    let mut query =
        serde_json::json!({"scope":batch["scope"],"cutoffSeq":0,"refs":batch["sourceRefs"]});
    assert!(
        repo::query_records(&dir.path, "sources", query.clone()).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        !repo::read_source(&dir.path, batch["sourceRefs"][0].clone())
            .unwrap()
            .is_null()
    );
    repo::commit(&dir.path, batch.clone()).unwrap();
    query["cutoffSeq"] = serde_json::json!(1);
    assert_eq!(
        repo::query_records(&dir.path, "sources", query.clone()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    query["operationId"] = serde_json::json!("unrelated-operation");
    assert!(
        repo::query_records(&dir.path, "sources", query).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn core2_binary_integrity_matches_fixed_cross_language_vectors() {
    assert_eq!(checksum_bytes(b""), "cbf29ce484222325");
    assert_eq!(checksum_bytes(&[0]), "af63bd4c8601b7df");
    assert_eq!(checksum_bytes(b"a"), "af63dc4c8601ec8c");
    assert_eq!(checksum_bytes(b"hello"), "a430d84680aabd0b");
    assert_ne!(checksum_bytes(&[255]), checksum_bytes(&[128]));
}

#[test]
fn core2_publication_reconnects_to_one_complete_manifest_of_immutable_roots() {
    let dir = FixtureDir::new();
    let first_ref;
    {
        let store = LockedStore::open(&dir.path).unwrap();
        let first = store.publish(0, updates("first")).unwrap();
        first_ref = first.manifest.roots["states"].clone();
        assert_eq!(store.read_block(&first_ref).unwrap(), b"first");
        let second = store.publish(1, updates("second")).unwrap();
        assert_eq!(second.manifest.revision, 2);
        assert_ne!(first_ref.path, second.manifest.roots["states"].path);
        assert_eq!(store.read_block(&first_ref).unwrap(), b"first");
    }
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    assert_eq!(view.manifest.revision, 2);
    assert!(view.recovery.is_none());
    assert_eq!(
        store.read_block(&view.manifest.roots["states"]).unwrap(),
        b"second"
    );
}

#[test]
fn core2_before_pointer_faults_never_publish_half_a_view() {
    for point in [
        FaultPoint::BlocksSynced,
        FaultPoint::ManifestSynced,
        FaultPoint::PointerStaged,
    ] {
        let dir = FixtureDir::new();
        {
            let store = LockedStore::open(&dir.path).unwrap();
            store.publish(0, updates("previous")).unwrap();
            let error = store
                .publish_with_fault(1, updates("incomplete"), |current| {
                    if current == point {
                        Err("injected".into())
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert!(error.contains("injected"));
        }
        let store = LockedStore::open(&dir.path).unwrap();
        let view = store.load().unwrap().unwrap();
        assert_eq!(view.manifest.revision, 1);
        assert_eq!(
            store.read_block(&view.manifest.roots["states"]).unwrap(),
            b"previous"
        );
    }
}

#[test]
fn core2_after_pointer_failure_is_a_durable_commit_not_a_failed_write() {
    let dir = FixtureDir::new();
    {
        let store = LockedStore::open(&dir.path).unwrap();
        assert!(store
            .publish_with_fault(0, updates("committed"), |point| {
                if point == FaultPoint::PointerPublished {
                    Err("reply-lost".into())
                } else {
                    Ok(())
                }
            })
            .is_err());
    }
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    assert_eq!(view.manifest.revision, 1);
    assert_eq!(
        store.read_block(&view.manifest.roots["states"]).unwrap(),
        b"committed"
    );
    assert!(store
        .publish(0, updates("duplicate"))
        .unwrap_err()
        .contains("CORE2_REVISION_CONFLICT"));
}

#[test]
fn core2_damaged_latest_root_reports_recovery_and_refuses_silent_overwrite() {
    let dir = FixtureDir::new();
    let latest;
    {
        let store = LockedStore::open(&dir.path).unwrap();
        store.publish(0, updates("previous")).unwrap();
        latest = store.publish(1, updates("latest")).unwrap().manifest.roots["states"].clone();
    }
    fs::write(dir.path.join("core2").join(&latest.path), b"corrupt").unwrap();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    assert_eq!(view.manifest.revision, 1);
    assert!(view.recovery.as_ref().unwrap().contains("checksum"));
    assert_eq!(
        store.read_block(&view.manifest.roots["states"]).unwrap(),
        b"previous"
    );
    assert!(store
        .publish(1, updates("unacknowledged"))
        .unwrap_err()
        .contains("CORE2_RECOVERY_REQUIRES_CONFIRMATION"));
}

#[test]
fn core2_rejects_absolute_traversal_and_foreign_root_names() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    for path in [
        "../outside.json",
        "blocks/../../outside.json",
        "C:/outside.json",
        "blocks/file:stream",
        "blocks/CON.json",
        "blocks/../current.json",
    ] {
        let reference = BlockRef {
            path: path.into(),
            checksum: checksum_bytes(b"x"),
            size: 1,
        };
        assert!(store
            .read_block(&reference)
            .unwrap_err()
            .contains("CORE2_INVALID_REFERENCE"));
    }
    assert!(store
        .publish(0, BTreeMap::from([("../outside".into(), b"bad".to_vec())]))
        .unwrap_err()
        .contains("CORE2_INVALID_STORE"));
    assert!(store.load().unwrap().is_none());
}

fn link_directory(target: &Path, link: &Path) {
    #[cfg(windows)]
    {
        // A directory junction needs no symlink privilege; both ends are owned fixtures.
        let target = target
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let link = link
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let output = Command::new("cmd")
            .args(["/C", "mklink", "/J", &link, &target])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "junction fixture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[test]
fn core2_rejects_a_linked_root_before_creating_any_new_files_through_it() {
    let dir = FixtureDir::new();
    let outside = dir.path.join("not-the-core-root");
    fs::create_dir(&outside).unwrap();
    link_directory(&outside, &dir.path.join("core2"));
    assert!(LockedStore::open(&dir.path)
        .unwrap_err()
        .contains("CORE2_LINK_FORBIDDEN"));
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn core2_rejects_a_linked_block_directory_even_if_the_outside_bytes_match() {
    let dir = FixtureDir::new();
    let store = LockedStore::open(&dir.path).unwrap();
    let reference = store
        .publish(0, updates("same bytes"))
        .unwrap()
        .manifest
        .roots["states"]
        .clone();
    fs::rename(
        dir.path.join("core2/blocks"),
        dir.path.join("core2/original-blocks"),
    )
    .unwrap();
    let outside = dir.path.join("not-the-block-root");
    fs::create_dir(&outside).unwrap();
    fs::write(
        outside.join(Path::new(&reference.path).file_name().unwrap()),
        b"same bytes",
    )
    .unwrap();
    link_directory(&outside, &dir.path.join("core2/blocks"));
    assert!(store
        .read_block(&reference)
        .unwrap_err()
        .contains("CORE2_LINK_FORBIDDEN"));
}

#[test]
fn core2_a_second_handle_cannot_steal_a_live_os_lock() {
    let dir = FixtureDir::new();
    let first = LockedStore::open(&dir.path).unwrap();
    assert!(LockedStore::open(&dir.path)
        .unwrap_err()
        .contains("CORE2_STORAGE_BUSY"));
    drop(first);
    assert!(LockedStore::open(&dir.path).is_ok());
}

#[cfg(windows)]
#[test]
fn core2_live_windows_lock_file_cannot_be_renamed_to_bypass_the_os_lock() {
    let dir = FixtureDir::new();
    let _held = LockedStore::open(&dir.path).unwrap();
    let lock = dir.path.join("core2/store.lock");
    assert!(fs::rename(&lock, dir.path.join("core2/moved.lock")).is_err());
    assert!(lock.exists());
}

#[test]
fn core2_failed_next_publication_does_not_discard_the_previous_recovery_chain() {
    let dir = FixtureDir::new();
    let latest;
    {
        let store = LockedStore::open(&dir.path).unwrap();
        store.publish(0, updates("one")).unwrap();
        latest = store.publish(1, updates("two")).unwrap().manifest.roots["states"].clone();
        assert!(store
            .publish_with_fault(2, updates("never committed"), |point| {
                if point == FaultPoint::PointerStaged {
                    Err("interrupted".into())
                } else {
                    Ok(())
                }
            })
            .is_err());
    }
    fs::write(dir.path.join("core2/current.json"), b"invalid pointer").unwrap();
    fs::write(
        dir.path.join("core2").join(latest.path),
        b"invalid latest root",
    )
    .unwrap();
    let store = LockedStore::open(&dir.path).unwrap();
    let view = store.load().unwrap().unwrap();
    assert_eq!(view.manifest.revision, 1);
    assert!(view.recovery.is_some());
    assert_eq!(
        store.read_block(&view.manifest.roots["states"]).unwrap(),
        b"one"
    );
}

struct TestChild(Child);
impl std::ops::Deref for TestChild {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.0
    }
}
impl std::ops::DerefMut for TestChild {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.0
    }
}
impl Drop for TestChild {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

fn child(root: &Path, mode: &str, label: &str) -> TestChild {
    TestChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "core2_store_tests::core2_child_helper",
                "--nocapture",
            ])
            .env("CORE2_TEST_ROOT", root)
            .env("CORE2_TEST_MODE", mode)
            .env("CORE2_TEST_LABEL", label)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}
fn wait_marker(path: &Path) {
    let start = Instant::now();
    while !path.exists() {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "child did not reach the expected checkpoint"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
#[ignore = "only launched by bounded synthetic child-process tests"]
fn core2_child_helper() {
    let root = PathBuf::from(std::env::var("CORE2_TEST_ROOT").unwrap());
    let mode = std::env::var("CORE2_TEST_MODE").unwrap();
    let label = std::env::var("CORE2_TEST_LABEL").unwrap();
    assert!(label == "a" || label == "b");
    if let Some(phase) = mode.strip_prefix("crash-") {
        let stop_at = match phase {
            "blocks" => FaultPoint::BlocksSynced,
            "manifest" => FaultPoint::ManifestSynced,
            "staged" => FaultPoint::PointerStaged,
            "published" => FaultPoint::PointerPublished,
            _ => panic!("unknown owned crash checkpoint"),
        };
        let store = LockedStore::open(&root).unwrap();
        store
            .publish_with_fault(
                1,
                BTreeMap::from([
                    ("states".into(), b"new state".to_vec()),
                    ("events".into(), b"new event".to_vec()),
                ]),
                |point| {
                    if point == stop_at {
                        fs::write(root.join(format!("ready-{label}")), phase).unwrap();
                        let start = Instant::now();
                        while start.elapsed() < Duration::from_secs(15) {
                            std::thread::sleep(Duration::from_millis(20));
                        }
                        panic!("parent did not terminate its own crash-test child");
                    }
                    Ok(())
                },
            )
            .unwrap();
    } else if mode == "hold" {
        let _store = LockedStore::open(&root).unwrap();
        fs::write(root.join(format!("ready-{label}")), "held").unwrap();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(15) {
            std::thread::sleep(Duration::from_millis(20));
        }
    } else {
        let status = match LockedStore::open(&root) {
            Ok(store) => match store.publish(0, updates("one winner")) {
                Ok(_) => "committed",
                Err(_) => "conflict",
            },
            Err(_) => "busy",
        };
        fs::write(root.join(format!("result-{label}")), status).unwrap();
    }
}

#[test]
fn core2_two_real_processes_cannot_publish_the_same_previous_revision_twice() {
    let dir = FixtureDir::new();
    let mut a = child(&dir.path, "write", "a");
    let mut b = child(&dir.path, "write", "b");
    assert!(a.wait().unwrap().success());
    assert!(b.wait().unwrap().success());
    let results = [
        fs::read_to_string(dir.path.join("result-a")).unwrap(),
        fs::read_to_string(dir.path.join("result-b")).unwrap(),
    ];
    assert_eq!(
        results.iter().filter(|s| s.as_str() == "committed").count(),
        1
    );
    assert_eq!(
        LockedStore::open(&dir.path)
            .unwrap()
            .load()
            .unwrap()
            .unwrap()
            .manifest
            .revision,
        1
    );
}

#[test]
fn core2_terminating_only_the_test_child_releases_its_lock_without_age_rules() {
    let dir = FixtureDir::new();
    let mut held = child(&dir.path, "hold", "a");
    wait_marker(&dir.path.join("ready-a"));
    assert!(LockedStore::open(&dir.path)
        .unwrap_err()
        .contains("CORE2_STORAGE_BUSY"));
    held.kill().unwrap();
    held.wait().unwrap();
    let store = LockedStore::open(&dir.path).unwrap();
    assert_eq!(
        store
            .publish(0, updates("recovered"))
            .unwrap()
            .manifest
            .revision,
        1
    );
}

#[test]
fn core2_real_process_termination_at_each_publish_phase_reopens_one_complete_revision() {
    for phase in ["blocks", "manifest", "staged", "published"] {
        let dir = FixtureDir::new();
        {
            let store = LockedStore::open(&dir.path).unwrap();
            store
                .publish(0, BTreeMap::from([
                    ("states".into(), b"old state".to_vec()),
                    ("events".into(), b"old event".to_vec()),
                ]))
                .unwrap();
        }
        let mut writer = child(&dir.path, &format!("crash-{phase}"), "a");
        wait_marker(&dir.path.join("ready-a"));
        assert!(LockedStore::open(&dir.path).unwrap_err().contains("CORE2_STORAGE_BUSY"));
        writer.kill().unwrap();
        assert!(!writer.wait().unwrap().success());
        let store = LockedStore::open(&dir.path).unwrap();
        let view = store.load().unwrap().unwrap();
        assert!(view.recovery.is_none(), "{phase}: valid durable pointer needs no guessed recovery");
        let (revision, state, event) = if phase == "published" {
            (2, b"new state".as_slice(), b"new event".as_slice())
        } else {
            (1, b"old state".as_slice(), b"old event".as_slice())
        };
        assert_eq!(view.manifest.revision, revision, "{phase}");
        assert_eq!(store.read_block(&view.manifest.roots["states"]).unwrap(), state, "{phase}");
        assert_eq!(store.read_block(&view.manifest.roots["events"]).unwrap(), event, "{phase}");
        assert!(store.publish(0, updates("stale retry")).unwrap_err().contains("CORE2_REVISION_CONFLICT"));
        assert_eq!(store.publish(revision, updates("continued")).unwrap().manifest.revision, revision + 1);
    }
}

#[cfg(windows)]
#[test]
fn core2_windows_locked_pointer_failure_preserves_previous_view_and_can_retry_after_release() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    for name in ["current.json", "last-good.json"] {
        let dir = FixtureDir::new();
        {
            let store = LockedStore::open(&dir.path).unwrap();
            store.publish(0, updates("first")).unwrap();
            store.publish(1, updates("second")).unwrap();
        }
        let current = dir.path.join("core2/current.json");
        let previous_bytes = fs::read(&current).unwrap();
        // Other programs may keep a readable handle without granting FILE_SHARE_DELETE.
        // Allow normal reads, but make replacing the target genuinely fail on Windows.
        let held = OpenOptions::new().read(true).share_mode(0x1 | 0x2)
            .open(dir.path.join("core2").join(name)).unwrap();
        {
            let store = LockedStore::open(&dir.path).unwrap();
            assert!(store.publish(2, updates("third")).unwrap_err().contains("CORE2_POINTER_REPLACE"), "{name}");
        }
        drop(held);
        assert_eq!(fs::read(&current).unwrap(), previous_bytes, "{name}");
        let store = LockedStore::open(&dir.path).unwrap();
        let old = store.load().unwrap().unwrap();
        assert_eq!(old.manifest.revision, 2, "{name}");
        assert_eq!(store.read_block(&old.manifest.roots["states"]).unwrap(), b"second");
        assert_eq!(store.publish(2, updates("third")).unwrap().manifest.revision, 3);
        drop(store);
        let store = LockedStore::open(&dir.path).unwrap();
        let new = store.load().unwrap().unwrap();
        assert_eq!(new.manifest.revision, 3);
        assert_eq!(store.read_block(&new.manifest.roots["states"]).unwrap(), b"third");
    }
}
