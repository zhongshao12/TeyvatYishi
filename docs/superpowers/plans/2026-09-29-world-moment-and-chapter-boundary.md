# World Moment and Chapter Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one committed game-world moment drive time, memory provenance, downstream records, and the displayed current chapter.

**Architecture:** Retain `TeyvatWorld` as the only mutable current-time authority. A pure time decision and a frozen `WorldMoment` cross the main-turn settlement boundary; memory and background consumers receive that value instead of reading a later clock. Story alignment is committed against the same turn version before the chapter label is published.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, pnpm 10; Node >=22.18.0.

**Spec:** `docs/superpowers/specs/2026-09-29-world-moment-and-chapter-boundary-design.md`

## Global Constraints

- Preserve all currently dirty, unrelated workspace files; stage only files belonging to the current task.
- Do not replace `TeyvatWorld`, invent historical weather/location for old saves, or use `Date.now()` as game time.
- A game-world time change has one settlement ID and must be idempotent on recovery/retry.
- Keep real timestamps for technical ordering/diagnostics, distinctly named from game-world time.
- This plan covers requirements 1–3 only; proactive NPCs, phone `@`, failure center, code splitting, and avatar classification follow separate plans.

## Review Focus

1. Narrative says “09:00” while the same-day clock is 10:00: do not silently replace it with a default +3 minutes; preserve time and explain the conflict (Task 2 test).
2. Narrative says “三天后” near midnight: advance exactly three calendar days and three travel days, not four or one (Task 2 test).
3. A legacy archive lacks provenance: display unknown fields, not the current location/weather (Task 4 test).
4. A delayed background completion runs after another turn: retain the originating turn's moment (Task 5 test).
5. A story-setting edit races with turn alignment: do not overwrite the later edit; surface a blocked/concurrent result (Task 3 test).

---

### Task 1: Immutable world-moment value and reader

**Files:** Create `models/teyvat/worldMoment.ts`, `services/worldMoment.ts`, `tests/unit/worldMoment.test.ts`; modify `models/teyvat/irminsul.ts` only in Task 4.

**Interfaces:** Produce `WorldMoment { worldName: '提瓦特'; date: string | null; clock: string | null; weather: string | null; location: string | null; travelDay: number | null; turn: number; settlementId: string }`, `WorldMomentRange { start: WorldMoment | null; end: WorldMoment | null; sourceIds: string[] }`, `captureWorldMoment(world: TeyvatWorld, turn: number, settlementId: string): Readonly<WorldMoment>`, and `normalizeWorldMoment(raw: unknown): WorldMoment | null`. A missing historical field stays `null`; only display formatting says “未记录”.

- [ ] **Step 1: Write the failing test.** Assert a captured moment has `date: '旅行历 1000.03.07'`, `clock: '10:00'`, `worldName: '提瓦特'`, and that mutation of the source world afterward does not alter the snapshot. Assert normalization of an old partial record yields `null` for absent weather/location.
- [ ] **Step 2: Verify red.** Run `pnpm exec vitest run tests/unit/worldMoment.test.ts`; expect missing module/export failure.
- [ ] **Step 3: Implement the model and pure reader.** Keep returned values JSON-serializable; reject invalid turn/settlement ID; do not infer past fields from current world state during normalization.
- [ ] **Step 4: Verify green.** Run the same Vitest command; expect PASS.
- [ ] **Step 5: Commit only Task 1 files.** `git add models/teyvat/worldMoment.ts services/worldMoment.ts tests/unit/worldMoment.test.ts` then `git commit -m "feat: define immutable game world moments"`.

### Task 2: One time decision with explicit conflict results

**Files:** Modify `models/variableCommand.ts`, `utils/variableFacts.ts`, `hooks/useGame/variableSettlementWorkflow.ts`, `tests/unit/userReportedTimeProgressionRound4.test.ts`; create `tests/unit/worldTimeDecision.test.ts`.

**Interfaces:** Produce `resolveTurnTimeFact(body: string, currentTime: string, modelFact?: Extract<变量事实, { type: 'time' }>): { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null }`. Extend the time fact with optional positive integer `days` for explicit multi-day `next_day`; `factsToTeyvatDomainCommands` remains the sole date/clock/day command builder. `deriveNarrativeTimeFact` may delegate to the new resolver for existing callers.

