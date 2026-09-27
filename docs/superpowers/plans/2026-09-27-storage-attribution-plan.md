# Storage Attribution and Backup Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain estimated save-node, delta, and shared-asset storage without double counting, and offer a dismissible local backup reminder.

**Architecture:** Keep the browser quota estimate and existing save summaries untouched. A read-only, user-triggered IndexedDB scan gathers asset and delta metadata; a pure summarizer calculates separately labeled, non-additive estimates. Reminder eligibility is a pure function of local timestamps and save count, and export success updates only local reminder metadata.

**Tech Stack:** React, TypeScript, IndexedDB, Vitest.

**执行记录（2026-09-27）：** Task 1–3 已在 `codex/prompt-delivery` 分支实施并提交。全量测试 188 个文件、1088 项通过；TypeScript、Lint（无错误，既有警告仍在）及生产构建通过。桌面镜像与浏览器 IndexedDB 的差异在 UI 中明确说明；浏览器人工验收仍待进行。

---

## File map

- `utils/storageAttribution.ts`: pure deduplicated summary from catalog, asset, and delta metadata.
- `services/storage/storageAttributionScan.ts`: read-only cursor scan, invoked only by a button.
- `utils/backupReminder.ts`: pure reminder policy and local metadata schema.
- `components/features/Settings/StorageManager.tsx`: button, report, reminder, export-success bookkeeping.
- `components/features/Settings/storage/StorageSaveTreeView.tsx`: mark each node size as estimated.
- `tests/unit/storageAttribution.test.ts`, `tests/unit/backupReminder.test.ts`: pure behavior and shared-resource regression.

## Task 1: Pure attribution summary

**Files:** new `utils/storageAttribution.ts`, new `tests/unit/storageAttribution.test.ts`.

- [ ] **Write failing tests:** two saves reference one asset `shared` via two delta records; asset store has `shared` (200 bytes), `solo` (100 bytes), and `orphan` (40 bytes). Assert unique asset bytes are 340, shared bytes 200, indexed-unreferenced bytes 40, delta-node count 2, and save-node `sizeBytes` total is reported separately rather than added to asset bytes. Duplicate references within one delta must count once.
- [ ] **Run red:** `node node_modules/vitest/vitest.mjs run tests/unit/storageAttribution.test.ts` (missing export).
- [ ] **Implement:** `summarizeStorageAttribution(saves, assets, deltas)` with `Map<assetId, Set<saveId>>`; return `{ nodeEstimateBytes, deltaNodeCount, uniqueAssetBytes, sharedAssetBytes, unreferencedAssetBytes, assetCount }`. Sanitize all input sizes to finite nonnegative values. Do not calculate a combined “actual usage” total.
- [ ] **Run green** and commit only Task 1 files as `feat: summarize storage attribution`.

## Task 2: Read-only on-demand scan and UI

**Files:** new `services/storage/storageAttributionScan.ts`, `components/features/Settings/StorageManager.tsx`, `components/features/Settings/storage/StorageSaveTreeView.tsx`.

- [ ] **Write failing UI test:** render the storage analysis control using a mocked scanner; assert scanner is not called on initial render and is called once after pressing `分析存储`; check that output says `估算` and shared resource bytes are not summed into a claimed browser total.
- [ ] **Run red:** targeted Vitest UI test.
- [ ] **Implement:** `scanStorageAttribution(saves)` opens `openGameDatabase()` only on click and scans `SAVE_ASSETS_STORE` and `SAVE_NODE_DELTAS_STORE` with read-only cursors. Pass `{ id, bytes }` and `{ saveId, baseMode, assetIds }` metadata to the pure summarizer; never keep Blob or image data in React state. In the storage tab render a button, loading/error state, and the separately labeled values. Add `估算` beside existing per-save `sizeBytes` text. Do not change deletion, import, or export behavior.
- [ ] **Run green:** UI test, TypeScript, production build. Commit Task 2 files.

## Task 3: Dismissible backup reminder

**Files:** new `utils/backupReminder.ts`, `components/features/Settings/StorageManager.tsx`, new `tests/unit/backupReminder.test.ts`.

- [ ] **Write failing tests:** no reminder before seven days, no reminder with fewer than ten new save nodes since last export, show it after both thresholds, and suppress it for seven days after dismissal. A successful export resets the baseline count and timestamp.
- [ ] **Run red:** `node node_modules/vitest/vitest.mjs run tests/unit/backupReminder.test.ts`.
- [ ] **Implement:** `shouldSuggestBackup({ now, firstSeenAt, lastExportAt, lastExportSaveCount, dismissedUntil, saveCount })` returns boolean. Persist only these numeric fields in a dedicated localStorage key, guarded by try/catch. The reminder offers `导出当前` and `稍后提醒`; call `markExportSuccess` only after `exportSavePackage` or `exportSaveTreePackage` resolves. No automatic export or deletion.
- [ ] **Run green:** targeted tests, full Vitest suite, TypeScript, Lint and production build. Commit Task 3 files.

## Self-review and handoff

The shared-asset count is deduplicated by asset ID; the node estimate may already include album bytes, so the UI explicitly says these values are not additive. Asset records without delta references are “索引未找到引用”, not safe-to-delete orphans. Desktop mirror data may differ from browser IndexedDB; the report identifies its source. The user already selected inline execution; continue in this task and leave unrelated phone-reply edits untouched.
