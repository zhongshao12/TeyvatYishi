# Committed Settlement Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show concrete backpack, affinity, quest, and game-time changes in the existing chat settlement receipt, only after a successful state commit.

**Architecture:** Compute a small, structured before/after projection at the variable settlement commit boundary and store it on the existing variable batch; do not create a parallel history. Preserve it through the existing canonical/legacy batch adapters and save normalization. The receipt reads only this committed projection, while old batches retain the current generic labels and compressed batches retain their summary notice.

**Tech Stack:** TypeScript, React, Vitest, existing `TeyvatGameState` and `变量命令批次`.

**执行记录（2026-09-27）：** 四个任务已在当前 `codex/prompt-delivery` 分支依次实现并提交。全量单元测试 185 个文件、1084 项通过；TypeScript、变更文件 Lint 与生产构建通过。浏览器人工验收仍待进行。下方清单保留为原始实施步骤。

---

## File map

- `models/variableCommand.ts`: add a bounded structured `CommittedSettlementChange` union and an optional field to the batch.
- `utils/committedSettlementChanges.ts`: pure before/after projection; IDs and quantities come from committed state, not command prose.
- `hooks/useGame/variableSettlementWorkflow.ts`: attach projection only when CAS commit succeeds; failed/rejected work cannot report success.
- `models/teyvat/runtimeSlices.ts`, `hooks/useGameState.ts`: normalize and round-trip the new batch field in saves and live adapters.
- `utils/longSessionRetention.ts`: drop detailed projections when a batch is compressed, preserving the existing compressed-history notice.
- `utils/turnSettlementReceipt.ts`: render specific labels from structured committed changes and retain safe legacy/diagnostic fallback.
- `tests/unit/committedSettlementChanges.test.ts`, `tests/unit/turnSettlementReceipt.test.ts`, existing settlement and save tests: regression coverage.

## Task 1: Pure committed-state projection

**Files:** `models/variableCommand.ts`, new `utils/committedSettlementChanges.ts`, new `tests/unit/committedSettlementChanges.test.ts`.

- [ ] **Write failing tests:** start from `createEmptyTeyvatGameState()`. Clone the state, add an inventory item with ID `apple-1`, quantity 2; add one NPC with ID `amber` and affinity 10; add an active quest; set date/time. Modify the next state to item quantity 1, affinity 15, quest completed, and time 18:00. Assert `projectCommittedSettlementChanges(before, after)` returns four typed changes with before/after values. Also assert a no-op state returns `[]`, and a changed item description alone produces no receipt change.
- [ ] **Run red:** `node node_modules/vitest/vitest.mjs run tests/unit/committedSettlementChanges.test.ts`; expect missing export.
- [ ] **Implement:** define a discriminated union `{ kind: 'item'; id; name; before; after } | { kind: 'affinity'; id; name; before; after } | { kind: 'quest'; id; title; before; after } | { kind: 'time'; beforeDate; beforeTime; afterDate; afterTime }`, with quest status typed as `QuestStatus | 'absent'`. Use maps keyed by stable IDs; quest entries come from active/completed/abandoned arrays. Bound displayed names to 80 characters and cap the projection at 50 entries with an `omitted` count on the batch if needed. No model output, evidence, prompt, or API config enters the projection.
- [ ] **Run green:** same Vitest file; expect all tests pass. Run `node node_modules/typescript/bin/tsc -b --pretty false`.
- [ ] **Commit:** only the three Task 1 files, `feat: project committed turn changes`.

## Task 2: Persist projection on the existing batch

**Files:** `models/teyvat/runtimeSlices.ts`, `hooks/useGameState.ts`, `utils/longSessionRetention.ts`, `tests/unit/teyvatSaveContract.test.ts`, `tests/unit/longSessionRetention.test.ts` (or a new dedicated round-trip test).

- [ ] **Write failing tests:** build a batch with `committedChanges` containing an item quantity change; assert `fromLegacyVariableBatches` then `toLegacyVariableBatches` retains it, `normalizeNarrativeRuntime` retains valid entries but drops malformed kinds/values, and `compactVariableBatchHistory` removes the detailed array once it creates `retentionSummary`.
- [ ] **Run red:** targeted Vitest files; expect the field to be lost.
- [ ] **Implement:** add the same optional field to `VariableBatchDto`; use a narrow normalizer that accepts only the four known kinds and finite, nonnegative quantities/affinity, valid quest statuses, and bounded strings. Copy through both adapters explicitly. When compacting, destructure `committedChanges` out of the old batch before returning its summary.
- [ ] **Run green:** targeted Vitest plus TypeScript build.
- [ ] **Commit:** only Task 2 files, `feat: persist committed receipt changes`.

## Task 3: Attach only after actual commit

**Files:** `hooks/useGame/variableSettlementWorkflow.ts`, `tests/unit/variableSettlementWorkflow.test.ts` or a new focused test.

- [ ] **Write failing tests:** with a successful `commitGame`, assert the committed batch contains a projected item change; with `commitGame` returning false (stale-save CAS), assert neither the returned batch nor committed root presents that item as applied. Repeat with a rejected command, asserting only the accepted final state contributes changes.
- [ ] **Run red:** targeted Vitest; expect missing projection and/or false-positive success.
- [ ] **Implement:** inside `commitGameState(nextState)`, derive projection from `stateSnapshot` and normalized `nextState`, build a candidate batch containing it, call `params.commitGame` with that candidate embedded in `叙事.variableBatches`, and assign `batch = candidateBatch` only if the callback returns true. On CAS refusal, return a diagnostic batch whose successful result flags are not treated as committed; never persist it to the new root. Use the existing `settlementId`/batch ID for deduplication.
- [ ] **Run green:** targeted tests and TypeScript build.
- [ ] **Commit:** only Task 3 files, `feat: attach receipt after settlement commit`.

## Task 4: Render safe concrete labels

**Files:** `utils/turnSettlementReceipt.ts`, `tests/unit/turnSettlementReceipt.test.ts`, optionally `components/features/Chat/TurnSettlementReceipt.tsx` if layout needs an omitted-count row.

- [ ] **Write failing tests:** assert a committed item change renders `苹果 2→1`, affinity change `安柏好感度 10→15`, quest status transition, and date/time transition. Duplicate batch IDs must display once. Failed and warning results remain visible with safe mapped reasons; no raw command value, report, evidence, API key, or model text appears. Old batches without projection still use generic labels; compressed batches show only `旧结算记录已压缩`.
- [ ] **Run red:** `node node_modules/vitest/vitest.mjs run tests/unit/turnSettlementReceipt.test.ts`; expect missing concrete labels.
- [ ] **Implement:** if `committedChanges` exists, turn only those into success items and append warning/failure result items; otherwise keep legacy `resultToReceiptItem`. Convert quest statuses through a fixed label table, render bounded state names as React text, and show a non-fabricated omitted-count notice when capped. Never display a successful generic command from a failed CAS batch.
- [ ] **Run green:** receipt/UI tests, then `node node_modules/vitest/vitest.mjs run`, `node node_modules/typescript/bin/tsc -b --pretty false`, `node node_modules/eslint/bin/eslint.js .`, and `node node_modules/vite/bin/vite.js build`.
- [ ] **Commit:** only Task 4 files, `feat: show concrete committed turn receipts`.

## Self-review and handoff

The plan covers persisted committed values, failed/CAS paths, deduplication, compressed history, and privacy. It does not attempt to reconstruct unavailable before-state for old batches. It reuses the existing receipt component and batch history, with no new save root. The user already selected inline execution for this task sequence; execute task-by-task with checkpoints and preserve the unrelated pending phone-reply edits.
