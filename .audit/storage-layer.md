# Persistence / Storage / Save-System Audit — 旅行者纪事 (`yuanshen`)

**Scope:** `services/dbService.ts` (1975 lines), `services/storage/*`, `services/savePackage.ts`, `services/exportService.ts`, `utils/saveDeltaStorage.ts`, `utils/saveAssetStorage.ts`, `utils/saveImageCompactor.ts`, `utils/saveRuntimeCompactor.ts`, `utils/longSessionRetention.ts`, `services/cloudBackup*.ts`, `services/githubCloudSave.ts`, `services/githubRequest.ts`, `services/desktop/*`, `services/teyvatSaveMigration.ts`, `compat/legacy-hsr/*`, `hooks/useGame/saveLoadWorkflow.ts`, `hooks/useGame/turnSnapshot.ts`, `hooks/useGame/sendWorkflow.ts` (save-relevant ranges), `workers/*`, and the UI surfaces that drive them.

**Method:** read-only static analysis. Every claim below cites a file and line numbers that were actually opened. Findings delegated to two parallel deep-dives (GitHub/cloud sync; legacy migration) were spot-checked by me at `compat/legacy-hsr/migrate.ts:470-476`, `components/features/SaveLoad/SaveMigrationDialog.tsx:23`, `services/savePackage.ts:485-518`, `services/githubCloudSave.ts:474-526, 596-621`, `services/cloudBackupPackage.ts:125-184`. No build, test, or package-manager command was run.

**Headline:** this is a *thoughtful* storage layer — real IndexedDB transactions on the write path, content-hash conflict detection, SHA-256 verification on every cloud part, a genuine distributed lease for the catalog repair task, and an aggressive snapshot-pruning policy. The problems are not "no design"; they are **an inconsistent safety envelope** (three different notions of "committed"), **severe per-turn write amplification in desktop mode**, **no write serialization anywhere**, and **25 swallow-and-warn wrappers** that make the desktop mirror a silent single point of divergence.

---

## 1. `dbService.ts` — responsibility map, and the atomicity verdict

### 1.1 Section map (1975 lines, 9 unrelated concerns in one module)

| Lines | Responsibility | Should live in |
|---|---|---|
| 1–89 | Imports + re-exports of catalog/repair types | — |
| 91–125 | DB constants (`DB_NAME='TimeJourneyDB'`, `DB_VERSION=5`, 5 store names, `MAX_DELTA_NODES_PER_CHECKPOINT=6`, lease constants) + local types | `storage/dbSchema.ts` |
| 127–177 | `openDB()` — connection lifecycle, schema creation, versionchange, 8 s timeout, blocked handling | `storage/idbConnection.ts` |
| 179–321 | **Save write path**: `saveGame`, `saveMigratedTeyvatGameAtomically`, `saveGameInternal` | `storage/saveWriter.ts` |
| 323–351 | `deleteManagedSaveItems` (retention eviction + hidden-base marking) | `storage/saveRetentionOps.ts` |
| 353–384 | Catalog reads (`getSaveList`, `getSaveCatalogSnapshot`) | `storage/saveCatalogReader.ts` |
| 386–465 | Load path (`loadSave`, `loadSaveForCloudTransfer`, `loadLatestSave`) | `storage/saveLoader.ts` |
| 467–557 | Delete paths (`deleteSave`, `forceDeleteSave`, `deleteSaveTree`, `deleteLegacyBackupSaves`, `loadSaveTree`) | `storage/saveDeleter.ts` |
| 559–719 | **Cloud-merge staging** (`stage/load/delete/clear/commit` + the 5-store commit transaction) | `cloud/cloudMergeStaging.ts` |
| 721–835 | `replaceAllSaves`, mirror rebuild/restore, desktop backup entry points | `storage/saveReplacer.ts` |
| 837–863 | Referenced-asset collection, `hasAnySave` | `storage/saveAssetRefs.ts` |
| 865–1046 | **Delta bookkeeping** (base resolution, reference counting, orphan cleanup, scans) | `storage/saveDeltaIndex.ts` |
| 1048–1102 | Asset record load + `migrateLoadedSaveAssets` | `storage/saveAssetOps.ts` |
| **1104–1317** | **~22 `…Safely` desktop-mirror wrappers that all swallow errors into `console.warn`** | `storage/desktopMirrorGuards.ts` |
| 1319–1411 | Settings I/O (`saveSetting`/`loadSetting`/`deleteSetting` + indexed/safely variants) | `storage/settingsStore.ts` |
| 1413–1452 | `rotateManagedSaves(Safely)` + `markSaveAsHiddenDeltaBase` | `storage/saveRetentionOps.ts` |
| 1454–1618 | Export/import (JSON, `.ktysave` package, tree package, imported-tree remap) | `services/saveTransfer.ts` |
| 1620–1653 | Staging key sanitizers, `normalizeSaveType`, `sortSaveSummaries` | `storage/saveKeys.ts` |
| 1655–1697 | Indexed catalog reads | `storage/saveCatalogReader.ts` |
| 1699–1878 | **Catalog repair task + `SAVE_CATALOG_REPAIR_LEASE` fencing** | `storage/saveCatalogRepairOps.ts` |
| 1880–1967 | `buildSaveSummary` / `summarizeSave` / `estimateSaveSize` | `storage/saveSummary.ts` |
| 1969–1975 | `sanitizeFilename` | `utils/filename.ts` |

That is **nine** distinct responsibilities in one 1975-line module, with a 213-line block (`1104–1317`) that exists only because the module cannot decide whether mirror failures are fatal.

### 1.2 There IS a real transaction — but it only guards one of three persistence steps

The write path composes: **(1)** desktop file-primary write → **(2)** IndexedDB transaction → **(3)** post-commit mirror + retention rotation. Only step 2 is a transaction.

`services/dbService.ts:256-305` — a genuine 4-store all-or-nothing commit, with an injectable abort barrier for tests:

```ts
    saved = await new Promise<...>((resolve, reject) => {
    const tx = db.transaction([SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_ASSETS_STORE, SAVE_NODE_DELTAS_STORE], 'readwrite');
    ...
      try {
        options.afterIndexedDbStaging?.();
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve({ id: savedId, save: { ...data, id: savedId } as 存档数据, delta: savedDelta });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('存档事务已中止'));
```

`services/dbService.ts:636-718` — `commitCloudMergeStagingTransaction` is the best transaction in the file: it commits across `SETTINGS_STORE` (staging) + saves + summaries + assets + deltas in **one** transaction, validates every staged record, and calls `tx.abort()` on any structural problem (`fail()` at 655-660). Because `cursor.delete()` happens inside the same transaction, a crash leaves the staging intact and the local save untouched. This is correct.

### 1.3 …but there are ad-hoc `await` sequences around it that leave partially-written state

**(a) Desktop-primary path has no journal — the transaction journal is dead on the path that needs it.** `services/dbService.ts:1112-1133` writes a `saves/transactions/save-<id>-<txid>.json` marker, writes save+delta+assets, then deletes the marker:

```ts
async function writeDesktopPrimarySaveBeforeIndexedDbSafely(
  save: 存档数据, delta: SaveNodeDeltaRecord | null, assetRecords: SaveAssetRecord[],
): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  let transactionId: string | null = null;
  try {
    transactionId = await beginDesktopSaveTransaction(Number(save.id) || 0, { deltaNodeId: delta?.nodeId, assetIds: ... });
    await mirrorSaveToDesktop(save, buildSaveSummary(save));
    await mirrorSaveNodeDeltaToDesktop(delta);
    await mirrorAssetRecordsToDesktop(assetRecords);
    await finishDesktopSaveTransaction(Number(save.id) || 0, transactionId);
```

`mirrorSaveToDesktop` is itself **three** sequential non-transactional writes (`services/desktop/desktopSaveMirror.ts:142-144`): `writeJson(savePath)` → `writeMirrorIndex` → `writeSaveSequence`. A kill between them leaves `saves/<id>.json` on disk but absent from `saves/index.json`. The marker that would let you detect this IS written — and `repairUnresolvedDesktopSaveTransactions` exists (`desktopSaveMirror.ts:246-252`) — but it is **only callable manually from the Storage Manager UI** (`components/features/Settings/StorageManager.tsx:72, 685`); nothing runs it at startup. So the recovery mechanism exists and is never triggered.

**(b) The `catch` that is supposed to compensate cannot fire on the migration path.** `services/dbService.ts:306-313`:

```ts
  } catch (error) {
    if (desktopPrimaryWritten && desktopSaveId && desktopPrimarySave) {
      console.warn('[desktop-save-mirror] IndexedDB compatibility save failed after desktop primary write', error);
      await rotateManagedSavesSafely(db);
      return desktopSaveId;
    }
    throw error;
  }
```

