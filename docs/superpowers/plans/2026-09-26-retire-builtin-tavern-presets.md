# Retire Built-in Tavern Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all bundled Tavern presets while preserving imported presets and native game prompt rules.

**Architecture:** A small compatibility normalizer rejects the four retired IDs when global settings initialize or update. The Tavern settings page and message assembly use only user-imported entries; bundled JSON files and their legacy regression expectations are retired.

**Tech Stack:** React, TypeScript, Vitest, pnpm, Vite.

**Spec:** `docs/superpowers/specs/2026-09-26-tavern-presets-and-new-game-isolation-design.md`

## Global Constraints

- Remove only built-in Tavern presets: `builtin_preset`, `builtin_shuangrenchenghang_v2`, `builtin_izumi_v2`, `builtin_sanrennixing_v2`.
- Preserve imported Tavern presets, native prompt modules, opening presets, worldbooks, codex and canonical story resources.
- Do not change the Tavern enable switch or introduce the lottery system.
- Preserve the pre-existing uncommitted courier-reply changes in `App.tsx`, `hooks/useGame/courierReplyQueue.ts` and `tests/unit/courierReplyQueue.test.ts`.

## Review Focus

- A saved setting points to any retired V1/V2 ID: it becomes no selection, with no resource fetch (Task 1 test).
- A user-imported preset has the same display name as a retired built-in: it remains visible and selectable (Task 2 test).
- An empty imported-preset list: the settings UI shows an empty state, not a phantom native preset (Task 2 test).
- A valid imported V2 preset is selected: its message chain still reaches the API prompt (Task 2 test).
- Retired JSON files are absent: prompt regression gates validate their absence instead of trying to load them (Task 3 test).

---

### Task 1: Normalize retired selections

**Files:**
- Create: `utils/retiredTavernPresets.ts`
- Modify: `hooks/useGameState.ts`, `models/settings.ts`
- Test: `tests/unit/retiredTavernPresets.test.ts`

**Interfaces:**
- Produces: `normalizeRetiredTavernSelection<T extends Pick<游戏设置, 'currentStPresetId' | 'currentStPresetIdV2'>>(settings: T): T`, returning a copy with retired IDs replaced by `null`.
- Consumes: the four retired IDs above; does not mutate `stPresets` or `stPresetsV2`.

- [ ] **Step 1: Write failing tests** for each retired ID, a valid imported ID, absent IDs and retained preset arrays. Expected retired selection is `null`; user arrays retain identity/content.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/retiredTavernPresets.test.ts`; confirm failure is the missing normalization behavior.
- [ ] **Step 3: Implement** the function in `utils/retiredTavernPresets.ts`, then apply it to default settings and the `useGameState` global-settings setter/hydration. Save loading does not own Tavern settings. Keep native prompt modules unchanged.
- [ ] **Step 4: Re-run** `pnpm exec vitest run tests/unit/retiredTavernPresets.test.ts tests/unit/tavernImportedPresetSave.test.ts`; both must pass.
- [ ] **Step 5: Commit** only Task 1 files with `fix: clear retired Tavern preset selections`.

### Task 2: Remove bundled presets from UI and runtime

**Files:**
- Modify: `components/features/Settings/PromptModulesTab.tsx`, `hooks/useGame/contextSnapshot.ts`, `hooks/useGame/mainPromptAssembly.ts`, `hooks/useGame/apiMessagesStage.ts`
- Test: replace `tests/unit/builtinPresetSelectiveLoading.test.ts` with `tests/unit/importedTavernPresetSelection.test.ts`; retain `tests/unit/tavernImportedPresetSave.test.ts`.

**Interfaces:**
- Consumes: normalized settings from Task 1.
- Produces: Tavern selection lists containing only imported `stPresetsV2`; `getCurrentSTPresetV2(settings)` receives no extra built-ins.

- [ ] **Step 1: Add failing `importedTavernPresetSelection` behavior tests**: retired IDs are unavailable; an imported entry named `双人成行v10.0—青云上` remains selectable; empty imports show no preset; absent selection adds no Tavern message while a selected import does. Retire the old selective-loading test when these pass.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/importedTavernPresetSelection.test.ts`; confirm expected failures.
- [ ] **Step 3: Remove** built-in fetch/cache/registry use from settings, context snapshot, main prompt assembly and API message stage. Keep imported-preset editing/saving and native prompt modules. Update empty-list UI text to guide import.
- [ ] **Step 4: Re-run** `pnpm exec vitest run tests/unit/importedTavernPresetSelection.test.ts tests/unit/tavernImportedPresetSave.test.ts tests/unit/teyvatPromptContract.test.ts`; all must pass.
- [ ] **Step 5: Commit** only Task 2 files with `refactor: use imported Tavern presets only`.

### Task 3: Retire assets and obsolete audit expectations

**Files:**
- Delete: `public/data/builtin-presets/builtin_shuangrenchenghang_v2.json`, `public/data/builtin-presets/builtin_izumi_v2.json`, `public/data/builtin-presets/builtin_sanrennixing_v2.json`, `data/builtinPresets/builtinPreset.ts`, `data/builtinPresets/index.ts` after imports are gone.
- Modify: `scripts/st-preset-integration-regression.mjs`, `scripts/lib/regressionManifest.mjs` to replace obsolete positive checks with retirement checks.
- Delete: `scripts/builtin-presets-v2-regression.mjs`, `scripts/builtin-tavern-v2-message-chain-regression.mjs`, `scripts/builtin-tavern-preset-surface-audit.mjs`, `scripts/builtin-shuangrenchenghang-format-guard-regression.mjs` after removing their manifest/runner entries.
- Test: `tests/unit/retiredTavernPresets.test.ts` and the script regression runner.

**Interfaces:**
- Consumes: Task 2 removes production references before asset deletion.
- Produces: no retired resource path or ID remains in runtime lists.

- [ ] **Step 1: Add a failing build-artifact assertion** to `scripts/st-preset-integration-regression.mjs`: after `pnpm build`, no JSON exists under `dist/data/builtin-presets`; retain imported-ST behavior checks.
- [ ] **Step 2: Run** `pnpm build` then `node scripts/st-preset-integration-regression.mjs`; confirm failure because the three JSON files still exist.
- [ ] **Step 3: Remove** the five retired source/resource files (exact paths above) and four obsolete audit scripts; remove those script names from `scripts/st-preset-integration-regression.mjs` and `scripts/lib/regressionManifest.mjs`, preserving imported-ST coverage.
- [ ] **Step 4: Run** `node scripts/st-preset-integration-regression.mjs`, `pnpm test:unit`, `pnpm build`, and `pnpm test:all`; report any existing unrelated failures by name.
- [ ] **Step 5: Commit** only Task 3 files with `chore: remove bundled Tavern preset assets`.