- [ ] **Step 1: Write failing tests.** Assert “三天后” yields `next_day` with `days: 3`; from `旅行历 1000.03.07` / `23:30` / day 1 the resulting commands set date `旅行历 1000.03.10` and travel day 4 exactly once. Assert an explicit same-day 09:00 against 10:00 returns `{ fact: null, warning: expect.stringContaining('回退') }`, while a normal untimed action returns elapsed 3 minutes. Update the old contradictory-clock test that currently expects silent +3 fallback.
- [ ] **Step 2: Verify red.** Run `pnpm exec vitest run tests/unit/worldTimeDecision.test.ts tests/unit/userReportedTimeProgressionRound4.test.ts`; expect new cases to fail.
- [ ] **Step 3: Implement resolution and command conversion.** Narrative evidence wins over a contradictory model fact; no usable evidence permits default elapsed. Malformed clock/date, contradictory explicit evidence, or backward same-day clock yields a warning and no fabricated fallback. Carry `warning` into existing settlement feedback. Keep `set_time` and `next_day` command application idempotent within a single fact batch.
- [ ] **Step 4: Verify green.** Run the same Vitest command plus `pnpm exec tsc -b --pretty false`; expect PASS.
- [ ] **Step 5: Commit only Task 2 files.** Use `git add` with the five paths above, then `git commit -m "fix: settle narrative time from one validated decision"`.

### Task 3: Freeze the committed turn and synchronize chapter

**Files:** Modify `hooks/useGame/variableCalibrationStage.ts`, `hooks/useGame/postSettlementCommitStage.ts`, `services/storyProgressService.ts`, `hooks/useGame/sendWorkflow.ts`, `models/teyvat/runtimeSlices.ts`; create `tests/unit/committedWorldMoment.test.ts`, `tests/unit/committedChapterAlignment.test.ts`.

**Interfaces:** Produce `CommittedTurnContext { settlementId: string; moment: WorldMoment; storyWeaving: 剧情编织系统; warnings: string[] }` from the committed game plus the resolved story alignment. Persist `moment` on the matching `VariableBatchDto` and as `NarrativeRuntime.lastCommittedMoment` for recovery; pass the context to later stages instead of capturing pre-settlement `state.世界`. Keep `getCurrentStoryChapterLabel(system)` as the UI selector over committed `storyWeaving`.

- [ ] **Step 1: Write failing tests.** For a completed scene with satisfied gate, assert the context's story anchor and chapter label are the next segment and `moment.clock` matches committed world time. For a blocked gate, assert no forced advancement and a warning naming the gate. For two writes with the same settlement ID, assert the committed date/travel day and chapter are unchanged on replay. For a concurrent `storyWeavingSystem` edit, assert the later edit survives and a warning is returned.
- [ ] **Step 2: Verify red.** Run `pnpm exec vitest run tests/unit/committedWorldMoment.test.ts tests/unit/committedChapterAlignment.test.ts`; expect FAIL.
- [ ] **Step 3: Implement the commit boundary.** Compute story alignment against the committed turn, check live version before publishing, persist it with the turn's recovery journal, and build `CommittedTurnContext` only after successful commit. Preserve the current concurrent-write guard rather than overwriting the latest settings. Propagate the context through the send workflow; do not update the side label from an uncommitted draft.
- [ ] **Step 4: Verify green.** Run those tests, `pnpm exec vitest run tests/unit/storyWeavingConflict.test.ts tests/unit/storySceneProgress.test.ts`, and `pnpm exec tsc -b --pretty false`; expect PASS.
- [ ] **Step 5: Commit only Task 3 files.** Use explicit paths, then `git commit -m "fix: publish chapter and world moment from committed turn"`.

### Task 4: Preserve memory and Irminsul source moments

**Files:** Modify `models/memory.ts`, `models/teyvat/runtimeSlices.ts`, `models/teyvat/irminsul.ts`, `hooks/useGameState.ts`, `hooks/useGame/memoryUtils.ts`, `hooks/useGame/memoryUpdateStage.ts`, `hooks/useGame/postNarrativeMemoryStage.ts`, `hooks/useGame/postTurnIrminsulTask.ts`, `services/irminsulPromotion.ts`, `components/features/GameSystems/MemoryPanel.tsx`, `components/features/GameSystems/IrminsulPanel.tsx`, `hooks/useGame/sendWorkflow.ts`; create `tests/unit/memoryWorldMoment.test.ts`.

**Interfaces:** Extend `记忆系统` with stable `即时记忆ID?: (string | null)[]` and `来源时刻?: Record<string, WorldMomentRange>` keyed by stable memory/archive ID. Extend `IrminsulEntry` with optional `sourceMomentRange?: WorldMomentRange`. Add `moment: WorldMoment` to `PostNarrativeMemoryStageInput` and `PostTurnIrminsulArchiveTaskInput`. Keep old text arrays and `recordedAt` as compatibility/technical fields, not provenance.

- [ ] **Step 1: Write failing tests.** Assert a new immediate memory and its short archive share the originating moment; a middle/long summary spans first-to-last source moments with source IDs. Assert delayed compression, retry, and promotion do not restamp the range. Normalize an old archive without moment and assert unknown date/weather/location rather than current values; trimming immediate memories keeps IDs aligned.
- [ ] **Step 2: Verify red.** Run `pnpm exec vitest run tests/unit/memoryWorldMoment.test.ts tests/unit/postNarrativeMemoryStage.test.ts tests/unit/irminsulPromotion.test.ts`; expect new cases to fail.
- [ ] **Step 3: Implement provenance plumbing.** Defer persistent memory append/compression until `CommittedTurnContext` exists, passing its frozen moment to the memory stage. Preserve source IDs/ranges through all three compression tiers and world-tree promotion; render mixed locations/weather as “多地点”/“多天气”. Legacy records retain text with unknown metadata.
- [ ] **Step 4: Verify green.** Run the same tests plus `pnpm exec vitest run tests/unit/legacySaveMigration.test.ts`; expect PASS.
- [ ] **Step 5: Commit only Task 4 files.** Use explicit paths, then `git commit -m "feat: retain event world moments through memory compression"`.