On the migration path `desktopSaveId` is forced to `0` (`services/dbService.ts:236`: `options.requireIndexedDbAtomicCommit ? 0 : await reserveDesktopSaveIdSafely(db)`), so `desktopPrimaryWritten` is `false` by construction and this branch can never run there. On the normal path it *can* fire — and when it does, an IndexedDB failure is converted into a **success return value** (the desktop id) with only a `console.warn`. The caller (`hooks/useGame/saveLoadWorkflow.ts:237-242` → `commitActiveSaveTreeMeta`) then advances the active save-tree pointer as if everything committed. The IndexedDB catalog and the desktop mirror are now divergent and the caller believes otherwise.

**(c) Post-commit mirror writes are unconditional-success.** `services/dbService.ts:314-318`:

```ts
  if (!desktopPrimaryWritten || saved.id !== desktopSaveId) {
    await mirrorDesktopSaveSafely(saved.save);
    await mirrorDesktopSaveDeltaSafely(saved.delta);
    await mirrorDesktopAssetsSafely(assetRecords);
  }
  await rotateManagedSavesSafely(db);
  return saved.id;
```

Every one of those `…Safely` wrappers is `try { … } catch (error) { console.warn(...) }` — e.g. `services/dbService.ts:1104-1110`, `1160-1167`, `1303-1309`. So a successful-looking `saveGame()` return does not imply the mirror wrote. This matters *specifically* because reads prefer the mirror: `getSaveCatalogSnapshot` returns the desktop list whenever it is non-empty (`services/dbService.ts:363-372`), and `loadSave` prefers the mirror (`:387-388`). **A swallowed mirror failure therefore makes a correctly-committed IndexedDB save invisible in the UI.** This is the single most consequential pattern in the layer.

**(d) Retention rotation runs inside the same unguarded sequence.** `rotateManagedSavesSafely` (1415-1427) deletes nodes after the save; if it fails it warns and continues, which is the right call (favor keeping data) — but combined with (c) it means the observable node set can drift from the persisted one.

---

## 2. Write amplification & performance

### 2.1 Three full normalizations of the entire game state per turn

`normalizeTeyvatGameState` is not a shallow validator — it rebuilds every slice and **every chat message from scratch**: `models/teyvat/state.ts:87-114` → `models/teyvat/runtimeSlices.ts:428-455` (`normalizeConversationLog`), which for each entry reconstructs `structuredResponse`, `tokenUsage`, `debugMetadata` (including `systemPrompt` and the full `messages` array — `runtimeSlices.ts:408`), `preTurnState`, `narrativeImages`. Cost is Θ(all messages × per-message fields).

Per autosave the state is fully normalized **three times**:

1. `hooks/useGame/saveLoadWorkflow.ts:85` → `applyLegacyGameStateOverrides` → `hooks/useGameState.ts:424-466` `withLegacyChat` → `normalizeConversationLog` (all messages), plus `fromLegacyTurnCheckpoint` on the one retained snapshot (`useGameState.ts:439`).
2. `hooks/useGame/saveLoadWorkflow.ts:86-92` → `normalizeTeyvatGameState({...})` — **the entire state again**.
3. `services/dbService.ts:187` → `...normalizeTeyvatGameState(data)` — **the entire state a third time**, because `saveGame` re-normalizes a payload that `buildSavePayload` already normalized.

Call 3 is pure waste: `normalizeTeyvatGameState` is idempotent (`models/teyvat/state.ts:91-113` builds from `createEmptyTeyvatGameState()` and only reads `raw`), so re-running it cannot change the result.

### 2.2 Two full deep structural comparisons of the whole state per save

`utils/saveDeltaStorage.ts:191-214` `buildDeltaPayload` walks every field in `TEYVAT_DELTA_FIELDS` (`saveDeltaStorage.ts:68-86`: 旅行者/背包/世界/NPC/手机/世界树/图鉴/蒸汽鸟报/原著轨道/记忆/相册/任务/后台队列/叙事/gameSettings/apiSettings/theme) and deep-compares each against the base save:

```ts
  for (const key of TEYVAT_DELTA_FIELDS) {
    if (key === 'apiSettings') continue;
    if (!jsonCompatibleEqual(saveRecord[key], baseRecord[key])) {
      fields[key] = saveRecord[key];
    }
  }
```

`jsonCompatibleEqual` (`saveDeltaStorage.ts:292-326`) is a full recursive structural comparison. `buildSaveNodeDeltaRecord` is invoked **twice** per normal save — once for the desktop-primary delta (`services/dbService.ts:243-251`) and once inside the IndexedDB transaction (`services/dbService.ts:282-288`) — so the whole state is deep-walked **2× against the base, i.e. 4 traversals**, on every turn.

### 2.3 Desktop mode rewrites every album image as base64 on every turn

`utils/saveAssetStorage.ts:89-114` includes an asset whenever the runtime Blob cache has it (`hasAlbumAssetBlob`, line 93). The Blob cache holds up to **64 MB** (`utils/albumObjectUrl.ts:20` `MAX_ALBUM_CACHE_BYTES = 64 * 1024 * 1024`), and `loadSave` re-populates it for all album assets (`services/dbService.ts:410` → `restoreSaveAssetPayloadFromRecords` → `materializeSaveAssetRecord` → `rememberAlbumAssetBlob`, `saveAssetStorage.ts:157-158`). Therefore `assetRecords` normally contains **every image in the album**, every save, forever.

In desktop mode that set is written as base64 files before *every* IndexedDB write (`services/dbService.ts:252-254` → `writeDesktopPrimarySaveBeforeIndexedDbSafely` → `mirrorAssetRecordsToDesktop`, line 1126). `services/desktop/desktopAssetMirror.ts:374-391` builds the base64 on the **main thread** with 32 KB string concatenation:

```ts
  if (record.blob instanceof Blob) {
    const buffer = await record.blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
    }
    return { mimeType: ..., base64Content: btoa(binary) };
```

then `adapter.writeBase64File(path, payload.base64Content)` + `writeJson(metadataPath, mirrorRecord)` per asset (`desktopAssetMirror.ts:88-89`) + one `assets/index.json` rewrite (`:101`). With a realistic 20-image album at ~1.5 MB each, that is ~30 MB of Blob → ~40 MB of base64 string built by concatenation → 20 file writes + 20 metadata writes, **per turn**, for images that did not change. There is no content-hash or `updatedAt` short-circuit anywhere in that loop.

In web mode the same set is re-`put` into `SAVE_ASSETS_STORE` every save (`services/dbService.ts:265`: `for (const record of assetRecords) assetStore.put(record)`), i.e. every asset record is re-cloned into IndexedDB per turn.

### 2.4 The recovery journal re-serializes the whole game state into `settings` several times per turn

`hooks/useGame/sendWorkflow.ts:2812-2817` puts the **entire committed game state** into the workflow-recovery journal:

```ts
      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
        ...
        committedState: committedSettlementGame,
      });
      await persistWorkflowRecoveryJournal(recoveryJournal);
```

`persistWorkflowRecoveryJournal` writes it through `saveSetting` (`services/workflowRecovery.ts:27-32`). In desktop mode `saveSetting` is a **read-modify-write of the whole settings blob** (`services/dbService.ts:1321-1327` → `services/desktop/desktopSettingsMirror.ts:33-47, 130-137` → `config/settings.json`). `persistWorkflowRecoveryJournal` is awaited at `sendWorkflow.ts:1718, 1751, 2608, 2772, 2817, 3362` — up to six times per turn. So per turn the app writes the full game state (embedded in settings) up to six times **in addition** to the autosave, and each of those writes re-serializes every other setting too (`apiSettings`, `gameSettings`, `worldbooks` are large).

The turn also ends with four more whole-blob read-modify-writes (`hooks/useGame/sendWorkflow.ts:3364-3367`):

```ts
    await saveSetting('theme', state.currentTheme);
    await saveSetting('apiSettings', state.apiSettings);
    await saveSetting('gameSettings', state.gameSettings);
    await saveSetting('worldbooks', state.worldbooks);
```

### 2.5 Full re-serialization of the save on every turn (desktop)

`services/storage/appStorageAdapter.ts:41-43` — `writeJson` is `JSON.stringify(value)` + `desktop_write_text_atomic`. Every `mirrorSaveToDesktop` call (`desktopSaveMirror.ts:142`) therefore stringifies the entire save (minus image payloads) into an IPC call. There is no incremental/dirty-field write for `saves/save-<id>.json`.

### 2.6 Per-save Θ(all deltas) scans with one IPC round-trip per delta

