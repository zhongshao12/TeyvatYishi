# Built-in Content Resource Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate bundled opening, worldbook, and codex resource identities and surface loader failures with an ID, phase, and recovery action.

**Completion record (2026-09-27):** All three tasks below were implemented on `codex/prompt-delivery`. Final verification: 191 test files / 1096 tests passed; TypeScript, production Vite build, and repository ESLint (`--quiet`) passed. The checklist remains the original execution plan for traceability.

**Architecture:** Generate a metadata-only registry from existing source-controlled definitions; never duplicate content bodies or include user-created books. Validate uniqueness, versions, references, and packaged codex files in a build gate. Use a small in-memory status store for runtime loading; loader errors preserve existing local data and point players to the content diagnostic view.

**Tech Stack:** TypeScript, Vite/Vitest, React, existing bundled content loaders.

---

## File map

- `data/contentResourceRegistry.ts`: metadata registry and pure validation; no persisted data or duplicate story text.
- `tests/unit/contentResourceRegistry.test.ts`: duplicate ID, bad reference/version, and actual bundled file checks.
- `package.json`: run registry test in the canonical production build script before Vite packaging.
- `services/contentResourceStatus.ts`: bounded in-memory load-state store and typed resource errors.
- `data/codexPreset.ts`, `data/openingWorldbookPreset.ts`, `hooks/useGameState.ts`: record source ID/stage and report failures without wiping saved content.
- `components/features/Settings/storage/ContentResourceStatusPanel.tsx`, `components/features/Settings/StorageManager.tsx`: inspect runtime status and recovery instruction.
- `tests/unit/contentResourceStatus.test.ts`, existing codex loader tests: no silent empty-result regressions.

## Task 1: Metadata registry and build gate

- [ ] **Write failing tests:** `validateContentResources` must report duplicate IDs, missing referenced scenario IDs, invalid `contentVersion`, and absent codex JSON paths. Run against the real registry and expect zero issues and all six codex files present.
- [ ] **Run red:** `node node_modules/vitest/vitest.mjs run tests/unit/contentResourceRegistry.test.ts`.
- [ ] **Implement:** generate namespaced resource IDs `opening:*`, `scenario:*`, `worldbook:*`, `worldbook-entry:<book>:<entry>`, and `codex:*` from existing definitions. Record `{id, kind, version, source, references?, path?}` only. The validator accepts a file-existence callback so browser code does not import Node `fs`. Keep worldbook entry `contentVersion` as the existing update authority.
- [ ] **Run green:** targeted test; update `build` script to run this test between `tsc -b` and `vite build`; verify `pnpm build` or equivalent direct commands. Commit Task 1 files.

## Task 2: Runtime load statuses and actionable failure

- [ ] **Write failing tests:** a failed codex HTTP load should produce an error containing `codex:<preset ID>` and `fetch` stage, and must not return an empty “success”; malformed JSON should indicate `parse` stage. A successful load records `ready`. Test store subscription and bounded status count.
- [ ] **Run red:** targeted Vitest.
- [ ] **Implement:** `ContentResourceError` carries `resourceId`, `stage`, and a recovery instruction; `markResourceLoading/Ready/Failed` update an in-memory map. Wrap bundled codex fetch, JSON parsing, and normalization, keeping existing fallback in `useGameState`. Show a persistent error toast with ID/stage and advise opening 设置→存档管理→内容资源诊断. Apply the same typed error to any configured bundled worldbook fetch. Source-defined opening/worldbooks are registered as ready at bootstrap after creation; if creation throws, retain saved content and report the resource source.
- [ ] **Run green:** loader/status tests, TypeScript. Commit Task 2 files.

## Task 3: Inspectable diagnostics and final verification

- [ ] **Write failing UI test:** the resource status panel shows a failed resource's ID, phase, and recovery hint; successful resources show ready; no error payload or private prompt text is rendered.
- [ ] **Run red:** targeted Vitest.
- [ ] **Implement:** use `useSyncExternalStore` with the bounded status store in a small panel below storage analysis. Include a `重新加载页面` suggestion, not an automatic destructive reset. Keep user-created worldbooks out of the registry.
- [ ] **Run green:** targeted tests, full Vitest suite, TypeScript, Lint, and canonical production build. Commit Task 3 files.

## Self-review and handoff

The registry only records stable IDs and source paths; the existing worldbook `contentVersion` decides content refresh, and the loader never overwrites user books on an error. No code-splitting is added without measured benefit, so offline desktop packaging remains unchanged. The user selected inline execution for this sequence; preserve the unrelated phone-reply edits.
