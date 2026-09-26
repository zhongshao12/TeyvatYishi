# Isolate New-Game Save Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every new game a clean per-game state and distinct save tree even when two travelers share a name.

**Architecture:** Move new-game state construction out of `App.tsx` into a pure builder seeded from `createEmptyTeyvatGameState()`. Keep global configuration and codex definitions, but clear per-game codex unlocks. Use existing random save-tree IDs and ID-based load paths; do not rewrite historical saves.

**Tech Stack:** React, TypeScript, Vitest, IndexedDB save service, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-26-tavern-presets-and-new-game-isolation-design.md`

## Global Constraints

- Two travelers may have the same display name; never use it as a storage key or identity.
- New games reset every per-game slice; API settings and imported Tavern presets remain global.
- Keep bundled and self-authored codex definitions, but clear `unlockedEntryIds`, `runtimeUnlock.status` and `runtimeUnlock.note` for the new game.
- Do not mutate existing saved records or infer ownership of data that may already be mixed.
- Do not change “纪年” or implement lottery.
- Preserve the pre-existing uncommitted courier-reply changes in `App.tsx`, `hooks/useGame/courierReplyQueue.ts` and `tests/unit/courierReplyQueue.test.ts`.

## Review Focus

- First game has old inventory/quests/album/maps/phone/memory: second same-name game starts with defaults (Task 1 test).
- Old codex definitions include custom entries and runtime unlocks: definitions remain, unlock progress clears (Task 1 test).
- Canon story loading fails: fallback contains no prior run's story progress (Task 2 test).
- A prior save tree was active: first save after new game gets a new root, not the prior root (Task 3 test).
- Two same-name games are saved and loaded by ID: their roots and payloads remain distinct (Task 3 test).

---

### Task 1: Build a fresh opening state

**Files:**
- Create: `hooks/useGame/newGameState.ts`
- Test: `tests/unit/newGameState.test.ts`

**Interfaces:**
- Produces: `buildNewGameState(input: { traveler: 角色数据结构; world: 世界状态; initialNpcs: NPC记录[]; storyWeaving: 剧情编织系统; codexCatalog: ArchiveCodex }): TeyvatGameState`.
- Consumes: `createEmptyTeyvatGameState()`, existing Legacy-to-Teyvat conversion helpers, and the current global codex content definitions.

- [ ] **Step 1: Write failing tests** that call the proposed builder twice for identical traveler names and assert fresh inventory, quests, album, map, phone, memory, narrative, queue, world tree, news and canon track. Assert traveler/world/NPC/story values come from each opening only; codex definitions remain while progress clears.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/newGameState.test.ts`; confirm expected missing-builder failure.
- [ ] **Step 3: Implement** `buildNewGameState` using a newly created empty root; set turn count to 1; clone codex entries with runtime unlock status/note reset and empty `unlockedEntryIds`; do not accept a previous game as input.
- [ ] **Step 4: Re-run** focused tests; all must pass.
- [ ] **Step 5: Commit** only builder and test with `fix: construct new games from empty state`.

### Task 2: Wire the opening flow to the fresh builder

**Files:**
- Modify: `App.tsx` at `handleStartGame`.
- Test: `tests/unit/newGameOpeningWorkflow.test.ts` against a new injectable opening transaction in `hooks/useGame/newGameOpening.ts`.
- Create: `hooks/useGame/newGameOpening.ts`.

**Interfaces:**
- Consumes: `buildNewGameState` from Task 1.
- Produces: `prepareNewGameState(input: { traveler: 角色数据结构; world: 世界状态; initialNpcs: NPC记录[]; codexCatalog: ArchiveCodex; loadStoryWeaving: () => Promise<剧情编织系统> }): Promise<{ game: TeyvatGameState; storyWeaving: 剧情编织系统 }>`; fallback uses `创建空剧情编织系统()`, never the prior run's story.

- [ ] **Step 1: Write a failing transaction test**: identical-name opening with a rejected story loader yields empty story rather than prior progress; successful loader aligns the story to the supplied opening archive; `game` has no prior inventory/quest contents.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/newGameOpeningWorkflow.test.ts`; confirm the missing transaction behavior.
- [ ] **Step 3: Implement** `prepareNewGameState` with Task 1 builder and aligner; change `handleStartGame` to invalidate the prior session at entry, call the transaction, abandon the result if that session was superseded, clear active save-tree metadata, then `replaceGameState(game)`. Keep the current launch UX and persistent story catalog write.
- [ ] **Step 4: Re-run** `pnpm exec vitest run tests/unit/newGameOpeningWorkflow.test.ts tests/unit/gameSessionIdentity.test.ts`; both must pass.
- [ ] **Step 5: Commit** only Task 2 changes, taking care to preserve the pre-existing unrelated `App.tsx` diff, with `fix: isolate fresh opening runtime`.

### Task 3: Verify same-name save/load and regression suite

**Files:**
- Test: `tests/unit/newGameSaveIsolation.test.ts`.
- Modify: save identity code only if the failing test reveals an additional ID-based storage defect; otherwise no production save-service edit.

**Interfaces:**
- Consumes: Task 1 builder, `buildSavePayload`, `saveGame`, `loadSave`, and save-tree metadata helpers.
- Produces: repeatable two-same-name save/load regression proof.

- [ ] **Step 1: Write a same-name persistence test** using the Task 1 builder and existing save helpers: first save has `rootId A` and item `日落果`, second starts clean with the same name and saves as `rootId B`; reloading by each numeric ID returns its own inventory. This is an integration characterization of existing save service, while Task 1/2 tests are the red tests for the actual bug.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/newGameSaveIsolation.test.ts`; if it fails, inspect the failure before changing storage. If it passes, record the storage layer as already correctly ID-based.
- [ ] **Step 3: Modify** save identity code only if Step 2 reveals an independent storage defect, with a new failing test for that defect first; otherwise make no production save-service edit.
- [ ] **Step 4: Run** `pnpm exec vitest run tests/unit/newGameState.test.ts tests/unit/newGameOpeningWorkflow.test.tsx tests/unit/newGameSaveIsolation.test.ts`, `pnpm test:unit`, `pnpm build`, and `pnpm test:save-isolation`; inspect full output and report failures.
- [ ] **Step 5: Commit** test and any supported fix with `test: guard same-name save isolation`.