`findAutoDeltaBase` runs on every auto save (`services/dbService.ts:235`, defined 876-897) and calls `countDeltasUsingBase` (966-979), which does a full IndexedDB delta cursor scan **plus** `loadDesktopSaveNodeDeltasSafely()` (1179-1187) → `loadDesktopSaveNodeDeltas` → `desktopSaveDeltaMirror.ts:124-137`, which reads the delta index and then **one `readJson` IPC per delta**:

```ts
async function loadDesktopSaveNodeDeltasFromIndex(index: DesktopSaveDeltaMirrorIndex): Promise<SaveNodeDeltaRecord[]> {
  const deltas: SaveNodeDeltaRecord[] = [];
  for (const item of index.deltas) {
    const delta = await loadDesktopSaveNodeDelta(item.nodeId);
    if (delta) deltas.push(delta);
  }
```

The same full scan happens again in `getReferencedDeltaBaseIds` (946-955) — called from `deleteManagedSaveItems` (`:325`) and from `cleanupUnreferencedHiddenSaves` (`:989`). Once retention rotation is active (which is every turn past the 6th auto node), one autosave performs **three** full delta scans and ~3 × N delta-file IPCs, purely to answer "is this node still a base?".

### 2.7 Answering the specific question: `structuredClone`?

**No.** A repo-wide grep for `structuredClone` and `JSON.parse(JSON.stringify` finds no use on the persistence path — matches are in `tests/unit/*`, `services/questService.ts:125` (a single quest object), `utils/teyvatCommandRegistry.ts:68` (a single command value), and `utils/variablePath.ts:17` (per-command clone of the *targeted* value; can be a whole slice such as 世界 or NPC if the model emits a root-level command, but never the whole state). The real "full deep clone of the entire game state" is **conditional**: `utils/saveImageCompactor.ts:41-48` does an unconditional deep rebuild of the whole save when any embedded `data:image/` remains:

```ts
export function compactDuplicatedSaveImages<T extends 存档数据>(save: T): T {
  const refs = collectAlbumDataUrls(save.相册);
  if (!refs.size) return save;          // ← early-out saves us in steady state
  const { 相册: album, ...withoutAlbum } = save;
  const compacted = compactValue(withoutAlbum, refs, new WeakMap()) as T;
```

Because assets are normally already `asset:<id>` refs, `refs.size === 0` and the clone is skipped. It is called at `hooks/useGame/saveLoadWorkflow.ts:107`. It is a real hazard only on the first save after importing an old save with embedded base64 — which is exactly when the save is largest.

### 2.8 Debouncing

There is none in the storage layer. The only throttling primitives are: `stripCloudBackupRestoreRuntime`, `MAX_DELTA_NODES_PER_CHECKPOINT`, the retention caps, and `createRafCoalescedSetter` (which coalesces *streaming UI text*, `sendWorkflow.ts:1712`, not writes). Autosave is explicitly once-per-turn (`sendWorkflow.ts:3330-3331`, gated by `enableAutoSaveEveryTurn`) — which is the right granularity, but everything *around* that one write is unbatched.

---

## 3. Snapshot / rollback design

### 3.1 How it works

- The snapshot is built at the start of a turn from the *live* state: `hooks/useGame/sendWorkflow.ts:1722-1739`, then immediately compacted by `compactPreTurnSnapshot`.
- It is attached to the new **user** message (`sendWorkflow.ts:1746-1749`) so a failed generation can still roll back, and then to the **assistant** message (`sendWorkflow.ts:2552`); the user copy is cleared once the assistant copy exists (`sendWorkflow.ts:2610-2614`).
- `compactPreTurnSnapshot` (`utils/saveRuntimeCompactor.ts:77-89`) does real work: album assets → `asset:<id>` refs (`stripAlbumAssetPayload`, lines 30-40) with binaries parked in the Blob cache (`collectAlbumDataUrls`, 18-28); embedded data URLs anywhere in the tree → refs or a placeholder (42-62); `>8000`-char `raw|prompt|debug|system` strings truncated (55-58); queue tasks capped at 12 (12, 64-75); variable batches capped at 100 (85).
- Restore: `hooks/useGame/turnSnapshot.ts:15-47` (`restorePreTurnSnapshot`) re-normalizes every slice and re-links album assets to the live Blob cache (`:49-71`) — note it keeps the `asset:` ref, never re-inflating base64 into React state.
- Rollback is driven from `hooks/useGame.ts:190-211` (reroll) and `sendWorkflow.ts:3373-3379` (abort policy).

### 3.2 Growth over 200 turns: the *count* is bounded, the *size* is not

**Count — bounded, aggressively.** `utils/longSessionRetention.ts:113-129` keeps exactly one snapshot in the persisted history:

```ts
  const snapshotCarrierIndex = findLatestSnapshotCarrier(value);
  return value.map((message, index) => {
    let next = message;
    const keepSnapshot = index === snapshotCarrierIndex;
    if (message.preTurnSnapshot && !keepSnapshot) {
      next = { ...next, preTurnSnapshot: undefined };
```

called from `hooks/useGame/saveLoadWorkflow.ts:79` and `sendWorkflow.ts:1752, 2615`, plus an additional unconditional purge of prior assistant snapshots at `sendWorkflow.ts:1752-1756`. So a 200-turn save holds **at most one** `preTurnSnapshot` (≈2 full state snapshots counting the live state). Constant in turn count — this is a genuinely good design decision, and the code comments at `models/chat.ts:6-8, 90-92` document it.

**Size — unbounded in session length.** The snapshot embeds 世界树, 图鉴, NPC, 剧情, 记忆, 剧情编织 — and there are **no caps on any of them**. `grep 'slice\(-|MAX_'` over `models/teyvat/*.ts` returns only `MAX_ELEMENT_EVENTS = 30` (`models/teyvat/elementalGauge.ts:30`); `services/irminsulArchive.ts` and `services/codexRetrieval.ts` contain no truncation at all. The chat history itself is never capped either: `collectRecentAssistantIndices` (`longSessionRetention.ts:166-175`) only decides *which 20* assistant turns get detailed debug context; older turns keep full `parsedResponse.body` forever, and `normalizeConversationLog` faithfully rebuilds all of it every turn. Prompt-window limits (`hooks/useGame/historyWindow.ts:37`) limit the API request, not the persisted save.

Net: at 200 turns the save ≈ (current full state) + (previous full state, i.e. the snapshot) + (400 chat messages with full narrative bodies) + (20 detailed debug contexts containing `systemPrompt` + full request `messages`) + album. Growth is **linear in turn count** (chat/debug) **plus linear in accumulated game data** (irminsul/codex/NPC), and each turn pays the normalize/compare cost of the whole thing (§2.1–2.2).

**Sharp edge in the eviction policy.** `findLatestSnapshotCarrier` (`longSessionRetention.ts:177-185`) returns `-1` when the newest user/assistant message has no snapshot:

```ts
    if (message.role !== 'assistant' && message.role !== 'user') continue;
    if (message.role === 'user') return message.preTurnSnapshot ? index : -1;
    return message.preTurnSnapshot ? index : -1;
```

`-1` means `keepSnapshot` is false for every index → **every** snapshot in the history is dropped, not just the newest. Any path that persists a history whose last user/assistant message lacks a snapshot silently destroys the previous turn's rollback point too. The degraded path is handled gracefully (`hooks/useGame.ts:204, 208-210` — "旧回复缺少完整快照，仅恢复输入文本"), but the loss is silent.

### 3.3 Node-level rollback (save tree + deltas)

Rotation caps nodes per tree per type: `services/storage/saveRetention.ts:1-2` (`MAX_MANUAL_SAVE_NODES_PER_TREE = 5`, `MAX_AUTO_SAVE_NODES_PER_TREE = 6`), bucketed by `rootId` (`:19`) and applied after each save (`dbService.ts:1415-1419`). Deltas chain against a base with a hard cap `MAX_DELTA_NODES_PER_CHECKPOINT = 6` (`dbService.ts:98`, enforced at `findAutoDeltaBase` 890-891). Nodes that are still referenced as a delta base are **not** deleted — they are demoted to `hidden-delta-base` (`dbService.ts:330-338`, `1429-1452`) and garbage-collected only when unreferenced (`cleanupUnreferencedHiddenSaves`, 986-1014). The steady state is therefore ~6 visible auto nodes + ~1 hidden base per tree: **bounded, and correct**. This part is well designed.

One correctness wrinkle worth knowing: `countDeltasUsingBase` counts **distinct `nodeId`s**, so chained deltas (`N+1…N+6` all basing on `N`) trip the cap at the 7th node and force a fresh full checkpoint. That is the intended reset, but it means the delta mechanism buys you 6 cheap nodes out of every 7 — and on a *replace*-mode delta (§ below) the 7th is not the only expensive one.

