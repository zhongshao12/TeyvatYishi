# Six-Nation Mainline Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Mondstadt–Natlan bundled mainline into evidence-driven, multi-scene play without losing old save progress or inflating every model request.

**Architecture:** Keep every existing series/segment ID; add optional scene nodes within segments and a scene cursor in the existing progress anchor. Normalize and validate bundled JSON before use, preserve new bundled content while merging saved runtime state, then inject only the active scene window.

**Tech Stack:** React, TypeScript, Vitest, JSON resources, Vite, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-28-teyvat-mainline-expansion-design.md`

## Global Constraints

- Scope: bundled Mondstadt, Liyue, Inazuma, Sumeru, Fontaine, Natlan mainline only; no Nod-Krai, side quests, Dou Dizhu, or codex work.
- Preserve existing series IDs, segment IDs, group numbers, and saved completed/skipped/deviated states.
- Custom traveler and Aether/Lumine presence follow opening/party state; never imply all three travel together.
- Divergent player history and NPC knowledge override canon defaults; a skipped segment is never presented as experienced.
- No new dependency or duplicate runtime canon data source; long resource prose is never injected wholesale.

## File Structure

- `data/storyCanonValidation.ts`: pure bundled-series schema/content checks; `tests/unit/storyCanonResourceContract.test.ts` reads real JSON and checks failures.
- `models/storyWeaving.ts`: optional scene-node and cursor types/normalization; `tests/unit/storySceneModel.test.ts` covers old/new anchors.
- `data/storyWeavingPreset.ts`: resource loading and persisted/bundled merge; `tests/unit/storyWeavingPresetMerge.test.ts` pins old-save behavior.
- `services/storySceneProgress.ts`: one-scene-at-a-time evidence transition; `services/storyProgressService.ts` calls it; `tests/unit/storySceneProgress.test.ts` owns state cases.
- `services/storyWeaving.ts`: bounded scene-window formatting; `tests/unit/storySceneInjection.test.ts` owns visibility/budget cases.
- `public/data/story-weaving-canon/story_canon_teyvat_*.json`: 15 existing in-scope series; `tests/unit/storyCanonScenes.test.ts` checks nation coverage, stable IDs, order and content invariants.

## Review Focus

1. Old saved canonical prose masking updated bundled scenes → Task 2 test: old state survives while new content wins.
2. Old save already past a chapter reopening it → Task 3 test: archived segment remains archived.
3. A location/name mention falsely completing a scene → Task 3 test: only explicit result evidence advances.
4. NPC discovering reader-only facts → Task 4 test: player/NPC visibility filtering.
5. Six-nation expansion increasing prompt size linearly → Task 4 test: only current plus one preview node and bounded output.

---

### Task 1: Restore and Validate Existing Canon Events

**Files:** Create `data/storyCanonValidation.ts`, `tests/unit/storyCanonResourceContract.test.ts`; modify the 15 in-scope `public/data/story-weaving-canon/story_canon_teyvat_*.json` files and `data/storyWeavingPreset.ts`.

**Interfaces:** Produce `validateBundledStorySeries(raw: unknown): string[]`; the loader rejects a malformed in-scope resource with a diagnostic including series ID rather than silently treating it as empty. The resource field names are `事件名`, `事件说明`, `角色名`, `本段变化`, and nonempty `事件结果`.

- [ ] **Step 1: Write failing test.** Read all 15 JSON files; assert zero validation issues, at least one retained normalized event and role progression in each series, and that malformed event/name/duplicate ID cases return issues.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storyCanonResourceContract.test.ts`; expect failure on existing `事件` and `角色` fields.
- [ ] **Step 3: Implement validator and fix resource fields.** Keep all existing series/segment IDs and result meanings; validate before/after normalization in `loadDecomposedCanonSeries`.
- [ ] **Step 4: Run** the focused test and `pnpm test:story-weaving`; expect pass.
- [ ] **Step 5: Commit** `fix: retain and validate bundled story events`.

### Task 2: Preserve Saved State While Refreshing Bundled Content

**Files:** Modify `data/storyWeavingPreset.ts`; create `tests/unit/storyWeavingPresetMerge.test.ts`.

**Interfaces:** `mergeBundledStoryWeavingPresets(saved, bundled)` keeps saved runtime fields (`启用注入`, `处理状态`, `运行状态`, `updatedAt`, current series/segment anchor and scene cursor) but takes all canonical descriptive fields from `bundled`; custom series remain untouched.