### Task 5: Migrate downstream world-time consumers

**Files:** Modify `models/teyvat/courier.ts`, `models/teyvat/steambird.ts`, `models/teyvat/world.ts`, `models/teyvat/character.ts`, `models/npc.ts`, `hooks/useGameState.ts`, `hooks/useGame/courierWorkflow.ts`, `hooks/useGame/courierBackgroundJobs.ts`, `hooks/useGame/steambirdWorkflow.ts`, `hooks/useGame/postTurnBackgroundTasks.ts`, `hooks/useGame/questWorkflow.ts`, `services/questService.ts`, `utils/variableFacts.ts`, `hooks/useGame/variableCalibrationStage.ts`; create `tests/unit/downstreamWorldMoment.test.ts`.

**Interfaces:** Add optional `worldMoment?: WorldMoment` to persisted phone/news/quest/NPC event records that already have technical timestamps. Keep `TeyvatWorld.世界事件: string[]` as a compatibility projection and add stable-ID event records carrying `worldMoment`. Background task inputs take `moment: WorldMoment` from `CommittedTurnContext`; quest/NPC/world-event settlement receives the same moment through the existing committed game/fact path. Do not create a new random-event scheduler: the current `world_event` fact is the event source in this codebase.

- [ ] **Step 1: Write failing tests.** With turn 2 ending at 14:00 and turn 3 ending at 18:00, assert delayed turn-2 phone/news/quest/NPC/world-event writes still show turn-2 `worldMoment`. Assert the old numeric `timestamp`/`createdAt` remain technical fields and legacy records without `worldMoment` normalize to unknown, not “18:00”.
- [ ] **Step 2: Verify red.** Run `pnpm exec vitest run tests/unit/downstreamWorldMoment.test.ts`; expect FAIL.
- [ ] **Step 3: Implement consumer adapters.** Thread the frozen context through background jobs and add normalized optional moment fields. Use world moment for displayed game date/time and game-time triggers; retain real timestamps for UI transport ordering and diagnostics. Ensure phone actions outside a main turn capture the current committed world moment but do not advance the world clock independently.
- [ ] **Step 4: Verify green.** Run the new test plus `pnpm exec vitest run tests/unit/debouncedCourierAutosave.test.ts tests/unit/postTurnAutosaveTask.test.ts`; expect PASS.
- [ ] **Step 5: Commit only Task 5 files.** Use explicit paths, then `git commit -m "feat: share committed world time with downstream systems"`.

### Task 6: End-to-end recovery and release gates

**Files:** Modify `hooks/useGame/saveLoadWorkflow.ts`, `models/teyvat/state.ts`, `App.tsx`; create `tests/unit/worldMomentTurnRecovery.test.ts`; modify existing regression tests only when they encode superseded behavior.

**Interfaces:** No new production interface; validate Tasks 1–5 together.

- [ ] **Step 1: Write failing integration tests.** Execute main turn → committed world moment → memory/Irminsul/background write → save → load → chapter label; assert the reloaded save retains `lastCommittedMoment`, one date/travel-day advancement, identical event provenance, and the committed chapter label. Replay the same settlement ID and assert no duplicate event or second time advance.
- [ ] **Step 2: Verify red against the still-unmigrated save/read boundary.** Run `pnpm exec vitest run tests/unit/worldMomentTurnRecovery.test.ts`; expect FAIL on missing restored moment or stale chapter.
- [ ] **Step 3: Normalize/restore `lastCommittedMoment` in save loading and select the reloaded committed story for the App label.** Close only integration seams found by the test; keep fixtures deterministic and do not broaden scope to later requirements.
- [ ] **Step 4: Verify green and build.** Run `pnpm exec vitest run tests/unit/worldMomentTurnRecovery.test.ts tests/unit/worldMoment.test.ts tests/unit/worldTimeDecision.test.ts tests/unit/committedWorldMoment.test.ts tests/unit/committedChapterAlignment.test.ts tests/unit/memoryWorldMoment.test.ts tests/unit/downstreamWorldMoment.test.ts`, then `pnpm build`, `pnpm test:story-weaving`, and `pnpm test:irminsul-archive`; all must pass. Inspect build output for unexpected circular chunk warnings and report them separately rather than expanding this plan to fix requirement 6.
- [ ] **Step 5: Commit integration tests and any scoped seam fixes.** Stage explicit paths only; `git commit -m "test: cover world moment recovery end to end"`.