**Delta payload can silently become a full copy.** `utils/saveDeltaStorage.ts:216-234`:

```ts
function buildChatDelta(current: 聊天消息[], base: 聊天消息[]): {...} {
  const baseIsPrefix = base.length <= current.length && base.every((message, index) => message.id === current[index]?.id);
  if (baseIsPrefix) {
    return { mode: 'append', baseLength: base.length, messages: current.slice(base.length) };
  }
  return { mode: 'replace', baseLength: 0, messages: current };
}
```

Whenever the persisted chat is not an exact id-prefix of the base (load an older node and continue, reroll-trim, import, migration), the delta carries **the entire chat history** — the delta file is then as large as a checkpoint, so the node is "delta" in metadata but full in bytes.

---

## 4. Data integrity & migration

### 4.1 Backup before migration — partial, and the weakest path has none

**Path A (Save/Load modal) is gated.** A raw downloadable backup is produced during preview and its content hash recorded (`components/features/SaveLoad/SaveLoadModal.tsx:1507-1512` → `services/exportService.ts:61-70`), and confirm is blocked twice: `components/features/SaveLoad/SaveMigrationDialog.tsx:23` (`Boolean(sourceBackupId) && issues.every(...)`) and `SaveLoadModal.tsx:306-308` (`throw new Error('原档备份尚未完成，不能确认迁移。')`).

But the backup is **never verified**: `downloadRawJson` (`exportService.ts:87-97`) only synthesizes an `<a download>` click; `backupId` is a hash of the *intended* bytes (`:115-121`), not of a file that exists. A cancelled/blocked download still yields a truthy `backupId`.

**Path B (Settings → Storage Manager) has neither backup nor dialog.** `components/features/Settings/StorageManager.tsx:450-457`:

```tsx
        const imported = await importSaveFileAsMany(file);
        const now = Date.now();
        for (const [index, data] of imported.entries()) {
          data.id = 0;
          data.type = 'imported';
          data.timestamp = now + index;
          await saveGame(data);
        }
```

→ `services/dbService.ts:1566-1577` → `migrateImportCandidate` (`:1483-1495`), which for `partial-teyvat` runs `migratePartialTeyvatSave(value, {})` and persists the lossy result via plain `saveGame`. Mitigation: it is additive (`data.id = 0`, type `imported`), so existing saves are untouched; but the migrated output is stored with **no source artifact anywhere**.

**Desktop pre-migration backup is a manual, unreachable feature.** `backupDesktopStateBeforeOneTimeMigration` (`services/dbService.ts:804-808`) has exactly one call site, behind a `confirm()` in the Storage Manager (`StorageManager.tsx:717-733`), and nothing consumes the backups — no restore-from-migration-backup function exists. Where it *is* used, it is solid: SHA-256 + byte count + file count, recomputed on list (`services/desktop/desktopMigrationBackup.ts:224-250`), and `writeDesktopSaveBackup` refuses to load a mismatched backup (`desktopSaveBackup.ts:119-122`).

### 4.2 Atomicity of migration

`services/teyvatSaveMigration.ts:19-37` is a clean pattern — build the candidate, then a single atomic write, then an assertion that storage did not move:

```ts
  const catalogBytesBefore = await storage.readCatalogBytes();
  try {
    await storage.writeCandidateAtomically(migration.state);
  } catch (cause) {
    const catalogBytesAfter = await storage.readCatalogBytes();
    if (catalogBytesAfter !== catalogBytesBefore) {
      throw new Error('TEYVAT_MIGRATION_ATOMICITY_VIOLATION', { cause });
    }
```

The write goes through `saveMigratedTeyvatGameAtomically` → the real 4-store transaction, with `afterIndexedDbStaging` as a tested abort barrier (`services/dbService.ts:196-224, 294-299`). **This half is genuinely solid.**

Two caveats:
- The assertion is self-attestation. `SaveLoadModal.tsx:320` passes `readCatalogBytes: async () => JSON.stringify(await getSaveCatalogSnapshot())` — a *hydrated* snapshot. An id-preserving partial write (e.g. only the asset store moved, or a summary field changed while the id set stayed equal) produces identical bytes and the violation goes undetected. Compare a raw catalog-store digest instead.
- The mirror write after the commit is swallowed (`dbService.ts:314-318` + `1104-1110`) and on this path `desktopSaveId === 0` guarantees the branch is taken. So `saveMigratedTeyvatGameAtomically` resolves even when the desktop side did not persist, and `handleMigrationConfirm` then reports success (`SaveLoadModal.tsx:325-327`).

### 4.3 Idempotency and input mutation — both clean

`migratePartial` always starts from a fresh object (`compat/legacy-hsr/migrate.ts:470-471`):

```ts
function migratePartial(input: RecordValue, resolutions: MigrationResolutions, report: ..., requireTravelerElement = true): TeyvatGameState {
  const state = createEmptyTeyvatGameState();
```

All ids are caller-preserved or index-derived (`migrate.ts:427, 559, 585, 625, 635, 641, 660, 686, 712, 741`), there are no counters/`Date.now()`/`Math.random()` in the migration body, and `normalizeTeyvatGameState` is likewise pure (`models/teyvat/state.ts:88-114`). Re-running on the same input is byte-stable, and no in-place mutation of the caller's object or React state occurs. The one non-deterministic id generator is the *import tree remap* (`services/dbService.ts:1616-1618` `createImportId`), so re-importing the same tree package mints new `rootId`/`nodeId` values — not double-application, but it defeats dedupe-by-identity on re-import.

The stored record is a **rebuild, not a merge**, so fields the migration intentionally zeroes (`天赋: []` at `migrate.ts:432`, `unlockedAtTurn: 0` at `:713`) are gone; the source backup is the only recovery channel — which, per §4.1, Path B does not create.

### 4.4 Package integrity

Per-entry CRC32 + size verification on import (`services/savePackage.ts:508-513`):

```ts
    if (dataEnd > bytes.length) throw new Error('存档包文件长度异常');
    ...
    if (data.length !== fileSize) throw new Error('存档包条目大小异常');
    if (crc32(data) !== crc) throw new Error(`存档包条目校验失败：${name}`);
```

with manifest/version/universe validation (`savePackage.ts:286-346`), path-traversal rejection (`:384-393`), and legacy-save write refusal (`:352-358`). **Missing:** `readZip` never reads the End-Of-Central-Directory record written by `createZip` (`savePackage.ts:428-434`) — it scans local headers and breaks at the central-directory signature (`:494-496`). A file truncated after the last entry parses successfully, and there is no package-level digest over `save.json`. Practical blast radius is limited because `manifest.json`/`save.json` are written first/last (`:78-81`). Also `privacy.apiKeysRemoved: true` (`:140-142`) is an unverified assertion — true only incidentally, because API settings live outside save state.

---

## 5. Concurrency / race conditions

### 5.1 There is no write serialization — and `runWithSaveMutationPriority` is not a mutex

Every mutating entry point wraps itself in `runWithSaveMutationPriority` (`services/dbService.ts:193, 220, 468, 498, 506, 537, 621, 725`). Reading it (`services/storage/saveCatalogRepair.ts:72-83`):

```ts
export async function runWithSaveMutationPriority<T>(task: () => Promise<T>): Promise<T> {
  pendingWriteCount += 1;
  try {
    return await task();
  } finally {
    pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    if (pendingWriteCount === 0) { for (const resolve of Array.from(writeWaiters)) resolve(); writeWaiters.clear(); }
  }
}
```

It only *pauses the background catalog-repair loop* (`saveCatalogRepair.ts:144-154`). It does **not** serialize two concurrent writers. Nothing in the layer does — there is no mutex, queue, or in-flight guard anywhere in `dbService.ts`.

**Concrete race 1 — save-id reservation and file overwrite (data loss, desktop).** `services/dbService.ts:236` → `reserveDesktopSaveIdSafely` → `services/desktop/desktopSaveMirror.ts:147-159`, which is a read-modify-write:

```ts
  const index = await readMirrorIndex();
  const sequence = await readSaveSequence(adapter);
  const nextId = Math.max(Number(minimumNextId) || 1, getMaxSaveId(index.saves) + 1, (Number(sequence?.lastSaveId) || 0) + 1);
  await writeSaveSequence(nextId, adapter);
  return nextId;
```

Two overlapping saves both read the same sequence and both reserve id `N`. Both then write `saves/save-N.json` (`desktopSaveMirror.ts:142`) — **the second overwrites the first's file**, both return `N`, and the loser's IndexedDB `store.add({...rest, id: N})` (`dbService.ts:273-274`) fails with a `ConstraintError` which the `catch` at `:306-312` **converts into a success return**. Net effect: one turn's save is destroyed on disk and the app reports two successful saves.

