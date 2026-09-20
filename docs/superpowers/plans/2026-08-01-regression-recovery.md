# Regression Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the project and failure-analysis documents, remove false-positive regression failures, fix real data defects, and restore a trustworthy full-regression signal.

**Architecture:** Keep the existing regression-script model, but separate runner diagnostics, runtime compatibility, source-contract maintenance, repository fixtures, and real data validation. Each failing item is reproduced before its smallest fix; documentation is updated only from verified results.

**Tech Stack:** Node.js 22+ CI runtime, Node.js `.mjs` regression scripts, TypeScript 5.8, Vitest 3, React 19, Vite 6.

## Global Constraints

- Do not claim the historical `126/150` result is current without a fresh complete run.
- Do not classify a compound assertion by its message alone; identify the exact failed conjunct.
- Prefer observable behavior and data contracts over exact source-text spellings.
- `docs/` is ignored, so CI tests must not require local-only planning files.
- Do not modify unrelated application behavior to satisfy stale assertions.
- The current workspace is a source snapshot without usable Git metadata; no branch or commit steps are possible.

---

### Task 1: Regression runner diagnostics

**Files:**
- Create: `scripts/lib/regressionRunner.mjs`
- Create: `scripts/regression-runner-diagnostics-regression.mjs`
- Modify: `scripts/run-all-regressions.mjs`

**Interfaces:**
- Produces: `formatRegressionFailure(result)` and `runRegressionScript(nodePath, scriptPath)`.
- Consumes: `spawnSync` results including `error`, `status`, `signal`, `stdout`, and `stderr`.

- [ ] Write a failing regression that requires spawn errors and signals to appear in formatted diagnostics.
- [ ] Run `node scripts/regression-runner-diagnostics-regression.mjs` and confirm the missing module/API failure.
- [ ] Implement the runner helper and route the aggregate runner through it.
- [ ] Re-run the diagnostic regression and confirm it passes.

### Task 2: Reproduce and repair B-class false positives

**Files:**
- Modify: the ten B-class scripts listed in `测试失败分析文档.md`.
- Read: the corresponding production files for Claude config, chat rendering, Zhiku parsing/opening context, queue retry wiring, Gemini URL normalization, mobile layout, preset filtering, preset data, and retired categories.

**Interfaces:**
- Tests consume current public behavior or stable contract markers, not obsolete local variable names, extracted helper locations, timestamps, or exact Tailwind class strings.

- [ ] Run each B-class script separately and record its first failing assertion.
- [ ] Replace only the failing change-detector assertion with a stable behavior/data-contract check.
- [ ] Re-run each script after its change and confirm it passes before moving to the next item.

### Task 3: Runtime compatibility and test environment

**Files:**
- Modify: A-class regression scripts only where Node runtime capability is the actual failure.
- Modify: `package.json` and documentation if Node 22 is the enforced full-regression floor.

**Interfaces:**
- Full regressions run under Node 22+ in CI.
- Browser-only globals used by Node tests are explicitly supplied by the test harness or avoided by the exercised path.

- [ ] Run A-class scripts under the bundled modern Node runtime.
- [ ] Distinguish native TypeScript import failures from missing browser globals.
- [ ] Add the smallest test-only compatibility setup or enforce the documented runtime floor.
- [ ] Re-run every A-class script under the supported runtime.

### Task 4: Repository fixture and Zhiku data defects

**Files:**
- Modify: `scripts/zhiku-archive-browser-regression.mjs`.
- Modify: `scripts/zhiku-story-reader-regression.mjs`.
- Modify: `public/zhiku-presets/amphoreus-character-rebuild.json`.
- Keep mirrored distributable data synchronized where required.

**Interfaces:**
- CI tests do not read ignored local plans.
- Official-language audit rejects developer-facing phrases.
- Static injection fields remain traceable to curated archive fields.

- [ ] Reproduce C1-C4 independently.
- [ ] Remove C1/C2 dependence on ignored `docs/` content while preserving production UI/contract checks.
- [ ] Remove the C3 developer-language residue.
- [ ] Align the C4 injection field with its archive source.
- [ ] Re-run C1-C4 and the broader Zhiku data-contract regressions.

### Task 5: Documentation correction

**Files:**
- Modify: `项目文档.md`.
- Replace: `测试失败分析文档.md` with evidence-based current results.

**Interfaces:**
- Documents report the exact verified runtime, commands, pass/fail counts, remaining failures, and limitations.

- [ ] Correct the Tauri version and separate application/runtime requirements from regression requirements.
- [ ] Remove unsupported claims that every failure predates v1.3.
- [ ] Reclassify failures into runtime, false-positive contract, ignored-fixture, and real-data categories.
- [ ] Record final verified results and remaining blockers only after Task 6.

### Task 6: Completion verification

**Files:**
- Verify all modified files and generated mirrors.

**Interfaces:**
- Produces fresh build, unit-test, targeted-regression, and full-regression evidence.

- [ ] Run all targeted repaired scripts.
- [ ] Run `pnpm test:unit` or invoke the installed Vitest binary directly with the supported Node runtime.
- [ ] Run `pnpm build` or the equivalent installed TypeScript/Vite commands.
- [ ] Run `pnpm test:all` with the supported Node runtime and inspect the complete summary.
- [ ] Update both documents with the final observed numbers, then re-run documentation/data audits affected by those edits.
