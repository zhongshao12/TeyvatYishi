use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const STORES: &[&str] = &[
    "branches",
    "states",
    "sources",
    "sourcePositions",
    "operations",
    "events",
    "eventIds",
    "effects",
    "memories",
    "knowledge",
    "commitments",
    "jobs",
    "snapshots",
    "slots",
    "assets",
    "indexMeta",
    "postings",
];
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
thread_local! { static IO_PROFILE: RefCell<BTreeMap<&'static str, f64>> = RefCell::new(BTreeMap::new()); }
#[cfg(test)]
pub(crate) struct IoTimer(&'static str, std::time::Instant);
#[cfg(test)]
impl IoTimer {
    pub(crate) fn start(key: &'static str) -> Self {
        Self(key, std::time::Instant::now())
    }
}
#[cfg(test)]
impl Drop for IoTimer {
    fn drop(&mut self) {
        IO_PROFILE.with(|profile| {
            *profile.borrow_mut().entry(self.0).or_default() +=
                self.1.elapsed().as_secs_f64() * 1000.0
        });
    }
}
#[cfg(test)]
pub(crate) fn take_io_profile() -> BTreeMap<&'static str, f64> {
    IO_PROFILE.with(|profile| std::mem::take(&mut *profile.borrow_mut()))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct BlockRef {
    pub path: String,
    pub checksum: String,
    pub size: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Manifest {
    pub format_version: u8,
    pub revision: u64,
    pub roots: BTreeMap<String, BlockRef>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Pointer {
    format_version: u8,
    revision: u64,
    manifest: BlockRef,
    previous: Option<BlockRef>,
}
#[derive(Clone, Debug)]
pub(crate) struct LoadedView {
    pub manifest: Manifest,
    pub recovery: Option<String>,
    reference: BlockRef,
    previous: Option<BlockRef>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum FaultPoint {
    BlocksSynced,
    ManifestSynced,
    PointerStaged,
    PointerPublished,
}
#[derive(Debug)]
pub(crate) struct LockedStore {
    root: PathBuf,
    lock: File,
    // Bounded and tied to this OS lock. Immutable references are compared in full.
    root_cache: RefCell<VecDeque<(BlockRef, TableRoot)>>,
    root_bytes: RefCell<VecDeque<(BlockRef, Arc<Vec<u8>>)>>,
    page_cache: RefCell<VecDeque<(TablePageRef, Arc<Vec<TableRow>>)>>,
    #[cfg(test)]
    block_reads: std::cell::Cell<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct TablePageRef {
    pub first: String,
    pub last: String,
    pub count: usize,
    pub block: BlockRef,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TableRoot {
    pub pages: Vec<TablePageRef>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TableRow {
    pub key: String,
    pub value_json: String,
}
#[derive(Clone, Debug)]
pub(crate) struct RowChange {
    pub store: String,
    pub key: String,
    pub value_json: Option<String>,
}

fn valid_row_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 2048 && !key.chars().any(char::is_control)
}
fn partition_key(store: &str, key: &str) -> String {
    let parts: Vec<_> = key.split('/').collect();
    if store == "events" && parts.len() == 5 {
        parts[..3].join("/")
    } else {
        String::new()
    }
}
fn validate_row_json(text: &str) -> Result<(), String> {
    #[cfg(test)]
    IO_PROFILE.with(|profile| *profile.borrow_mut().entry("row_json_checks").or_default() += 1.0);
    fn visit(value: &serde_json::Value, depth: usize) -> bool {
        if depth > 64 {
            return false;
        }
        match value {
            serde_json::Value::Array(values) => values.iter().all(|v| visit(v, depth + 1)),
            serde_json::Value::Object(values) => values.iter().all(|(key, value)| {
                !matches!(key.as_str(), "__proto__" | "prototype" | "constructor")
                    && visit(value, depth + 1)
            }),
            _ => true,
        }
    }
    let value = serde_json::from_str(text).map_err(|e| format!("CORE2_INVALID_ROW_JSON: {e}"))?;
    if !visit(&value, 0) {
        return Err("CORE2_INVALID_ROW_JSON".into());
    }
    Ok(())
}

pub(crate) fn checksum_bytes(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
pub(crate) fn nonce() -> Result<String, String> {
    Ok(format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("CORE2_FILE_CLOCK: {e}"))?
            .as_nanos(),
        NEXT_FILE.fetch_add(1, Ordering::Relaxed)
    ))
}
fn checked_existing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err("CORE2_LINK_FORBIDDEN".into()),
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("CORE2_PATH_CHECK: {err}")),
    }
}
fn ensure_directory(path: &Path) -> Result<(), String> {
    checked_existing(path)?;
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            checked_existing(path)?;
            if path.is_dir() {
                Ok(())
            } else {
                Err("CORE2_INVALID_ROOT".into())
            }
        }
        Err(err) => Err(format!("CORE2_CREATE_DIRECTORY: {err}")),
    }
}
fn reference_name(path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let (prefix, suffix) = match parts[0] {
        "blocks" => ("block-", ".bin"),
        "manifests" => ("manifest-", ".json"),
        _ => return false,
    };
    let Some(body) = parts[1]
        .strip_prefix(prefix)
        .and_then(|value| value.strip_suffix(suffix))
    else {
        return false;
    };
    !body.is_empty()
        && body
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'-')
}
fn valid_reference(reference: &BlockRef) -> bool {
    reference_name(&reference.path)
        && reference.checksum.len() == 16
        && reference
            .checksum
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl Drop for LockedStore {
    fn drop(&mut self) {
        let _ = self.lock.unlock();
    }
}
impl LockedStore {
    pub fn table_root(&self, view: &LoadedView, store: &str) -> Result<TableRoot, String> {
        if !STORES.contains(&store) {
            return Err("CORE2_INVALID_STORE".into());
        }
        let Some(reference) = view.manifest.roots.get(store) else {
            return Ok(TableRoot::default());
        };
        if let Some(root) = self
            .root_cache
            .borrow()
            .iter()
            .find(|(saved, _)| saved == reference)
            .map(|(_, root)| root.clone())
        {
            return Ok(root);
        }
        let root: TableRoot = serde_json::from_slice(&self.read_root_bytes(reference)?)
            .map_err(|e| format!("CORE2_TABLE_ROOT_INVALID: {e}"))?;
        for (i, page) in root.pages.iter().enumerate() {
            if page.count == 0
                || page.count > 200
                || !valid_row_key(&page.first)
                || !valid_row_key(&page.last)
                || page.first > page.last
                || !valid_reference(&page.block)
                || !page.block.path.starts_with("blocks/")
                || (i > 0 && root.pages[i - 1].last >= page.first)
            {
                return Err("CORE2_TABLE_ROOT_INVALID".into());
            }
        }
        let mut cache = self.root_cache.borrow_mut();
        if cache.len() >= STORES.len() {
            cache.pop_front();
        }
        cache.push_back((reference.clone(), root.clone()));
        Ok(root)
    }
    fn read_page(&self, page: &TablePageRef) -> Result<Arc<Vec<TableRow>>, String> {
        if let Some(rows) = self
            .page_cache
            .borrow()
            .iter()
            .find(|(saved, _)| saved == page)
            .map(|(_, rows)| rows.clone())
        {
            return Ok(rows);
        }
        let rows: Vec<TableRow> = serde_json::from_slice(&self.read_block(&page.block)?)
            .map_err(|e| format!("CORE2_TABLE_PAGE_INVALID: {e}"))?;
        if rows.len() != page.count
            || rows.first().is_none_or(|row| row.key != page.first)
            || rows.last().is_none_or(|row| row.key != page.last)
        {
            return Err("CORE2_TABLE_PAGE_INVALID".into());
        }
        for (i, row) in rows.iter().enumerate() {
            if !valid_row_key(&row.key) || (i > 0 && rows[i - 1].key >= row.key) {
                return Err("CORE2_TABLE_PAGE_INVALID".into());
            }
            // Check the page envelope here. Validate a payload before returning it,
            // not every unrelated cold record whenever one key is requested.
        }
        let mut cache = self.page_cache.borrow_mut();
        let rows = Arc::new(rows);
        const CACHE_BYTES: u64 = 8 * 1024 * 1024;
        if page.block.size <= CACHE_BYTES {
            while !cache.is_empty()
                && (cache.len() >= 16
                    || cache.iter().map(|(saved, _)| saved.block.size).sum::<u64>()
                        + page.block.size
                        > CACHE_BYTES)
            {
                cache.pop_front();
            }
            cache.push_back((page.clone(), rows.clone()));
        }
        Ok(rows)
    }
    pub fn get_row(
        &self,
        view: &LoadedView,
        store: &str,
        key: &str,
    ) -> Result<Option<String>, String> {
        if !valid_row_key(key) {
            return Err("CORE2_INVALID_ROW_KEY".into());
        }
        let root = self.table_root(view, store)?;
        let index = root.pages.partition_point(|page| page.last.as_str() < key);
        let Some(page) = root
            .pages
            .get(index)
            .filter(|page| page.first.as_str() <= key)
        else {
            return Ok(None);
        };
        let rows = self.read_page(page)?;
        let value = rows
            .binary_search_by(|row| row.key.as_str().cmp(key))
            .ok()
            .map(|i| rows[i].value_json.clone());
        if let Some(text) = &value {
            validate_row_json(text)?;
        }
        Ok(value)
    }
    pub fn scan_rows(
        &self,
        view: &LoadedView,
        store: &str,
        prefix: &str,
        after: Option<&str>,
        limit: usize,
    ) -> Result<Vec<TableRow>, String> {
        if !(1..=200).contains(&limit)
            || (!prefix.is_empty() && !valid_row_key(prefix))
            || after.is_some_and(|key| !valid_row_key(key) || !key.starts_with(prefix))
        {
            return Err("CORE2_INVALID_ROW_QUERY".into());
        }
        let root = self.table_root(view, store)?;
        let start = after.unwrap_or(prefix);
        let first = root
            .pages
            .partition_point(|page| page.last.as_str() < start);
        let mut result = Vec::new();
        for page in &root.pages[first..] {
            if page.first.as_str() > prefix && !page.first.starts_with(prefix) {
                break;
            }
            for row in self.read_page(page)?.iter() {
                if row.key.as_str() < prefix || after.is_some_and(|after| row.key.as_str() <= after)
                {
                    continue;
                }
                if !row.key.starts_with(prefix) {
                    return Ok(result);
                }
                validate_row_json(&row.value_json)?;
                result.push(row.clone());
                if result.len() == limit {
                    return Ok(result);
                }
            }
        }
        Ok(result)
    }
    #[cfg(test)]
    pub fn apply_rows(&self, expected: u64, changes: Vec<RowChange>) -> Result<LoadedView, String> {
        self.apply_rows_with_fault(expected, changes, |_| Ok(()))
    }
    pub fn apply_rows_with_fault(
        &self,
        expected: u64,
        changes: Vec<RowChange>,
        fault: impl Fn(FaultPoint) -> Result<(), String>,
    ) -> Result<LoadedView, String> {
        let mut grouped: BTreeMap<String, BTreeMap<String, Option<String>>> = BTreeMap::new();
        for change in changes {
            if !STORES.contains(&change.store.as_str()) {
                return Err("CORE2_INVALID_STORE".into());
            }
            if !valid_row_key(&change.key) {
                return Err("CORE2_INVALID_ROW_KEY".into());
            }
            if let Some(text) = &change.value_json {
                validate_row_json(text)?;
            }
            if grouped
                .entry(change.store)
                .or_default()
                .insert(change.key, change.value_json)
                .is_some()
            {
                return Err("CORE2_DUPLICATE_ROW_CHANGE".into());
            }
        }
        let view = self.load()?;
        if view.as_ref().is_some_and(|v| v.recovery.is_some()) {
            return Err("CORE2_RECOVERY_REQUIRES_CONFIRMATION".into());
        }
        if view.as_ref().map_or(0, |v| v.manifest.revision) != expected {
            return Err("CORE2_REVISION_CONFLICT".into());
        }
        // Read and validate affected pages before writing anything. Unchanged pages stay immutable.
        let mut prepared = Vec::new();
        for (store, edits) in grouped {
            let root = match &view {
                Some(view) => self.table_root(view, &store)?,
                None => TableRoot::default(),
            };
            let mut buckets: BTreeMap<(Option<usize>, String), BTreeMap<String, Option<String>>> =
                BTreeMap::new();
            for (key, value) in edits {
                let partition = partition_key(&store, &key);
                let position = root.pages.partition_point(|page| page.last < key);
                let current = position.min(root.pages.len().saturating_sub(1));
                let page_index = if root
                    .pages
                    .get(current)
                    .is_some_and(|page| partition_key(&store, &page.first) == partition)
                {
                    Some(current)
                } else if position > 0
                    && root
                        .pages
                        .get(position - 1)
                        .is_some_and(|page| partition_key(&store, &page.first) == partition)
                {
                    Some(position - 1)
                } else {
                    None
                };
                buckets
                    .entry((page_index, partition))
                    .or_default()
                    .insert(key, value);
            }
            let mut replacements = BTreeMap::new();
            let mut additions = Vec::new();
            for ((i, _partition), edits) in buckets {
                let rows = match i.and_then(|i| root.pages.get(i)) {
                    Some(page) => self.read_page(page)?,
                    None => Arc::new(Vec::new()),
                };
                let mut values: BTreeMap<_, _> = rows
                    .iter()
                    .map(|row| (row.key.clone(), row.value_json.clone()))
                    .collect();
                for (key, value) in edits {
                    match value {
                        Some(text) => {
                            values.insert(key, text);
                        }
                        None => {
                            values.remove(&key);
                        }
                    }
                }
                let changed = values.len() != rows.len()
                    || rows
                        .iter()
                        .any(|row| values.get(&row.key) != Some(&row.value_json));
                if changed {
                    let rows = values
                        .into_iter()
                        .map(|(key, value_json)| TableRow { key, value_json })
                        .collect::<Vec<_>>();
                    match i {
                        Some(i) => {
                            replacements.insert(i, rows);
                        }
                        None => additions.push(rows),
                    }
                }
            }
            prepared.push((store, root, replacements, additions));
        }
        let mut updates = BTreeMap::new();
        for (store, root, replacements, additions) in prepared {
            if replacements.is_empty() && additions.is_empty() {
                continue;
            }
            let mut pages = Vec::new();
            let write_rows =
                |rows: &[TableRow], pages: &mut Vec<TablePageRef>| -> Result<(), String> {
                    for chunk in rows.chunks(200) {
                        let bytes = serde_json::to_vec(chunk)
                            .map_err(|e| format!("CORE2_TABLE_PAGE_ENCODE: {e}"))?;
                        let block = self.write_new("blocks", "block", "bin", &bytes)?;
                        fault(FaultPoint::BlocksSynced)?;
                        pages.push(TablePageRef {
                            first: chunk[0].key.clone(),
                            last: chunk[chunk.len() - 1].key.clone(),
                            count: chunk.len(),
                            block,
                        });
                    }
                    Ok(())
                };
            for (i, page) in root.pages.iter().enumerate() {
                if let Some(rows) = replacements.get(&i) {
                    write_rows(rows, &mut pages)?;
                } else {
                    pages.push(page.clone());
                }
            }
            for rows in additions {
                write_rows(&rows, &mut pages)?;
            }
            pages.sort_by(|a, b| a.first.cmp(&b.first));
            updates.insert(
                store,
                serde_json::to_vec(&TableRoot { pages })
                    .map_err(|e| format!("CORE2_TABLE_ROOT_ENCODE: {e}"))?,
            );
        }
        self.publish_with_fault(expected, updates, fault)
    }
    pub fn open(base: &Path) -> Result<Self, String> {
        checked_existing(base)?;
        let base = fs::canonicalize(base).map_err(|e| format!("CORE2_INVALID_ROOT: {e}"))?;
        if !base.is_dir() {
            return Err("CORE2_INVALID_ROOT".into());
        }
        let root = base.join("core2");
        ensure_directory(&root)?;
        for name in ["blocks", "manifests"] {
            ensure_directory(&root.join(name))?;
        }
        let root = fs::canonicalize(root).map_err(|e| format!("CORE2_INVALID_ROOT: {e}"))?;
        if !root.starts_with(&base) || root == base {
            return Err("CORE2_INVALID_ROOT".into());
        }
        let lock_path = root.join("store.lock");
        checked_existing(&lock_path)?;
        let mut lock_options = OpenOptions::new();
        lock_options
            .read(true)
            .write(true)
            .create(true)
            .truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ | FILE_SHARE_WRITE, deliberately NOT FILE_SHARE_DELETE.
            lock_options.share_mode(0x1 | 0x2);
        }
        let lock = lock_options
            .open(&lock_path)
            .map_err(|e| format!("CORE2_OPEN_LOCK: {e}"))?;
        lock.try_lock().map_err(|err| match err {
            TryLockError::WouldBlock => "CORE2_STORAGE_BUSY".into(),
            TryLockError::Error(error) => format!("CORE2_LOCK_FAILED: {error}"),
        })?;
        Ok(Self {
            root,
            lock,
            root_cache: RefCell::new(VecDeque::new()),
            root_bytes: RefCell::new(VecDeque::new()),
            page_cache: RefCell::new(VecDeque::new()),
            #[cfg(test)]
            block_reads: std::cell::Cell::new(0),
        })
    }
    fn reference_path(&self, reference: &BlockRef) -> Result<PathBuf, String> {
        if !valid_reference(reference) {
            return Err("CORE2_INVALID_REFERENCE".into());
        }
        checked_existing(&self.root)?;
        let path = self.root.join(&reference.path);
        checked_existing(path.parent().ok_or("CORE2_INVALID_REFERENCE")?)?;
        checked_existing(&path)?;
        let actual =
            fs::canonicalize(&path).map_err(|e| format!("CORE2_REFERENCE_MISSING: {e}"))?;
        if !actual.starts_with(&self.root) || !actual.is_file() {
            return Err("CORE2_INVALID_REFERENCE".into());
        }
        Ok(actual)
    }
    pub fn read_block(&self, reference: &BlockRef) -> Result<Vec<u8>, String> {
        #[cfg(test)]
        let _profile = IoTimer::start("read_block_ms");
        #[cfg(test)]
        self.block_reads.set(self.block_reads.get() + 1);
        let bytes = fs::read(self.reference_path(reference)?)
            .map_err(|e| format!("CORE2_READ_BLOCK: {e}"))?;
        if bytes.len() as u64 != reference.size || checksum_bytes(&bytes) != reference.checksum {
            return Err("CORE2_block_checksum_mismatch".into());
        }
        Ok(bytes)
    }
    // Root metadata only, bounded and discarded with this OS lock. Compare the
    // full immutable reference; the first read still checks the actual bytes.
    fn read_root_bytes(&self, reference: &BlockRef) -> Result<Arc<Vec<u8>>, String> {
        if let Some(bytes) = self
            .root_bytes
            .borrow()
            .iter()
            .find(|(saved, _)| saved == reference)
            .map(|(_, bytes)| bytes.clone())
        {
            return Ok(bytes);
        }
        let bytes = Arc::new(self.read_block(reference)?);
        const ROOT_CACHE_BYTES: u64 = 256 * 1024;
        if reference.size <= ROOT_CACHE_BYTES {
            let mut cache = self.root_bytes.borrow_mut();
            while !cache.is_empty()
                && (cache.len() >= STORES.len()
                    || cache.iter().map(|(saved, _)| saved.size).sum::<u64>() + reference.size
                        > ROOT_CACHE_BYTES)
            {
                cache.pop_front();
            }
            cache.push_back((reference.clone(), bytes.clone()));
        }
        Ok(bytes)
    }
    #[cfg(test)]
    pub fn block_read_count(&self) -> usize {
        self.block_reads.get()
    }
    fn read_manifest(&self, reference: &BlockRef) -> Result<LoadedView, String> {
        if !reference.path.starts_with("manifests/") {
            return Err("CORE2_INVALID_REFERENCE".into());
        }
        let manifest: Manifest = serde_json::from_slice(&self.read_block(reference)?)
            .map_err(|e| format!("CORE2_MANIFEST_INVALID: {e}"))?;
        if manifest.format_version != 1
            || manifest.revision == 0
            || manifest
                .roots
                .keys()
                .any(|key| !STORES.contains(&key.as_str()))
        {
            return Err("CORE2_MANIFEST_INVALID".into());
        }
        for block in manifest.roots.values() {
            if !block.path.starts_with("blocks/") {
                return Err("CORE2_INVALID_REFERENCE".into());
            }
            self.read_root_bytes(block)?;
        }
        Ok(LoadedView {
            manifest,
            recovery: None,
            reference: reference.clone(),
            previous: None,
        })
    }
    fn read_pointer(&self, name: &str) -> Result<Option<Pointer>, String> {
        let path = self.root.join(name);
        checked_existing(&path)?;
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("CORE2_POINTER_READ: {e}")),
        };
        let value: Pointer =
            serde_json::from_slice(&bytes).map_err(|e| format!("CORE2_POINTER_INVALID: {e}"))?;
        if value.format_version != 1 || value.revision == 0 {
            return Err("CORE2_POINTER_INVALID".into());
        }
        Ok(Some(value))
    }
    pub fn load(&self) -> Result<Option<LoadedView>, String> {
        #[cfg(test)]
        let _profile = IoTimer::start("load_ms");
        let primary = self.read_pointer("current.json");
        let mut candidates = Vec::new();
        let mut upper_revision = None;
        let reason = match primary {
            Ok(Some(pointer)) => {
                upper_revision = Some(pointer.revision);
                if let Some(previous) = &pointer.previous {
                    candidates.push((previous.clone(), None));
                }
                match self.read_manifest(&pointer.manifest) {
                    Ok(mut view) if view.manifest.revision == pointer.revision => {
                        view.previous = pointer.previous;
                        return Ok(Some(view));
                    }
                    Ok(_) => "CORE2_POINTER_REVISION_MISMATCH".into(),
                    Err(error) => error,
                }
            }
            Ok(None) => {
                if self.read_pointer("last-good.json")?.is_none() {
                    return Ok(None);
                }
                "CORE2_CURRENT_POINTER_MISSING".into()
            }
            Err(error) => error,
        };
        let mut failures = vec![reason];
        match self.read_pointer("last-good.json") {
            Ok(Some(pointer)) => {
                candidates.push((pointer.manifest, Some(pointer.revision)));
                if let Some(previous) = pointer.previous {
                    candidates.push((previous, None));
                }
            }
            Ok(None) => (),
            Err(error) => failures.push(error),
        }
        let mut seen = std::collections::BTreeSet::new();
        for (reference, exact_revision) in candidates {
            if !seen.insert(reference.path.clone()) {
                continue;
            }
            match self.read_manifest(&reference) {
                Ok(mut view)
                    if exact_revision.is_none_or(|revision| revision == view.manifest.revision)
                        && upper_revision
                            .is_none_or(|revision| view.manifest.revision < revision) =>
                {
                    view.recovery = Some(failures.join("; "));
                    return Ok(Some(view));
                }
                Ok(_) => failures.push("CORE2_RECOVERY_REVISION_MISMATCH".into()),
                Err(error) => failures.push(error),
            }
        }
        Err(format!("CORE2_NO_VALID_VIEW: {}", failures.join("; ")))
    }
    pub fn write_binary(&self, bytes: &[u8]) -> Result<BlockRef, String> {
        self.write_new("blocks", "block", "bin", bytes)
    }
    fn write_new(
        &self,
        directory: &str,
        prefix: &str,
        suffix: &str,
        bytes: &[u8],
    ) -> Result<BlockRef, String> {
        #[cfg(test)]
        let _profile = IoTimer::start("write_block_ms");
        let path = format!("{directory}/{prefix}-{}.{suffix}", nonce()?);
        if !reference_name(&path) {
            return Err("CORE2_INVALID_REFERENCE".into());
        }
        let parent = self.root.join(directory);
        checked_existing(&parent)?;
        if fs::canonicalize(&parent).map_err(|e| format!("CORE2_PATH_CHECK: {e}"))? != parent {
            return Err("CORE2_LINK_FORBIDDEN".into());
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.root.join(&path))
            .map_err(|e| format!("CORE2_WRITE_BLOCK: {e}"))?;
        file.write_all(bytes)
            .map_err(|e| format!("CORE2_WRITE_BLOCK: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("CORE2_SYNC_BLOCK: {e}"))?;
        let reference = BlockRef {
            path,
            checksum: checksum_bytes(bytes),
            size: bytes.len() as u64,
        };
        if self.read_block(&reference)? != bytes {
            return Err("CORE2_BLOCK_READBACK_MISMATCH".into());
        }
        Ok(reference)
    }
    fn replace_pointer(
        &self,
        name: &str,
        pointer: &Pointer,
        staged: impl Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        #[cfg(test)]
        let _profile = IoTimer::start("replace_pointer_ms");
        let target = self.root.join(name);
        checked_existing(&target)?;
        let temp = self.root.join(format!("pointer-{}.tmp", nonce()?));
        let bytes =
            serde_json::to_vec(pointer).map_err(|e| format!("CORE2_POINTER_ENCODE: {e}"))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("CORE2_POINTER_WRITE: {e}"))?;
        file.write_all(&bytes)
            .map_err(|e| format!("CORE2_POINTER_WRITE: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("CORE2_POINTER_SYNC: {e}"))?;
        drop(file);
        staged()?;
        // Never delete target first. A failed same-directory replacement keeps it.
        fs::rename(temp, target).map_err(|e| format!("CORE2_POINTER_REPLACE: {e}"))?;
        #[cfg(not(windows))]
        File::open(&self.root)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| format!("CORE2_DIRECTORY_SYNC: {e}"))?;
        Ok(())
    }
    #[cfg(test)]
    pub fn publish(
        &self,
        expected: u64,
        updates: BTreeMap<String, Vec<u8>>,
    ) -> Result<LoadedView, String> {
        self.publish_with_fault(expected, updates, |_| Ok(()))
    }
    pub fn publish_with_fault(
        &self,
        expected: u64,
        updates: BTreeMap<String, Vec<u8>>,
        fault: impl Fn(FaultPoint) -> Result<(), String>,
    ) -> Result<LoadedView, String> {
        if updates.keys().any(|key| !STORES.contains(&key.as_str())) {
            return Err("CORE2_INVALID_STORE".into());
        }
        let previous = self.load()?;
        if previous
            .as_ref()
            .is_some_and(|view| view.recovery.is_some())
        {
            return Err("CORE2_RECOVERY_REQUIRES_CONFIRMATION".into());
        }
        if previous.as_ref().map_or(0, |view| view.manifest.revision) != expected {
            return Err("CORE2_REVISION_CONFLICT".into());
        }
        let revision = expected.checked_add(1).ok_or("CORE2_REVISION_OVERFLOW")?;
        let mut roots = previous
            .as_ref()
            .map_or_else(BTreeMap::new, |view| view.manifest.roots.clone());
        for (key, bytes) in updates {
            roots.insert(key, self.write_new("blocks", "block", "bin", &bytes)?);
            fault(FaultPoint::BlocksSynced)?;
        }
        let manifest = Manifest {
            format_version: 1,
            revision,
            roots,
        };
        let reference = self.write_new(
            "manifests",
            "manifest",
            "json",
            &serde_json::to_vec(&manifest).map_err(|e| format!("CORE2_MANIFEST_ENCODE: {e}"))?,
        )?;
        fault(FaultPoint::ManifestSynced)?;
        let pointer = Pointer {
            format_version: 1,
            revision,
            manifest: reference.clone(),
            previous: previous.as_ref().map(|view| view.reference.clone()),
        };
        if let Some(old) = previous {
            let backup = Pointer {
                format_version: 1,
                revision: old.manifest.revision,
                manifest: old.reference,
                previous: old.previous,
            };
            self.replace_pointer("last-good.json", &backup, || Ok(()))?;
        }
        self.replace_pointer("current.json", &pointer, || {
            fault(FaultPoint::PointerStaged)
        })?;
        fault(FaultPoint::PointerPublished)?;
        Ok(LoadedView {
            manifest,
            reference,
            previous: pointer.previous,
            recovery: None,
        })
    }
}