**Concrete race 2 — mirror index lost update (invisible saves).** `mirrorSaveToDesktop` (`desktopSaveMirror.ts:129-145`) reads the index, writes the save file, then writes the index. Interleaved A/B: A reads, B reads, A writes file A, B writes file B, A writes index{A}, B writes index{B} → save A's file exists but is missing from `saves/index.json`. Because `getSaveCatalogSnapshot` returns the desktop list whenever it is non-empty (`dbService.ts:363-372`), **save A disappears from the UI** even though it is on disk. `repairDesktopSaveMirrorIndex` (`desktopSaveMirror.ts:239-244`) can fix it, but only if the user finds the Storage Manager button.

**Concrete race 3 — settings blob lost update.** `mirrorSettingToDesktop` (`desktopSettingsMirror.ts:33-47`) is the same read-modify-write on `config/settings.json`, and the turn ends with four sequential `saveSetting` calls (`sendWorkflow.ts:3364-3367`) plus up to six journal writes (`:1718, 1751, 2608, 2772, 2817, 3362`). Two overlapping writers → one writer's settings vanish.

Are overlapping writes reachable? Yes, three ways:
- `persistMemorySnapshot` (`hooks/useGame.ts:224-230`) calls `saveGame` from memory-rebuild/draft callbacks (`hooks/useGame.ts:282, 325, 413, 451, 469`). The rebuild is guarded against *starting* during a turn (`hooks/useGame.ts:357-361`), but the completion callback fires later and nothing blocks a turn from having started meanwhile.
- The manual save button is disabled only by its own `saving` state (`SaveLoadModal.tsx:528, 589`), not by the game's loading state — the user can save mid-stream.
- `commitCloudMergeStaging` (`dbService.ts:619-634`) can run while a background-settled turn's autosave is pending.

**Concrete race 4 — autosave vs. abort.** `sendWorkflow.ts:3353-3356` does `assertWorkflowActive(); await saveGame(saveData); commitActiveSaveTreeMeta(saveData); assertWorkflowActive();`. An abort landing *inside* `await saveGame` aborts the IndexedDB transaction (`tx.onabort` at `dbService.ts:304`) — but the desktop-primary write already happened at `:252-254`, and the `catch` at `:306-312` returns the desktop id as success. The abort policy then rolls back UI state (`sendWorkflow.ts:3373-3379`) while the desktop mirror holds the new save. Divergence, silently.

**Concrete race 5 — no cross-tab coordination for cloud operations.** Only the catalog repair task has a lease (`dbService.ts:99-103, 1810-1878`; `saveCatalogRepair.ts:90-98`) — and it is a good lease, with renewal, a takeover check that aborts the transaction (`dbService.ts:1844-1846`), and release. Cloud merge/upload has none: two tabs can each compute the same local index pre-commit and import the same nodes, and both can publish pointers. Note the merge *commit* itself is safe against local writes because it is insert-only (`dbService.ts:689` `saveStore.add(withoutId)`) — local saves are never overwritten by a merge. The unsafe part is asset upsert by a pre-computed target id (`cloudBackupMerge.ts:305-333` → `dbService.ts:675` `assetStore.put(staged.record)`).

### 5.2 IndexedDB connection lifecycle

`services/dbService.ts:129-177` handles `versionchange` well (close + null the promise so the next call reopens, `:137-140`) but has three gaps:

- **No `onclose`.** If the browser force-closes the connection (user clears site data, storage pressure, an upgrade from a tab that never calls `close()`), `dbPromise` stays resolved with a dead handle. Every subsequent `db.transaction(...)` throws `InvalidStateError` — synchronously inside the Promise executor, so it rejects with a raw DOMException — and **never recovers**; the session is bricked until reload.
- **`onblocked` leaks the handle.** `:174` fails the promise on `onblocked`, but the open request is still live; a later `onsuccess` hits `settled === true` and returns without closing the database (`:133-142`).
- **`onversionchange` closes unconditionally** with no in-flight-write accounting — an upgrade from another tab can close the connection in the middle of a save sequence.

The second IndexedDB (`services/storage/cloudBackupTransferStore.ts:157-184`) has the same `versionchange`-only handling.

### 5.3 The `dbService.ts` ↔ `desktopSaveMirror.ts` circular dependency

**Verdict: benign at runtime; a real layering defect.**

The only back-edge is `services/desktop/desktopSaveMirror.ts:2`:

```ts
import type { SaveListItemSummary } from '@/services/dbService';
```

It is `import type`, so it is erased by esbuild/TS and cannot create a runtime cycle — and `tsconfig.json:12` has `isolatedModules: true`, which reinforces that type-only imports must stay erased. I checked every module in `desktopSaveMirror`'s value-import graph (`appStorageAdapter`, `desktopRuntime`, `saveAssetStorage` → `albumObjectUrl`/`albumActions`); none imports `dbService` at value level. A repo-wide grep for `from '@/services/dbService'` shows exactly four type-only importers, and only this one is a reverse edge.

**So the cycle does not cause ordering hazards.** What it *does* cause is that the low-level mirror module types itself against the orchestrator instead of the type's real owner. The correct pattern already exists in the codebase — `services/cloudBackupBuilder.ts:2` imports `SaveListItemSummary` from `@/services/storage/saveCatalog`. `desktopSaveMirror.ts:2` and `utils/saveTreeView.ts:1` deviate. That deviation is what makes the dependency *look* circular and makes `dbService` un-splittable (§1.1) without touching the desktop layer.

**The real ordering hazards in this area are not the cycle** — they are §5.1's unguarded read-modify-write sequences in `writeMirrorIndex`/`reserveDesktopSaveId`/`writeSettingsMirror`, all of which run inside `dbService`'s save path.

---

## 6. Error handling

### 6.1 25 `console.warn`s — 22 of them are the same pattern

I confirmed exactly 25 `console.warn` calls (matches the brief): `:308, 1108, 1130, 1141, 1165, 1174, 1184, 1193, 1201, 1210, 1220, 1230, 1240, 1265, 1274, 1282, 1290, 1299, 1307, 1315, 1372, 1380, 1389, 1409, 1425`. Of those, **21 are the uniform `…Safely` swallow-wrapper** (`1108, 1165, 1174, 1184, 1193, 1201, 1210, 1220, 1230, 1240, 1265, 1274, 1282, 1290, 1299, 1307, 1315, 1372, 1380, 1389, 1409`), each converting a failure into a benign-looking success. The four remaining are: `:1130` (desktop-primary write failed → falls back to IndexedDB, the *correct* use of warn), `:1141` (id reservation failed → falls back to autoIncrement, also correct), `:1425` (post-save retention rotation failed, best-effort by design — correct), and `:308` (IndexedDB failure *after* a desktop-primary write → returns the desktop id as success, §1.3b — not correct).

### 6.2 What reaches the user

**Worse than silence — actively misleading.** `components/features/SaveLoad/SaveLoadModal.tsx:160-172`:

```tsx
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave();
      await refresh();
      setTab('manual');
    } catch (err) {
      console.error('[save] failed', err);
      alert('保存失败');
    } finally {
```

The error object is logged but the message is **discarded**; the user cannot distinguish quota exhaustion from a schema error from a disk-full condition. By contrast load/delete do pass the message through (`:198`, `:217`), and settings tabs do too (e.g. `components/features/Settings/GameSettings.tsx:102`). So the inconsistency is local, not architectural — but manual save is the one place where a user most needs the reason.

The autosave path is better: failures inside the turn surface via `catch` → workflow hint, and memory-persist failures are explicit (`hooks/useGame.ts:284`, `:327`). Two silent leaks exist: `hooks/useGame.ts:494` calls `saveSetting('storyWeavingSystem', ...)` with **no `await` and no `.catch()`** (an unhandled rejection if the mirror write fails), and `components/features/GameSystems/AlbumPanel.tsx:196` / `components/features/Settings/SettingsModal.tsx:130, 135` use `void saveSetting(...)` with no rejection handler.

### 6.3 Quota — there is no strategy at all

A repo-wide grep for `QuotaExceeded`, `quota`, `navigator.storage`, and `estimate()` finds **one** match, and it is unrelated (`utils/imagePromptRules.ts:560`, a prose prompt string). Therefore:

- No `QuotaExceededError` detection anywhere, including the `dbService` transaction handlers (`tx.onerror`/`tx.onabort` just forward `tx.error`, `dbService.ts:303-304`).
- No usage/headroom reporting in the Storage Manager (it reports asset-mirror bytes and file counts, e.g. `components/features/Settings/StorageManager.tsx:1798`, but not IndexedDB usage).
- No pre-emptive pruning. Given §3.2 (unbounded chat + unbounded irminsul/codex) and §2.3 (every asset rewritten each save), hitting the origin quota is a matter of when. When it happens: the IndexedDB half throws, the desktop-primary half has usually already written (§1.3b on desktop) or the save is simply lost with `alert('保存失败')` (web).