- [ ] **Step 1: Write failing test.** Save an older version of a segment with changed title/summary/events and completed state; merge a newer bundled segment; assert new prose/events plus saved state, and no new segment silently marked experienced. Include same-name and custom-series controls.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storyWeavingPresetMerge.test.ts`; expect old prose to win incorrectly.
- [ ] **Step 3: Implement field-level state merge** in `data/storyWeavingPreset.ts` without changing exported signatures or existing persistence version behavior for custom series.
- [ ] **Step 4: Run** focused test and `pnpm test:save-isolation`; expect pass.
- [ ] **Step 5: Commit** `fix: refresh bundled canon without resetting saves`.

### Task 3: Scene Model and Evidence-Only Progress

**Files:** Modify `models/storyWeaving.ts`, `services/storyProgressService.ts`; create `services/storySceneProgress.ts`, `tests/unit/storySceneModel.test.ts`, `tests/unit/storySceneProgress.test.ts`.

**Interfaces:** Export `剧情编织场景事实 = { 内容: string; 信息可见性: 剧情编织可见性 }` and `剧情编织场景节点 = { id: string; 标题: string; 地点: string; 参与角色: string[]; 目标: string; 进入条件: string[]; 开场事实: 剧情编织场景事实[]; 完成证据: string[]; 完成后事实: 剧情编织场景事实[]; 可偏离切口: string[] }`. Add `剧情编织分段.场景节点?: 剧情编织场景节点[]`; add `剧情编织进度锚点.当前场景ID?: string`, `已完成场景ID?: string[]`, `最近场景推进回合?: number`. Export `advanceStorySceneProgress(input: { segment: 剧情编织分段; anchor: 剧情编织进度锚点; userInput: string; body: string; turnCount: number }): 剧情编织进度锚点`, returning unchanged anchor when evidence is weak or contradictory.

- [ ] **Step 1: Write failing tests.** Normalize legacy anchors and unknown scene IDs; explicit result advances exactly one node; mention-only/negated result does not; a completed/skipped/deviated segment is not reopened; same turn does not advance twice.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storySceneModel.test.ts tests/unit/storySceneProgress.test.ts`; expect missing fields/function failure.
- [ ] **Step 3: Add normalization and a pure transition** in `storySceneProgress.ts`, then call it from `autoAlignCanonStoryProgress` only while the current segment remains active; reset scene cursor when the existing segment transition changes segment ID.
- [ ] **Step 4: Run** focused tests plus `pnpm exec vitest run tests/unit/storyWeavingConflict.test.ts tests/unit/canonDeviationService.test.ts`; expect pass.
- [ ] **Step 5: Commit** `feat: track evidence-backed mainline scenes`.

### Task 4: Bounded, Knowledge-Safe Scene Injection

**Files:** Modify `services/storyWeaving.ts`; create `tests/unit/storySceneInjection.test.ts`.

**Interfaces:** `buildStoryWeavingInjection(system, ctx)` continues returning `string`; strong gate includes only active scene, its known facts and next-scene preview; soft gate excludes current objective/result spoilers. Existing segment-only/custom series retain current behavior.

- [ ] **Step 1: Write failing tests.** Assert no reader-only NPC knowledge, no uncompleted result as established fact, IF/skipped status visible, no next-next scene, and bounded text length despite 20 mock scenes with large prose.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storySceneInjection.test.ts`; expect missing scene-window behavior.
- [ ] **Step 3: Implement scene window** with explicit per-field length/count caps; do not concatenate `原文内容` or every scene into the prompt.
- [ ] **Step 4: Run** focused test and `pnpm test:prompt-context`; expect pass.
- [ ] **Step 5: Commit** `feat: inject only active canon scene window`.

### Task 5: Expand Six Nations in Stable Series

**Files:** Modify the 15 in-scope `public/data/story-weaving-canon/story_canon_teyvat_*.json` files; create `tests/unit/storyCanonScenes.test.ts`.

**Interfaces:** Every current segment gets ordered, stable scene nodes; existing IDs and group numbers never change. Each node has an interactive goal, explicit result evidence, fact timing, visibility and plausible divergence handling. Review one nation at a time; use project baseline plus verified primary lore sources for factual details.

- [ ] **Step 1: Write failing parameterized tests.** For each of six nations assert all existing segments contain 2–5 distinct nodes or an explicitly justified shorter Mondstadt segment, unique stable IDs, nonempty goal/evidence/divergence, and no unresolved `{{...}}` template text. Snapshot the pre-edit series/segment IDs and group numbers in test fixtures.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storyCanonScenes.test.ts`; expect missing nodes.
- [ ] **Step 3: Expand Mondstadt, then Liyue, Inazuma, Sumeru, Fontaine, Natlan** in six reviewable commits. After each nation run Task 1 contract test and the parameterized cases for that nation; retain concise `本段概括` rather than copying detailed nodes into it.
- [ ] **Step 4: Run** all story-scene tests and `pnpm test:story-weaving`; expect pass and no changed legacy IDs.
- [ ] **Step 5: Commit** any final cross-nation corrections as `test: verify six-nation scene continuity`.

### Task 6: End-to-End Regression and Release Gate

**Files:** Modify tests only if a real uncovered boundary is found; no product behavior added here.

**Interfaces:** The complete batch passes old-save hydration, divergent-route, prompt-budget, resource validity and six-nation content checks.

- [ ] **Step 1: Write a failing integration regression if one boundary from Review Focus remains untested** (especially legacy save + new resource + IF route in one flow).
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/storyCanonResourceContract.test.ts tests/unit/storyWeavingPresetMerge.test.ts tests/unit/storySceneModel.test.ts tests/unit/storySceneProgress.test.ts tests/unit/storySceneInjection.test.ts tests/unit/storyCanonScenes.test.ts`; expect pass after fixes.
- [ ] **Step 3: Run** `pnpm exec vitest run`, `pnpm exec tsc -b`, `pnpm exec eslint . --quiet`, `pnpm build`, and `pnpm test:story-weaving`; expect exit code 0. Record any pre-existing build warnings separately.
- [ ] **Step 4: Commit** only any test/fix changes that Step 3 required; report verified scope and remaining fourth-batch Dou Dizhu work without claiming it is implemented.
