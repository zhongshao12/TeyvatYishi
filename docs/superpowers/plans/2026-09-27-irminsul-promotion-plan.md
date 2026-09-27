# 世界树安全晋升与归档去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让短、中、长期世界树摘要在成功晋升后只保留可召回的最高可信版本，同时确保失败、旧档与重试不丢原始记忆。

**Architecture:** 每条新归档携带明确的来源条目 ID、来源回合和状态；只在上层摘要成功且其来源完整可验证时执行纯函数晋升，删除已被完整覆盖的低层归档并在上层保留来源 ID/回合。压缩结果先形成新记忆/世界树快照，再以现有保存机制一起提交；旧档无可靠覆盖链时保持不动。

**Tech Stack:** TypeScript、Vitest、现有记忆压缩 API、Irminsul 模型、React 世界树页面与存档服务。

**Spec:** `docs/superpowers/specs/2026-09-27-npc-affinity-irminsul-consistency-design.md` 第 4 节及相关验收场景。

## Global Constraints

- 只清理被成功、可检索、完整覆盖的上层摘要明确指向的低层活跃条目；未知覆盖关系不猜测。
- 失败、取消、fallback 与待重试草稿保留来源，不参与清理；旧档不可验证的条目原样保留。
- 来源回合可追踪；同一压缩或重试重复执行不增副本。
- 不删除普通游戏时间、NPC 记忆账本、精炼剧情纪要或未解决失败草稿。
- 不新增依赖；先失败测试，后最小代码。

## Review Focus

- 两条摘要正文相同却来自不同回合：Task 1/2 的测试必须证明不靠文本相同误删。
- 同一回合有多个精炼纪要或任务纪要：Task 1 的测试必须证明只替换明确覆盖的 ID。
- 模型请求失败且返回 fallback：Task 2 的测试必须证明来源、失败草稿和可重试入口都保留。
- 重试成功但目标 fallback 已被用户修改：Task 3 的测试必须证明报 `source_changed` 且世界树不清理。
- 旧档缺少来源链并临近 600 条上限：Task 1/4 的测试必须证明归一化不把未知旧条目当作可安全晋升对象。

---

### Task 1: 归档状态、来源链与纯晋升操作

**Files:**
- Create: `services/irminsulPromotion.ts`
- Modify: `models/teyvat/irminsul.ts`, `services/irminsulArchive.ts`, `services/irminsulRetrieval.ts`
- Test: `tests/unit/irminsulPromotion.test.ts`, `tests/unit/retrievalBehavior.test.ts`, `tests/unit/archiveEntryLimits.test.ts`

**Interfaces:**
- Produces: optional `IrminsulEntry.coveredEntryIds?: string[]`, `status?: 'active' | 'pending'`; old missing status means `active`, old missing coverage means unverifiable.
- Produces: `promoteIrminsulEntry(memory: IrminsulMemory, entry: IrminsulEntry): IrminsulMemory` and `getActiveIrminsulEntries(memory: IrminsulMemory): IrminsulEntry[]`.
- A successful new entry has nonempty summary, exact source ID set and union of source turns; only then may covered lower-layer active entries be removed from storage. Pending or empty entries never promote.

- [ ] **Step 1: Write failing tests** named `promotes_only_exact_source_ids`, `promotion_is_idempotent` and `old_entries_near_limit_stay_unverified`: assert both `promoteIrminsulEntry(memory, upper).entries.map(x => x.id)` and `getActiveIrminsulEntries(...).map(x => x.id)` equal only the expected upper/unrelated IDs after verified promotion; pending, missing-source, same-text/different-turn and duplicate promotion cases retain the expected sources. A 600-entry old archive with no coverage metadata must not gain fabricated source IDs or lose an unresolved pending source.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/irminsulPromotion.test.ts tests/unit/retrievalBehavior.test.ts tests/unit/archiveEntryLimits.test.ts`; expect new tests to fail.
- [ ] **Step 3: Add optional fields and normalization** to `IrminsulEntry`; preserve old entries without manufacturing coverage. Under the existing 600-entry limit, preserve pending-source evidence ahead of covered entries; do not silently discard an unresolved draft's only source.
- [ ] **Step 4: Implement the two pure helpers** and route retrieval through active entries. `promoteIrminsulEntry` checks all referenced source IDs exist and are lower-layer active entries before deleting them; if any ID is missing, store the upper entry without deleting source.
- [ ] **Step 5: Re-run** the three test files and `pnpm exec tsc -b --pretty false`; expect PASS/exit 0.
- [ ] **Step 6: Commit** only Task 1 files with `feat: track verified Irminsul archive promotion`.

### Task 2: 压缩流水线携带精确覆盖关系

**Files:**
- Modify: `hooks/useGame/memoryUtils.ts`, `hooks/useGame/postNarrativeMemoryStage.ts`, `models/memory.ts`
- Test: `tests/unit/postNarrativeMemoryStage.test.ts`, `tests/unit/irminsulPromotion.test.ts`

**Interfaces:**
- Consumes: Task 1 `promoteIrminsulEntry` and active-entry helper.
- Produces: `autoCompressMemorySystemWithArchivesAsync(..., irminsul?: IrminsulMemory)` where the optional final argument supplies existing provenance; `记忆失败草稿.archiveEntryId?: string` pins a pending fallback to a world-tree entry for retry.
- Archive IDs for new compressed batches derive from source identities/turn and layer, not only `Date.now()`; duplicate summaries without a unique source match get no coverage link.

- [ ] **Step 1: Write failing tests** named `compresses_across_layers_without_duplicate_recall` and `failed_fallback_keeps_source`: assert active IDs contain only the verified highest layer after short→medium→long, but still contain both ambiguous same-text sources or all original sources after fallback/abort. A second identical call must not increase archive count.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/postNarrativeMemoryStage.test.ts tests/unit/irminsulPromotion.test.ts`; expect new tests to fail.
- [ ] **Step 3: Add stable archive identity and provenance matching** in `memoryUtils`: match previous layer item to exactly one active archive by stored source identity/turn; ambiguous or old entries remain unlinked. Preserve the original `sourceTurns` union on the promoted entry.
- [ ] **Step 4: Mark fallback archives `pending`** and attach their ID to the failure draft; do not promote them, even when their local summary is nonempty. Cancellation leaves the input world tree untouched.
- [ ] **Step 5: Update `settlePostNarrativeMemory`** to pass the current world tree into compression and fold archives through `promoteIrminsulEntry` only after a complete successful result. Preserve existing feedback and failure-count behavior.
- [ ] **Step 6: Re-run** the targeted tests and `pnpm test:irminsul-archive`; expect PASS.
- [ ] **Step 7: Commit** only Task 2 files with `fix: promote Irminsul summaries only after verified compression`.