The only quota-adjacent guard is `utils/albumObjectUrl.ts:20-33` (`MAX_ALBUM_CACHE_BYTES = 64 MB`, FIFO eviction) — which protects *memory*, not storage.

---

## 7. Cloud save / GitHub sync

### 7.1 Token handling

- **Plaintext at rest — HIGH.** The PAT is persisted verbatim: `components/features/CloudSave/GitHubCloudSaveModal.tsx:106-109` (`token: next.token.trim()`, `await saveSetting('githubCloudSaveConfig', clean)`). Web → unencrypted IndexedDB row (`dbService.ts:1357-1362`). Desktop → **plaintext file** `config/settings.json` (`dbService.ts:1321-1327` → `desktopSettingsMirror.ts:28, 43-46`), because `githubCloudSaveConfig` is not in `SPECIAL_SETTING_PATHS` (`desktopSettingsMirror.ts:29-31`).
- **In transit — SOLID.** Header-only (`services/githubCloudSave.ts:788-795`), never in a URL (`repoApi`/`contentUrl` built from owner/repo/branch only, `:804-810`), all requests go to `https://api.github.com` (`:14`), input is `type="password"`, and neither `githubCloudSave.ts` nor `githubRequest.ts` contains a single `console.*` call. `readGitHubError` (`githubRequest.ts:101-116`) composes messages from the phase label + GitHub's own `message` + status, so it cannot echo headers.
- **No redaction helper for this secret.** Redaction exists only for AI keys (`services/ai/apiErrorReportService.ts:25`; `services/memoryCompression.ts:135-140`). Error text is shown verbatim (`GitHubCloudSaveModal.tsx:121-123`). No active leak today; defense-in-depth gap.
- **OAuth is properly done.** `state` is generated with `crypto.getRandomValues` and verified before exchange (`hooks/useGitHubOAuth.ts:50-51, 95-99, 149-153`), the callback URL is cleaned with `replaceState` (`:155-157`), and the `client_secret` stays server-side in the Pages Function (`functions/api/auth/github.ts:25-27`) — it is never shipped to the client. The function does forward a caller-supplied `redirectUri` without validation (`github.ts:22, 29`) and has no rate limit; low risk given GitHub's registered-callback constraint, but worth tightening.

### 7.2 Request layer — solid, with one real hole

`services/githubRequest.ts` is good: per-attempt timeout (`:56-59`), abort forwarding with cleanup (`:176-181`, `:92-95`), retry only for idempotent methods (`:118-123` — writes get 1 attempt unless overridden), correct status set (`:125-130`), and rate-limit-aware backoff that honors `retry-after` (seconds or HTTP-date) and `x-ratelimit-reset` before falling back to jittered exponential (`:143-168`).

**The hole: the timeout and abort do not cover the response body.** `finally { clearTimeout(timeoutId); stopForwardingAbort(); }` (`:92-95`) runs as soon as headers arrive; the body is then read with no watchdog — `githubCloudSave.ts:702-711` `return new Uint8Array(await response.arrayBuffer())`. Consequences: a stalled part download hangs forever, `transferTimeoutMs(part.sizeBytes)` (`:327, 842-844`) is effectively dead code for streaming, and **cancelling during a part read does nothing** (`assertNotAborted` only runs at loop tops, `:318`).

Minor: the 20 s delay cap (`:33`) can never wait out a rate-limit reset an hour away; and `putContent` (`:671-694`, reached only by the connectivity probe at `:179`) does not handle stale-`sha` conflicts.

### 7.3 Conflict resolution

Detection is **content-hash based, not timestamp based** — `fingerprintCloudBackupNode` hashes a stable, sorted projection with volatile keys (`id`, `debugContext`, `saveRuntime`, `exportedAt`, `uploadedAt`, `mirroredAt`) removed (`services/cloudBackupPackage.ts:182-185, 209-221`), the local index maps `(rootId,nodeId) → fingerprint` (`cloudBackupMerge.ts:251-259`), and the plan skips duplicate fingerprints while flagging a whole root as a conflict when the same identity has different content (`cloudBackupMergePlan.ts:24-33`), remapping conflicting nodes to fresh ids (`:37-41`). Schema/universe mismatch is rejected before any staging write (`cloudBackupMerge.ts:435-477`). This is a genuinely good design and much better than timestamp comparison.

**HIGH — lost update on the cloud pointer.** The UI never inspects the remote before overwriting (`GitHubCloudSaveModal.tsx:166-167`), and `uploadCompleteBackupToGitHub` reads the old pointer only to compute deletions (`githubCloudSave.ts:228-229`) before replacing `cloud-backup.json` in one commit (`:281-291`). There is no CAS on pointer content and no `snapshotId`/`createdAt` check, so device B's "sync all" silently supersedes device A's newer snapshot — A's parts remain in the object store but become unreachable through the app. The non-force ref update + retry (`updateBranchRef` returns `false` on 409/422, `:619`; `publishAtomicCloudCommit` retries 3× and treats "head already == my commit" as success, `:506-516`) protects the *ref*, not the payload. `force: false` at `:611` is correct.

**MEDIUM — conflict-tree parent loss.** `cloudBackupMerge.ts:368-370` maps `parentNodeId` only through `plan.nodeIdMap`; if the parent exists only locally, the highest cloud node of a conflicting root becomes parentless while sharing the remapped `rootId` → a multi-root tree.

**MEDIUM — asset upsert by a pre-computed id across an unbounded window.** Target ids are chosen in `buildAssetMergePlan` (`cloudBackupMerge.ts:305-333`) before a download/stage phase that can take minutes, then applied as `assetStore.put(staged.record)` (`dbService.ts:675`). A locally created asset that lands on the same id in that window is overwritten.

### 7.4 Partial failure

**Upload is genuinely atomic and this is the strongest part of the subsystem.** Parts go up as git *blobs*, never as visible files (`githubCloudSave.ts:250-256`), and a single tree+commit+ref update publishes them (`:281-291`). A failure at part 5 of 7 leaves **no** visible cloud change.

**Merge is atomic locally** — one 5-store IndexedDB transaction (`dbService.ts:636-718`) preceded by `backupCurrentSavesToDesktop('before-restore')` (`:620`) — and staging is cleared on every error path (`cloudBackupMerge.ts:81, 208`; `githubCloudSave.ts:301-304, 355-358`; `cloudBackupBuilder.ts:232-234`). Verification is thorough: per-part SHA-256 + size on both directions (`githubCloudSave.ts:243-249, 337-339`), per-node fingerprint re-verification at merge time (`cloudBackupMerge.ts:147-148`), and staged-count assertions (`:177-178, 194-196`).

Gaps:
- **No resumability.** Every failure deletes the transfer (`githubCloudSave.ts:302`), forcing a full re-pack/re-download; the retry loop reuses already-uploaded blobs only within one process (`:506-524`).
- **HIGH (desktop) — post-commit mirroring is swallowed.** `dbService.ts:625-628` mirrors each merged save via `mirrorDesktopSaveSafely` (`:1104-1110` → `console.warn`), while catalog reads prefer the mirror (`:363-372`). The UI reports success (`GitHubCloudSaveModal.tsx:245`) but merged saves can be invisible.
- **MEDIUM — oversized parts.** `CLOUD_BACKUP_PART_HARD_BYTES = 90 MiB` (`cloudBackupPackage.ts:5`) is base64-inflated into a JSON body (`githubCloudSave.ts:486, 833-840`) ≈ 120 MB, which GitHub will reject, with no chunking fallback and ~4× peak renderer memory (`:246-250`).
- **MEDIUM — orphaned merge staging has no reaper.** Staging records live in `TimeJourneyDB.settings` under `internal.cloudMerge.*` (`dbService.ts:1631-1645`) and are only cleared by the merge's own `catch` (`cloudBackupMerge.ts:208`). The TTL sweeper (`cloudBackupTransferStore.ts:143-155`) covers a *different* database (`KaiTuoYiShiCloudTransferDB`), and `cleanupExpiredCloudBackupTransfers` is only called from `cloudBackupBuilder.ts:72`. Kill the app mid-merge and the staged node JSONs **and asset Blobs** stay in the settings store forever. (These also pollute the "settings" store that every `saveSetting` read-modify-writes.)

### 7.5 Worker

Correctly scoped (hash/pack/unpack only, `workers/cloudBackup.worker.ts:26-54`), correctly correlated (monotonic id + pending map, `cloudBackupWorkerClient.ts:17, 23-30, 76-93`), one client per operation (`cloudBackupBuilder.ts:77`, `cloudBackupMerge.ts:78`), transferables used properly, and `dispose()` terminates in `finally` (`cloudBackupMerge.ts:211-213`). Two gaps:
- **`onerror` leaves the worker handle in place** (`cloudBackupWorkerClient.ts:31`): `this.worker.onerror = () => this.failAll(...)` neither nulls nor terminates, and `onmessageerror` is unhandled — so later `postMessage` calls never settle and the modal stays busy indefinitely (the user can still escape via abort, `:75-82`).
- **Gzip bomb before the size check.** `cloudBackupPackage.ts:145-149` decompresses first, then enforces `DEFAULT_MAX_UNPACKED_BYTES = 128 MB` (`:11`). A hostile/compromised pointer caps the *compressed* part at 100 MB (`githubCloudSave.ts:754`), so a bomb can expand to gigabytes inside the worker and OOM the renderer.

---

## 8. Prioritized recommendations

Ranked by value ÷ effort. S ≈ <½ day, M ≈ 1–3 days, L ≈ 1 week+.

### P0 — correctness/data-loss, small effort

1. **Serialize all storage mutations with a real single-flight queue. (S)**
   `services/dbService.ts:193, 220, 468, 498, 506, 537, 621, 725` — replace `runWithSaveMutationPriority` with a promise chain (keep the repair-priority counter *inside* it as a separate signal). Fixes the save-id double-reservation + file overwrite (`desktopSaveMirror.ts:147-159`), the mirror-index lost update (`:129-145`), and the settings-blob lost update (`desktopSettingsMirror.ts:33-47`) in one change. Add a same-tab `BroadcastChannel`/`Web Locks` guard for the cross-tab case (`navigator.locks.request('ktys-save-write', ...)`).

2. **Stop converting mirror failures into success. (S)**
   `services/dbService.ts:306-312` (remove the "return desktopSaveId on IndexedDB failure" branch, or return a typed `{ ok:false, mirrorOnly:true }`), and `:314-318` (make the post-commit mirror required for the migration path, or record a `mirrorPending` flag on the record so the next read knows to reconcile). At minimum, make `getSaveCatalogSnapshot` (`:363-372`) fall back to IndexedDB when the desktop list is *shorter* than the IndexedDB key set, so a swallowed mirror failure cannot hide a save.

3. **Surface the real save error, and detect quota. (S)**
   `components/features/SaveLoad/SaveLoadModal.tsx:168` — replace `alert('保存失败')` with the message; add a `QuotaExceededError` branch (`err instanceof DOMException && err.name === 'QuotaExceededError'`) that names the cause and offers "delete old auto-saves / run asset cleanup". Add the same detection in `saveGameInternal`'s `tx.onerror/onabort` (`dbService.ts:303-304`) and in `writeIndexedSetting` (`:1359-1365`).

4. **Delete the redundant full normalize in `saveGame`. (S)**
   `services/dbService.ts:187` — trust the already-normalized payload from `buildSavePayload` (`hooks/useGame/saveLoadWorkflow.ts:86`), keeping only the identity/timestamp stamping. Removes one of three full state normalizations per turn (§2.1). Guard it with the existing `teyvatSaveContract` unit test rather than a source-text assertion.

5. **Give the recovery journal its own storage file. (S)**
   Add `activeWorkflowRecoveryV1` to `SPECIAL_SETTING_PATHS` (`services/desktop/desktopSettingsMirror.ts:29-31`) so the 6-per-turn `persistWorkflowRecoveryJournal` writes stop rewriting the whole settings blob with the whole game state inside it (§2.4). Then batch the four end-of-turn `saveSetting` calls (`sendWorkflow.ts:3364-3367`) into one `saveSettings(patch)` operation.

6. **Reap orphaned cloud-merge staging and stale transactions at startup. (S)**
   Call `clearCloudMergeStaging`-style sweeping for any `internal.cloudMerge.*` prefix older than N hours on app boot (the prefix helpers already exist, `dbService.ts:1631-1645`), and call `repairUnresolvedDesktopSaveTransactions` (`desktopSaveMirror.ts:246-252`) at startup instead of only from a manual button.

7. **Fix the type layering that looks circular. (S)**
   `services/desktop/desktopSaveMirror.ts:2` and `utils/saveTreeView.ts:1` — import `SaveListItemSummary` from `@/services/storage/saveCatalog`, as `services/cloudBackupBuilder.ts:2` already does. Purely cosmetic today, but it is the blocker for splitting `dbService`.

### P1 — long-session performance

8. **Make album-asset mirroring incremental. (M)**
   `services/desktop/desktopAssetMirror.ts:58-102` — skip a record when `assets/index.json` already has an entry with the same `id`, `updatedAt`, and `size`. This is the single largest hot-path win in desktop mode (§2.3): it turns "rewrite ~30 MB of base64 per turn" into "write nothing when the album is unchanged". Pair it with moving `resolveRecordBase64Payload` (`:374-391`) into a worker or using `blob.arrayBuffer()` + a chunked `FileReader` — the current 32 KB string concat + `btoa` blocks the main thread.

9. **Index the delta bookkeeping instead of scanning. (M)**
   `services/dbService.ts:966-979` (`countDeltasUsingBase`) and `:946-955` (`getReferencedDeltaBaseIds`) do full cursor scans plus one IPC per delta file. Add a `baseSaveId` index on `SAVE_NODE_DELTAS_STORE` (a DB version bump) and a `baseSaveId`-keyed projection in `saves/deltas/index.json`, then read counts/refs in O(1). Eliminates ~3 full scans + 3N IPCs per autosave once rotation is active (§2.6).

10. **Cap the persisted chat history and the unbounded slices. (M)**
    Everything else is bounded; the chat and irminsul/codex are not (§3.2). Extend `compactChatHistoryForLongSession` (`utils/longSessionRetention.ts:113-164`) to replace bodies of turns older than N with the existing `continuation.summary` (the data is already there), and add explicit entry caps for `世界树.entries` / `图鉴.entries` in the same style as `MAX_ELEMENT_EVENTS`. This is what turns "200 turns is fine" into "2000 turns is fine", and it is also the only real defence against quota (§6.3).

11. **Only rewrite a delta when it is actually a delta. (S)**
    `utils/saveDeltaStorage.ts:216-234` — when `baseIsPrefix` is false, mark the node `baseMode: 'checkpoint'` (or chunk the chat delta) instead of silently embedding the entire history in a record labelled "delta". Today's behaviour makes node size unpredictable and defeats the retention sizing logic.

### P2 — resilience & integrity

12. **Make the IndexedDB connection self-healing. (S)**
    `services/dbService.ts:129-177` — add `db.onclose = () => { dbPromise = null; }`, close the handle when `onsuccess` arrives after `onblocked` already failed (`:133-142, 174`), and add a small retry-once wrapper so an `InvalidStateError` from a dead connection transparently reopens. Same fix in `cloudBackupTransferStore.ts:157-184`.

13. **Keep abort/timeout alive through response bodies. (S)**
    `services/githubRequest.ts:92-95` — return the controller (or attach it to the Response) so body consumption stays cancellable, or add a `githubReadBody(response, {timeoutMs, signal})` helper and route `githubCloudSave.ts:702-711` through it. Makes 取消 work during a 90 MB part read and makes `transferTimeoutMs` real.

14. **Harden the worker client. (S)**
    `services/cloudBackupWorkerClient.ts:31` — `this.worker.terminate(); this.worker = null;` inside `onerror`, add `onmessageerror`, and race every `request()` against a per-call timeout so a wedged worker cannot hang the modal.

15. **Stream-decompress with a running byte budget. (M)**
    `services/cloudBackupPackage.ts:145-149` — decompress through a `DecompressionStream` reader, aborting as soon as the accumulated size exceeds `maxUnpackedBytes`, instead of materialising first and checking after.

16. **CAS the cloud pointer. (M)**
    `services/githubCloudSave.ts:281-291, 499-526` — read the current pointer inside `publishAtomicCloudCommit` and fail (or require explicit user confirmation) when its `snapshotId`/`createdAt` differs from what the UI inspected. Closes the multi-device lost-update in §7.3.

17. **Verify the migration backup before unlocking confirm. (M)**
    `services/exportService.ts:61-70` + `SaveMigrationDialog.tsx:23` — after producing the download, require the user to re-select the file and assert its SHA-256 equals `backupId`. And route the Storage Manager import (`StorageManager.tsx:450-457`) through the same gated flow, or at least call `createRawMigrationBackup` there too.

18. **Read the ZIP EOCD and add a package digest. (M)**
    `services/savePackage.ts:489-518` — parse the EOCD written at `:428-434`, assert entry count + central-directory offset, and store a SHA-256 of `save.json` in the manifest, verified on import.