### Task 3: 失败草稿重试与持久化原子性

**Files:**
- Modify: `hooks/useGame/memoryUtils.ts`, `hooks/useGame.ts`, `hooks/useGame/memorySaveTask.ts`, `hooks/useGame/postNarrativeMemoryStage.ts`
- Test: `tests/unit/postNarrativeMemoryStage.test.ts`, `tests/unit/saveStatusIntegration.test.ts`

**Interfaces:**
- Consumes: `记忆失败草稿.archiveEntryId` and Task 1 promotion.
- Produces: `retryMemoryFailureDraft(system, draftId, settings, mainConfig, signal?, irminsul?: IrminsulMemory): Promise<RetryMemoryFailureDraftResult & { irminsul?: IrminsulMemory }>`.
- Produces: `persistMemorySnapshot(state, memory, irminsul?: IrminsulMemory): Promise<void>`; supplied memory and world tree enter one `buildSavePayload` override.

- [ ] **Step 1: Write failing tests** named `retry_replaces_only_its_pending_archive` and `retry_save_persists_memory_and_tree_together`: assert a resolved draft has `sourceSnapshot.payload === ''` and only its `archiveEntryId` is promoted; `source_changed` leaves the tree equal to input; duplicate retry is equal to prior output; the saved payload contains both overridden `记忆` and `世界树`.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/postNarrativeMemoryStage.test.ts tests/unit/saveStatusIntegration.test.ts`; expect the new assertions to fail.
- [ ] **Step 3: Extend retry return value** with the updated world tree when an `archiveEntryId` exists. On success, replace that pending entry’s summary/status and promote only its verified covered IDs; on error/source change, return original world tree unchanged.
- [ ] **Step 4: Extend `persistMemorySnapshot`** with optional world-tree override and update the retry handler in `hooks/useGame.ts` to persist the pair via one save payload before presenting success. Retain current failure hint if save fails.
- [ ] **Step 5: Re-run** both tests, `pnpm test:irminsul-archive`, `pnpm exec tsc -b --pretty false`; expect PASS/exit 0.
- [ ] **Step 6: Commit** only Task 3 files with `fix: persist Irminsul retry with memory snapshot`.

### Task 4: 世界树页面与整体回归

**Files:**
- Modify: `components/features/GameSystems/IrminsulPanel.tsx`, `services/irminsulRetrieval.ts`
- Test: `tests/unit/irminsulPromotion.test.ts`, `tests/unit/retrievalBehavior.test.ts`, `tests/unit/irminsulPanel.test.tsx`

**Interfaces:** Consumes Task 1 status/provenance helpers; produces no new state store.

- [ ] **Step 1: Write failing UI test** `shows_active_archive_and_pending_retry_status` in jsdom: render `IrminsulPanel`, then assert the active count excludes removed covered entries, a pending item displays “待重试”, a promoted item displays its `sourceTurns`, and an old unverifiable entry remains visible without “已压缩删除”.
- [ ] **Step 2: Run** the two targeted tests; expect new assertions to fail.
- [ ] **Step 3: Render archive status and source turn provenance** in `IrminsulPanel`. Keep pending entries inspectable while excluding them from model recall; do not expose raw failure payload in the ordinary list.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm lint`, `pnpm build`, `pnpm test:irminsul-archive`; expect all exit 0. Manually check old save without coverage, successful promotion, failed request and successful retry.
- [ ] **Step 5: Commit** any remaining integration fixes with `test: cover Irminsul promotion and recovery`.