19. **Replace source-text "regressions" with behavioural storage tests. (M)**
    `scripts/save-tree-regression.mjs:25` asserts a *literal implementation string* (`assert(dbService.includes('return runWithSaveMutationPriority(() => saveGameInternal(record))'))`), which breaks on any refactor and verifies nothing about behaviour. Only `tests/unit/teyvatSaveContract.test.ts`, `postSettlementRecovery.test.ts`, `legacySaveMigration.test.ts`, and `longSessionRetention.test.ts` touch storage. Add `fake-indexeddb`-backed tests for: concurrent `saveGame` (recommendation 1), reserved-id collision, mirror-index divergence, migration abort barrier, and delta replace-mode.

### P3 — structural

20. **Split `dbService.ts` along the §1.1 boundaries. (L)**
    Priority order: (a) the 22 `…Safely` wrappers → `storage/desktopMirrorGuards.ts`; (b) `storage/idbConnection.ts`; (c) cloud-merge staging → `cloud/cloudMergeStaging.ts`; (d) catalog repair + lease → `storage/saveCatalogRepairOps.ts`; (e) delta bookkeeping → `storage/saveDeltaIndex.ts`; (f) settings → `storage/settingsStore.ts`. Do recommendation 7 first so the desktop layer stops depending on the orchestrator. This also makes the 25 `console.warn`s auditable — after the split, each module can have an explicit failure policy instead of a uniform swallow.

21. **Decide and document the failure policy for each mirror write. (S, but requires a product decision)**
    Right now "save succeeded" has three meanings: IndexedDB committed, desktop file written, mirror index updated. Pick one as the definition of success, log the others as degradations with a user-visible "存储已降级" indicator, and make the Storage Manager's health inspectors (`desktopSaveMirror.ts:374-432`, `desktopSaveDeltaMirror.ts:139-184`, `desktopAssetMirror.ts:216-278`) drive a startup reconciliation rather than a manual button.

---

## 9. What is genuinely solid (do not "fix" these)

- **The save-tree + delta/checkpoint design.** `MAX_MANUAL_SAVE_NODES_PER_TREE = 5` / `MAX_AUTO_SAVE_NODES_PER_TREE = 6` (`saveRetention.ts:1-2`), `MAX_DELTA_NODES_PER_CHECKPOINT = 6` (`dbService.ts:98`), reference-counted retention that demotes rather than deletes a live delta base (`dbService.ts:330-338, 1429-1452`), and orphan GC (`:986-1014`). Bounded, correct, and unusual to see done this well.
- **Snapshot count bounding.** At most one `preTurnSnapshot` survives (`longSessionRetention.ts:113-129` + `saveRuntimeCompactor.ts:77-89`). The compaction is substantive, not cosmetic: binaries → refs, big debug strings truncated, batches capped.
- **Binary payload discipline.** Base64 is stripped from the write path and kept as Blobs in IndexedDB (`utils/saveAssetStorage.ts:122-128, 155-195`); runtime React state holds `asset:<id>` refs, never multi-MB data URLs; base64 is re-expanded only at export boundaries (`:250-285`). This is the right architecture and it is consistently applied.
- **`commitCloudMergeStagingTransaction`** (`dbService.ts:636-718`) — a real 5-store transaction with per-record validation, in-transaction cursor deletion, and abort-on-invalid.
- **Cloud content-addressing and verification.** Stable fingerprint with volatile-key stripping (`cloudBackupPackage.ts:182-221`), per-part SHA-256 + size on upload and download (`githubCloudSave.ts:243-249, 337-339`), per-node fingerprint re-verification at merge (`cloudBackupMerge.ts:147-148`), and a publish model where a partial upload is invisible (blobs + one commit, `:250-291`).
- **The catalog-repair lease** (`dbService.ts:1810-1878`) — owner id, expiry, renewal that aborts the transaction on takeover (`:1844-1846`), and release. A correct distributed lock implementation.
- **`githubRequest`** — idempotency-aware retry, per-attempt timeout, abort forwarding, and genuine rate-limit handling with `retry-after`/`x-ratelimit-reset` (`githubRequest.ts:118-168`).
- **Migration purity and idempotency.** Fresh-object rebuild (`migrate.ts:470-471`), stable ids, no input mutation, `needs-input` structurally blocked from reaching storage (`migrate.ts:773-778`, `teyvatSaveMigration.ts:25`, `SaveLoadModal.tsx:324`), and `createEmptyTeyvatGameState`-based purity in `normalizeTeyvatGameState` (`models/teyvat/state.ts:88-114`).
- **Desktop backup integrity** — SHA-256 + byte count + counts, verified on read and refusing to load on mismatch (`desktopSaveBackup.ts:164-183, 119-122`).
- **Error surfacing in the settings and load/delete paths** — those pass the real message to the user (e.g. `GameSettings.tsx:102`, `SaveLoadModal.tsx:198, 217`). The gap is localised to the manual-save alert and to autosave-during-stream.

---

## Appendix — evidence read (file, lines)

`services/dbService.ts` 1–1975 (complete) · `services/storage/saveCatalog.ts` 1–328 · `services/storage/saveCatalogRepair.ts` 1–169 · `services/storage/saveRetention.ts` 1–44 · `services/storage/appStorageAdapter.ts` 1–102 · `services/storage/cloudBackupTransferStore.ts` 1–208 · `utils/saveDeltaStorage.ts` 1–326 · `utils/saveAssetStorage.ts` 1–285 · `utils/saveImageCompactor.ts` 1–49 · `utils/saveRuntimeCompactor.ts` 1–90 · `utils/longSessionRetention.ts` 1–195 · `utils/albumObjectUrl.ts` 1–70 · `services/desktop/desktopSaveMirror.ts` 1–582 · `services/desktop/desktopSaveDeltaMirror.ts` 1–273 · `services/desktop/desktopAssetMirror.ts` 1–405 · `services/desktop/desktopSettingsMirror.ts` 1–178 · `services/desktop/desktopSaveBackup.ts` 1–191 · `services/desktop/desktopBridge.ts` 1–127 · `services/cloudBackupMerge.ts` 1–550 · `services/cloudBackupMergePlan.ts` 1–58 · `services/cloudBackupBuilder.ts` 40–139 · `services/cloudBackupWorkerClient.ts` 1–105 · `workers/cloudBackup.worker.ts` 1–65 · `services/githubCloudSave.ts` 108–177, 215–344, 474–621, 770–871 · `services/githubRequest.ts` 1–200 · `hooks/useGitHubOAuth.ts` 1–161 · `functions/api/auth/github.ts` 1–61 · `hooks/useGame/saveLoadWorkflow.ts` 1–411 · `hooks/useGame/turnSnapshot.ts` 1–72 · `hooks/useGame/sendWorkflow.ts` 1150–1360, 1690–1820, 2520–2650, 3310–3390 · `hooks/useGameState.ts` 280–480 · `hooks/useGame.ts` 180–300, 336–505 · `models/teyvat/state.ts` 1–114 · `models/teyvat/runtimeSlices.ts` 300–500, 614–626 · `models/chat.ts` 1–110 · `services/workflowRecovery.ts` 1–60 · `services/exportService.ts` 1–159 · `services/teyvatSaveMigration.ts` 1–37 · `services/savePackage.ts` 60–110, 485–544 · `compat/legacy-hsr/migrate.ts` 468–481 · `components/features/SaveLoad/SaveLoadModal.tsx` 140–335 · `components/features/SaveLoad/SaveMigrationDialog.tsx` 1–30 · `components/features/CloudSave/GitHubCloudSaveModal.tsx` 95–164 · `components/features/Settings/StorageManager.tsx` 435–479 · `services/cloudBackupPackage.ts` 125–184 · `tsconfig.json` 1–20 · `scripts/save-tree-regression.mjs` 1–29.

Greps run: `preTurnSnapshot|回合快照`, `structuredClone|JSON\.parse\(JSON\.stringify`, `compactChatHistoryForLongSession|saveRuntimeCompactor|compactPreTurnSnapshot`, `saveGame\(|buildSavePayload|autoSave`, `from '@/services/dbService'`, `runWithSaveMutationPriority|pendingWriteCount|mutex`, `QuotaExceeded|quota|navigator\.storage`, `clearCloudMergeStaging|cloudBackupTransferStore`, `internal\.cloudMerge`, `console\.(warn|error|log)` (in `dbService.ts` → 25), `import type \{ SaveListItemSummary \}`, `cleanupExpiredCloudBackupTransfers|inspectDesktopSaveMirrorHealth|repairDesktopSaveMirrorIndex`, `persistMemorySnapshot`, `saveSetting\(`, `DEFAULT_MAX_|LIMIT`, `MAX_MESSAGES|chatHistory\.length >`.
