# Testing, Build & Developer-Tooling Audit — `KaiTuoYiShi-main/yuanshen`

**Scope:** testing, build configuration, CI/CD, and developer tooling **only**. Read-only static analysis: no `node`, `pnpm`, `tsc`, `vitest`, `git`, or `cargo` process was spawned (the sandbox blocks child-process creation). Every claim below cites a file path, and line numbers where the file was actually opened. Where I could not determine something from files alone, I say so explicitly.

Scale reference: ~342–403 TS/TSX modules depending on what you count, ~106.6k source lines, 89 components, `App.tsx` alone at 1,529 lines.

---

## 0. Corrections to the brief's premises

Three items in the task brief turned out to be wrong on inspection. I flag them first because two of them change the recommendations.

| Brief said | Reality | Evidence |
|---|---|---|
| "~57 individual `test:*` regression scripts" | **176** `*-regression.mjs` files exist and **all 176 + 3 manifest extras = 179 run** under `test:all`. `package.json` only names **75** of them; **101 are reachable *only* through `test:all`.** | 176 measured via `Get-ChildItem scripts -File -Filter '*-regression.mjs'`; aggregation logic at `scripts/run-all-regressions.mjs:6-8`; 75 counted by matching each filename against `package.json` |
| "`tsconfig.tsbuildinfo` committed in root" | **Not tracked.** `.gitignore:8` has `*.tsbuildinfo`. The file exists on disk but is correctly ignored. | Probed `.git/index` for the literal path → no match |
| "stray directories `.tmp-*` … check whether junk" | **Correctly ignored and correctly excluded from typecheck.** `.gitignore:10` has `.tmp-*/` and `tsconfig.json:19` excludes `.tmp-*`. They are build residue, not committed junk. | `.gitignore:10`, `tsconfig.json:19`, `.git/index` probe → no match for any `.tmp-*` path |

So the hygiene situation in the root is **better than it looks**. The real hygiene problem is elsewhere (§7).

---

## 1. The regression-script architecture — the headline question

### 1.1 What actually runs

`scripts/run-all-regressions.mjs` is 22 lines and does not contain a test list. It **scans the directory**:

```js
// scripts/run-all-regressions.mjs:6-8
const scanned = fs.readdirSync('scripts').filter((f) => f.endsWith('-regression.mjs'));
// 显式清单：补收不符合命名规则但必须执行的测试入口。
const all = Array.from(new Set([...EXTRA_REGRESSION_SCRIPTS, ...scanned])).sort();
```

The three exceptions live in `scripts/lib/regressionManifest.mjs:2-6`: `npc-ledger-variable-facts-behavior.mjs`, `teyvat-runtime-language-audit.mjs`, `validate-story-weaving-canon.mjs`.

Execution is one-at-a-time via `spawnSync` with a 10-minute timeout (`scripts/lib/regressionRunner.mjs:23-28`), each in a **fresh Node process**. There is no parallelism, no shared setup, no isolation guarantee beyond "new process". Total suite: **11,926 lines across 176 files.**

### 1.2 How a `.mjs` imports `.ts` on Node 22 — four distinct mechanisms

This is genuinely clever engineering and deserves credit. There is no build step, no bundler config, no ts-node. Four separate hand-rolled interop strategies coexist:

**(a) `typescript` compiler API → temp dir → rewrite aliases → dynamic import (10 scripts).** `story-weaving-regression.mjs` is the archetype:

```js
// scripts/story-weaving-regression.mjs:30-52
function transpileModule(sourcePath) {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
  const sourceDir = path.posix.dirname(sourcePath.replaceAll('\\', '/'));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, ... } }).outputText
    .replace(/@\/(compat|data|models|services|prompts|utils|hooks)\//g, (_match, folder) => { ... })
    .replace(/from\s+['"]((?:\.\/|\.\.\/)[^'"]+)['"]/g, (match, specifier) =>
      specifier.endsWith('.mjs') ? match : `from '${specifier}.mjs'`);
  const outputPath = path.join(tempDir, sourcePath.replace(/\.ts$/, '.mjs'));
  ...
}
```

It transpiles **22 real source files** (`:140-165`), writes **20 hand-authored stubs** for heavy dependencies (`:166-187`, e.g. `chatCompletionClient`, `variableFacts`, `canonicalCharacters`), then dynamically imports the results (`:189-195`) and calls real functions.

**(b) esbuild bundle → `data:` URL import (the cleverest one).** `long-session-oom-regression.mjs`:

```js
// scripts/long-session-oom-regression.mjs:5-17
async function loadBundledModule(entryPoint) {
  const bundled = await build({
    entryPoints: [entryPoint], bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
  });
  const source = bundled.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
```

This avoids a temp file entirely. Used for `utils/longSessionRetention.ts`, `utils/saveDeltaStorage.ts`, `utils/saveImageCompactor.ts`, `models/teyvat/state.ts` (`:19-22`).

**(c) esbuild → temp file → `pathToFileURL` (majority of the esbuild users).** `npc-ledger-variable-facts-behavior.mjs:38-79` bundles `utils/variableFacts.ts` and `models/npc.ts` into `os.tmpdir()` with a custom `@/` alias resolver plugin (`:16-36`), then imports them.

**(c′) esbuild `transform` on a *sliced-out fragment* of a source file** — a fifth variant, and the most fragile. `save-catalog-behavior-regression.mjs` cuts one function out of a 1,975-line persistence module by string offsets, rewrites its declaration to `export`, and runs it:

```js
// scripts/save-catalog-behavior-regression.mjs (read in full)
const dbServiceSource = fs.readFileSync('services/dbService.ts', 'utf8');
const summarizeStart = dbServiceSource.indexOf('function summarizeSave');
const summarizeEnd = dbServiceSource.indexOf('function estimateSaveSize');
const summarizeModuleSource = dbServiceSource
  .slice(summarizeStart, summarizeEnd)
  .replace('function summarizeSave', 'export function summarizeSave');
const summarizeModule = await transform(summarizeModuleSource, { loader: 'ts', format: 'esm' });
const { summarizeSave } = await import(`data:text/javascript;base64,${Buffer.from(summarizeModule.code).toString('base64')}`);
```

Note what this does **not** do: it tests `summarizeSave` in isolation and **never touches `indexedDB`**. The regression has "dbService" in its name while providing no coverage of the persistence path that makes `dbService` risky (§2.3). It also breaks silently if either function is renamed, because `indexOf` returns `-1` and the slice becomes garbage.

**(d) Direct `.ts` import, relying on Node's built-in type stripping (12 scripts).** These have no transform step at all — just `import { ... } from '../services/storage/saveCatalog.ts'`. Full list: `background-stream`, `cloud-backup-merge`, `cloud-backup-package`, `github-request`, `memory-compression-threshold`, `novelai-prompt-compiler`, `save-catalog-behavior`, `save-retention-behavior`, `story-snapshot-pipeline`, `teyvat-migration-failure-drill`, `teyvat-six-opening-smoke`, `zhiku-character-display-name`.

**This is an undeclared runtime requirement and a real fragility.** Type stripping by default landed in Node **22.18.0**; on Node 22.6–22.17 it required `--experimental-strip-types`. There is **no `engines` field** in `package.json` and **no `.nvmrc`/`tool-versions`**, while `.github/workflows/ci.yml:17` pins `node-version: 22` — a *floating* major that resolves to the latest 22.x. So CI works today purely because `setup-node` fetches ≥22.18. I verified the good news: **all 20 `.ts` targets of mechanism (d) are free of non-erasable syntax** (no `enum`, no `namespace`, no constructor parameter properties, no decorators), so stripping succeeds.

### 1.3 Do they use a real assertion library?

**Mostly no — but 43 of them do, and that number matters.**

| Mechanism | Files |
|---|---|
| Hand-rolled `function assert(condition, message) { if (!condition) throw new Error(message); }` | **111** |
| `import assert from 'node:assert/strict'` (a real assertion library) | **43** |
| Inline `if (!x) throw new Error(...)` with no helper | 23 |
| `import ... from 'vitest'` | **0** |
| `expect(` / `toContain` anywhere in `scripts/` | **0** |

Total hand-rolled failure sites: **132 `throw new Error`**, versus **3,914 `assert(` call sites** across the suite.

### 1.4 Are they behavioural tests or source-text greps? — **definitive, counted answer**

This is the question the brief called most important, so I measured it two independent ways.

**File-level taxonomy (176 scripts):**

| Category | Count | Share |
|---|---|---|
| **Text-grep only** — `readFileSync` + `.includes()`, never executes a project module | **120** | **68.2%** |
| **Behavioural only** — bundles/transpiles and calls real exports, does not grep source | **24** | 13.6% |
| **Hybrid** — genuinely executes modules *and* greps source text | **15** | 8.5% |
| **Neither** — subprocess/file-existence/JSON-data-contract checks | 17 | 9.7% |

**Assertion-level measurement.** I traced every variable bound to `readFileSync(...)` (and `JSON.parse(readFileSync(...))`) per file, then counted every `assert(` whose argument is a containment/regex test **on one of those source-text variables**. This deliberately excludes `array.includes(x)` on *computed output*, which is a behavioural assertion:

| Metric | Value |
|---|---|
| Total `assert(` call sites | **3,914** |
| Assertions made directly against source-file text | **2,404** |
| **Fraction of all assertions that are source-text greps** | **61.4%** |
| Scripts where ≥80% of assertions are source-text greps | **98 / 176 (55.7%)** |
| Scripts with **zero** text-grep assertions | 61 / 176 |
| Total `.includes(` occurrences across the suite | **3,990** |

**Verdict: the suite is predominantly source-text pattern matching on its own source files.** Roughly **two-thirds of the scripts (120/176) and three-fifths of the assertions (61.4%) are greps.** A naive count of `.includes(` versus `throw new Error` (3,990 vs 132) overstates it further, so 61.4% is the *conservative, defensible* figure.

### 1.5 What the greps actually assert — and why it is not worthless

Three real scripts demonstrate the best and worst of it.

**Worst case — `chat-scroll-smoothness-regression.mjs` (39 lines, 100% grep).** It reads three `.tsx` files and slices out function bodies by string markers, then asserts on literal source text:

```js
// scripts/chat-scroll-smoothness-regression.mjs:8-18
const scrollHandlerStart = chatList.indexOf('const handleScroll = useCallback');
const scrollHandlerEnd = chatList.indexOf('const scrollToBottom', scrollHandlerStart);
const scrollHandler = chatList.slice(scrollHandlerStart, scrollHandlerEnd);
...
assert(chatList.includes('const scrollStateRafRef = useRef<number | null>(null)'), 'scroll-state work must use a dedicated animation-frame queue');
assert(scrollHandler.includes('if (scrollStateRafRef.current != null) return'), 'repeated scroll events in one frame must be coalesced');
assert(!scrollHandler.includes('setNearBottom(isNearBottom())'), 'raw scroll events must not update React state directly');
```

This test **cannot fail for a logic reason**. It fails only if someone edits the exact identifier names. It asserts that a *specific implementation* is present, not that scrolling is smooth. Notably it is in the `test:*` list (`package.json:53`) so it runs in `test:all` **and** CI.

**Also grep-only — `save-isolation-regression.mjs` (50 lines, 31 assertions, 0 imports of project code).** Every assertion reads source text. But some encode genuine architectural invariants that would be *hard* to test behaviourally:

```js
// scripts/save-isolation-regression.mjs:32-34
assert((saveLoadSource.match(/dependencies\.replaceGameState\(nextGame\)/g) ?? []).length === 1, '成功读档必须且只能提交一次完整 nextGame。');
assert(saveLoadSource.indexOf('const nextGame = normalizeTeyvatGameState(classified.state)') < saveLoadSource.indexOf('dependencies.replaceGameState(nextGame)'), '读档必须在唯一提交前完成完整归一化。');
assert(saveLoadSource.indexOf('await dependencies.beforeReplace?.(nextGame)') < saveLoadSource.indexOf('dependencies.replaceGameState(nextGame)'), '所有可拒绝清理必须发生在唯一 replace 前。');
```

Assertion #32 is an **exactly-once** invariant; #33 and #34 are **ordering** invariants. These are crude but they genuinely would catch a regression where someone adds a second commit path or moves normalization after the commit. This is a *fitness function*, not a test — low fidelity, non-zero value.

**Best case — `long-session-oom-regression.mjs` (242 lines, genuinely behavioural).** It bundles four real modules via `data:` URLs and exercises them against 170-turn and 500-turn synthetic chat histories with 4 KB debug strings:

```js
// scripts/long-session-oom-regression.mjs:91-102
assert.equal(assistants.filter((message) => message.debugContext).length, DETAILED_CHAT_TURNS);
assert.equal(compacted[1].parsedResponse.body[0].text, '正文-1');
assert.equal(compacted[1].narrativeImages[0].dataUrl, 'asset:image-1');
assert.deepEqual(compacted[1].parsedResponse.factCandidates, []);
assert.equal('thinking' in compacted[1].parsedResponse, false);
```

It also verifies **idempotency** (`:149`), delta-save round-tripping including `assert.deepEqual(restored.背包, currentSave.背包)` and a `notDeepEqual` against the stale base (`:196-210`), and image de-duplication via `WeakMap` (`:224-229`). Only its final 6 assertions (`:231-240`) are greps. **This is a real test that would catch a real OOM/data-loss bug.**

**Best case #2 — `npc-ledger-variable-facts-behavior.mjs` (258 lines, pure behavioural).** Feeds real `<变量事实>` payloads through the real parser and asserts on the *derived command keys*:

```js
// scripts/npc-ledger-variable-facts-behavior.mjs:110-113, 136-149
const parsed = parseVariableFacts(rawText);
assert(parsed.parseErrors.length === 0, `变量事实不应解析失败：${parsed.parseErrors.join('；')}`);
assert(parsed.facts.length === 2, '应该解析出两条 NPC 事实。');
...
for (const key of ['NPC.[id=npc_march7th].relationshipLedger.recentInteraction', ...]) {
  assert(keys.includes(key), `缺少 NPC 账本命令：${key}`);
}
```

Plus a negative assertion that light-weight memories must **not** silently mutate affinity: `assert(!lightKeys.some((key) => key.endsWith('.affinity') ...))` (`:203`). This is a proper unit test.

**`story-weaving-regression.mjs` (1,069+ lines) is the hybrid par excellence** — roughly 45 real behavioural assertions on `autoAlignCanonStoryProgress` (cross-segment jump thresholds, archived-anchor self-healing, consecutive-evidence accumulation at `:648-659`) interleaved with ~30 source greps (`:516-553`, `:1034-1051`).

### 1.6 Honest verdict on the regression architecture

**Better than "greps on source" implies, but not a safety net for behaviour.**

What it genuinely gives you:
- **29 scripts that actually execute project code** without a build step — mechanism (b)'s `data:`-URL trick is a legitimate, cheap harness.
- **Real asset-integrity verification.** `scripts/teyvat-avatar-audit.mjs` uses `sharp` to open every avatar and assert **256×256 / WebP / ≤100 KB** against a 120-character roster with expected 5★/4★ counts, exiting non-zero on any miss (`:36-42`, `:56-60`). That is a true integration test.
- **Real long-session, save-round-trip, and variable-fact coverage** in the handful of behavioural scripts.
- **Exactly-once and ordering invariants** that are awkward to express behaviourally.

What it does not give you:
- 120 of 176 scripts are inert with respect to runtime behaviour. **56% of scripts are ≥80% greps.** A logic bug that preserves identifier names passes silently.
- The suite **cannot catch a regression in any of the 242 modules no test touches** unless the regression happens to be a renamed literal.
- Grep tests are **anti-refactor**: renaming `scrollStateRafRef` fails a "smoothness" test. This is a real tax on the 429-`useState` component layer.
- It creates a **false sense of coverage**: 179 green scripts in CI reads as "heavily tested", while `coverage.include` measures 3 files (§2).

---

## 2. Coverage reality

### 2.1 The coverage config actively hides coverage

```ts
// vitest.config.ts:9-17
coverage: {
  provider: 'v8',
  include: [
    'utils/imageTaskQueue.ts',
    'services/storyWeavingConflict.ts',
    'utils/workflowRecoveryModel.ts',
  ],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
},
```

`include` is an **allow-list**, so `--coverage` reports on exactly three files. Those three total **471 lines = 0.44% of the source tree.** The thresholds are real, but they gate 0.44% of the code.

The more damaging consequence: **`tests/` contains 32 `*.test.ts` files / 6,171 lines / 292 `it(` cases — and 29 of those test files measure nothing.** `teyvatRuntimeReducer.test.ts` (514 lines), `teyvatExtensionSystems.test.ts` (646), `teyvatTurnTransaction.test.ts` (347), `teyvatSaveContract.test.ts` (383), `questService.test.ts` (302), `teyvatInventory.test.ts` (315) and `teyvatPromptContract.test.ts` (253) all run in CI but are invisible to the coverage gate. **Real, working tests are being hidden by the config.** Removing the `include` allow-list is a one-line change with immediate value.

### 2.2 The untested surface

The real source tree is **342 modules / 106,649 lines** (`services/` 76, `hooks/` 23, `models/` 38, `utils/` 47, `components/` 89, `prompts/` 16, `data/` 35, `compat/` 8, `functions/` 8, `workers/` 1, plus root `App.tsx`). The brief's "~115k lines / ~400 modules" counts tests and stories too. `components/features/` alone is **35,334 lines = 33% of the tree**.

| Metric | Count | Share |
|---|---|---|
| Referenced by the vitest suite in any form (import **or** fs text-read) | 100 | 29.2% |
| **Never referenced by the vitest suite** | **242** | **70.8%** |
| **Value-imported** (module body actually evaluates) | **92** | **26.9%** |
| Type-only imported (never evaluates) | 8 | 2.3% |
| **Lines never referenced by vitest** | **65,833 / 106,649** | **61.7%** |

Widening the lens to include the regression scripts, 272 modules are referenced *somehow* — but for most, the reference is a grep, not execution. So:
- **~56 modules / ~5,041 lines are referenced by nothing at all** (largest: `data/codexIdentityRegistry.ts` 465, `compat/legacy-hsr/models/courier.ts` 320, `data/codexCustomGovernance.ts` 296, `services/ai/openingArchive.ts` 281).
- **But "referenced" is a weak signal.** The defensible headline is: **92 of 342 modules (26.9%) execute code under a real assertion harness; 250 (73.1%) never do.**

Grid, by directory:

| Directory | Files | Lines | Value-imported by vitest | Referenced by `scripts/` |
|---|---:|---:|---:|---:|
| `services/` | 76 | 22,340 | 23 | 72 |
| `hooks/` | 23 | 10,968 | 14 | 19 |
| `models/` | 38 | 9,974 | 22 | 27 |
| `utils/` | 47 | 11,713 | 14 | 40 |
| `components/` | 89 | 40,060 | **9** | 74 |
| `prompts/` | 16 | 278 | 0 | 10 |
| `data/` | 35 | 7,412 | 9 | 16 |
| `compat/` | 8 | 1,822 | 1 | 1 |
| `functions/` | 8 | 488 | 0 | 7 |

Test-suite metadata (verified): **32 `*.test.ts` + 2 JSON fixtures, 6,171 lines, 51 `describe`, 292 `it(`, 1,246 `expect(`, 0 `test(`, 18 `it.each(`, and — credit where due — 0 `.only` / `.skip` / `.todo`, so no test is silently disabled.**

### 2.3 The four named high-risk files

| File | Lines | Exports | Test situation | Risk |
|---|---|---|---|---|
| `services/ai/chatCompletionClient.ts` | **2,509** | 5 | 0 test refs; 11 script refs (greps) | Reads `config.apiKey` and builds `Authorization: Bearer ${config.apiKey}` (`:264`), `headers['x-api-key']` (`:267`), `headers['x-goog-api-key']` (`:272`). For `/api/*` proxy routes it **omits the header and puts the raw key in the POST body** (`buildQianfanProxyBody` `:324-331`, `buildPioneerProxyBody` `:333-340`). 7 unguarded `JSON.parse` of upstream SSE frames (`:1497, 1586, 1861, 1943, 2028, 2100, 2319`). Spans ~8 providers. **Secret-leak + malformed-response risk, zero behavioural coverage.** |
| `services/dbService.ts` | **1,975** | 44 | Referenced **only inside two `vi.mock()` factories** — no export is ever invoked | 19 `indexedDB` references (`indexedDB.open` `:153`), `JSON.parse` of imported save files (`:1548`). Ships an explicitly test-only barrier `afterIndexedDbStaging?: () => void` (`:197-198`) that **the test suite never uses.** **Data-loss risk, and the seam for testing it already exists and is unused.** |
| `hooks/useGame/sendWorkflow.ts` | **3,727** | 7 | Only `tests/unit/postSettlementRecovery.test.ts` (1 `it(`), with `dbService` mocked | `executeSendWorkflow` runs `:1652`→`:3727` — a **~2,075-line single function that is the entire main turn loop**, called from exactly one place (`hooks/useGame.ts:96`). **Single point of failure for every turn; 1 test case.** |
| `utils/variableFacts.ts` | **1,648** | 8 | Best-covered of the four (6 test files import it) | `factsToVariableCommands` (`:1023-1351`, ~329 lines) is exported and **referenced by nothing — dead code.** |

### 2.4 Is there any UI/component test capability? **No.**
There is **no DOM environment and no component testing at all**:

- `@testing-library/*`, `jsdom`, `happy-dom`, `@vitest/browser` are **absent from `package.json`** (devDependencies are exactly 20 entries, `package.json:132-151`).
- `vitest.config.ts:7` sets `environment: 'node'`.
- Zero matches in `tests/` for `render(`, `@testing-library`, `jsdom`, `happy-dom`, `screen.`, `fireEvent`, `document.createElement`, `ReactDOM`.
- **One partial exception:** `tests/unit/teyvatExtensionSystems.test.ts:3,519` uses `renderToStaticMarkup` from `react-dom/server` to string-render `LeftPanel` once. No DOM, no events, no interaction.

So the 89 components / 37,943 lines — the largest single body of source — have **essentially zero automated verification**, including 118 `<button>` elements missing `type=` (§5).

**Also worth flagging:** `fake-indexeddb` **is** installed (`package.json:143`) but is used by **zero test files** — its only consumer is `scripts/teyvat-migration-failure-drill-regression.mjs:8`. The dependency for testing the highest-risk persistence layer is already paid for and unused. Likewise `indexedDB`, `localStorage`, and `sessionStorage` appear **0 times across all of `tests/`** — no test ever touches a storage API.

### 2.5 Two further untested secret-handling surfaces

- **`services/ai/apiErrorReportService.ts` partially defeats its own masking.** It correctly masks keys (`:22-26`, storing only an `apiKeyHint` at `:51`), **but it persists `responseText` verbatim, truncated to 4,000 chars** (`:56`), and that value is the raw upstream error body passed in from `chatCompletionClient.ts:1456-1468`. Whether a provider ever echoes the submitted key inside an error body is precisely what the masked-hint design does not defend against. 0 test refs, 1 script grep.
- **`components/features/Settings/ApiSettings.tsx` (1,500 lines) exports and imports whole API-key bundles** — `handleExportProfile(includeApiKeys)` and `handleImportProfile`, with `JSON.parse(await file.text())` on an untrusted user file (`:647`) feeding `applyApiProfile`, which writes keys into live settings. The only guard on the "export with keys" path is a `window.confirm` (`:626`). 0 test refs; its 14 script hits are all source greps. **No component test is possible today** (§2.4).

---

## 3. Why 90 scripts instead of one test runner

### 3.1 The real reason: the modules are untestable in Node

This is not primarily a tooling-preference problem. It is an **architecture problem** that the scripts work around. The evidence:

- `story-weaving-regression.mjs` must stub **20 dependencies by hand** (`:166-187`) — including `chatCompletionClient`, `variableFacts`, `canonicalCharacters`, `weatherRules`, `worldbook` — before it can import `services/storyWeaving.ts`.
- `hooks/useGame/sendWorkflow.ts` reads `dbService` (IndexedDB) and the DOM transitively. To test one turn you must mock persistence and the DOM. Nobody did; the harness that *does* exist (`afterIndexedDbStaging`) is unused.
- `vitest.config.ts` sets `environment: 'node'`, so anything importing a component or `indexedDB` at module scope **cannot be imported by vitest at all**.

So the 176 scripts are, in effect, **a hand-rolled module-isolation framework** reimplemented 176 times. Mechanism (b) — esbuild to a `data:` URL — is exactly what a bundler-based test runner does, reinvented per-file.

### 3.2 The maintenance cost, quantified

| Cost | Evidence |
|---|---|
| **~2,000 lines of duplicated harness** | 111 files re-declare the same `assert` helper; 4 files re-declare the same `loadBundledModule`; alias-resolution plugins re-implemented per file |
| **No shared setup/teardown discipline** | Each script manages its own temp dirs; `.tmp-regression/` (22 files), `.tmp-story-weaving-regression/` (40 files, 296 KB), `.tmp-story-weaving-persistence-regression/` (3 files, 57 KB) are left behind on disk right now |
| **Serial execution, 10-min timeout each** | `regressionRunner.mjs:27` — 176 sequential process spawns; a cold `pnpm test:all` pays full Node startup 176 times |
| **101 scripts are undiscoverable** | Only reachable by running `test:all`; there is no way to run or debug one by name unless it happens to be one of the 75 in `package.json` |
| **CI-green local-red divergence** | `package.json:30` is `"test": "pnpm test:unit && pnpm test:release && pnpm test:all"` — **no build step.** But `bundle-size-regression.mjs` is auto-included by the `readdirSync` glob and does an unguarded `fs.readdirSync(path.join(dist, 'assets'))` (`:9`). `dist/` **does not exist in this working copy** (verified). So **`pnpm test` fails with ENOENT on a clean checkout, while CI passes** because `ci.yml:20` runs `pnpm build` first. |
| **Undeclared phantom dependency in CI** | 4 scripts import `sharp` from a **hardcoded pnpm store path**: `import sharp from '../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'` (`optimize-teyvat-avatar.mjs:3`, `sync-teyvat-avatar-manifest.mjs:3`, `teyvat-avatar-audit.mjs:3`, `teyvat-avatar-contact-sheet.mjs:3`). **`sharp` is not in `package.json`.** `teyvat-avatar-audit.mjs` is in `test:release` (`package.json:33`) → CI. Any sharp bump or pnpm hoisting change breaks CI with a module-not-found error. |
| **Floating Node major gates 12 scripts** | `.github/workflows/ci.yml:17` `node-version: 22`; no `engines`. §1.2(d). |
| **Forked domain logic in tests** | `story-weaving-regression.mjs:77-137` re-implements `segment()` and `npc()` fixtures with ~40 Chinese field names inline. If the real model changes shape, the fixture silently diverges and the test keeps passing. |

### 3.3 Proposed consolidation — and an honest weighing

**Recommendation: consolidate onto Vitest *projects*, but keep the scripts as the source of truth during migration. Do not attempt a big-bang rewrite.**

The strongest argument for consolidating is **not** aesthetic. It is that the current architecture has *already* produced two silent breakages (the `pnpm test`/`dist` divergence and the undeclared `sharp` path) and makes the 101 unnamed scripts undiscoverable. The second-strongest is that Vitest already solves the isolation problem the scripts keep re-solving: `environment: 'jsdom'` + `vi.mock` + `setupFiles` would let `sendWorkflow` and `dbService` be tested properly, which is the actual gap.

Migration sketch, in value order:

1. **Delete the `coverage.include` allow-list** (`vitest.config.ts:11-15`). Zero-risk, immediate: 29 already-passing test files start contributing real numbers. *Effort: S.*
2. **Add a second Vitest project for behaviour.** Convert the **39 scripts that already execute modules** (24 behavioural + 15 hybrid) to `tests/behaviour/*.test.ts`. They are already 80% of the way there — mechanism (b) becomes a shared `loadModule()` helper in `tests/helpers/bundle.ts`, and the hand-rolled `assert` becomes `expect`. *Effort: M (≈39 files, mechanical).*
3. **Add a third project for the architecture greps.** The 98 grep-dominant scripts are fitness functions; keep them, but delete the 120-line-per-file boilerplate by exporting one `assertSourceContains(file, needle, why)` helper. Better: **inline the greps as comments** — e.g. `// ARCH-INVARIANT: save must commit exactly once via replaceGameState` next to the code, and assert on marker extraction. This makes the invariant discoverable at the code site instead of in a script 400 lines away. *Effort: M.*
4. **Add `jsdom` + `@testing-library/react` + wire up `fake-indexeddb`.** Enables the first-ever tests for the 89 components and (with the existing `afterIndexedDbStaging` seam) real `dbService` tests. *Effort: M–L, but highest ceiling.*
5. **Consolidate the 19 `desktop-*.mjs` scripts** — 7 of them are pure report generators (§4) and 12 overlap heavily. *Effort: M.*

**Is it worth it? Yes for steps 1–2 and 4; be selective about 3.** The scripts encode genuine domain knowledge — the story-weaving segment-alignment thresholds (`:648-659`, `:790-810`), the exactly-once save-commit invariant, the NPC-ledger command-key contract. Those must not be lost. But note the asymmetry: **a grep test is cheap to write and expensive to keep**, because every legitimate rename breaks it, and a broken test that you routinely "fix" by updating the expected string provides no protection at all. The 98 grep-dominant scripts are the part most likely to be silently defanged over time; converting them to behavioural tests or explicit architecture markers is what actually protects the invariants.

Conversely, **do not delete `long-session-oom-regression.mjs`, `npc-ledger-variable-facts-behavior.mjs`, `story-weaving-regression.mjs`, `teyvat-avatar-audit.mjs`, or `teyvat-migration-failure-drill-regression.mjs`** — these are doing real work.

---

## 4. CI/CD

`.github/` contains exactly **two** files: `CODEOWNERS` (2 lines) and **one** workflow.

```yaml
# .github/workflows/ci.yml  (complete file, 23 lines)
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:unit:coverage
      - run: pnpm test:release
      - run: pnpm test:all
```

**What runs, definitively:**

| Question | Answer |
|---|---|
| `pull_request` vs `push` to main | **Identical** — same single `build-test` job, same 9 steps. No `if:`, no second job, no tag trigger, no `paths` filter, no `workflow_dispatch`, no `schedule`. |
| Regression suite in CI? | **Yes.** `ci.yml:23` → `pnpm test:all` → all 179 scripts. Also `ci.yml:22` → `pnpm test:release` (6 audits). |
| `pnpm build` gated? Typecheck gated? | **Yes.** `ci.yml:20` → `build` = `tsc -b && vite build` (`package.json:11`). **The typecheck is gated only through the build** — there is no standalone `tsc --noEmit` step. |
| `pnpm test` invoked? | **No** — dead alias in CI. Also dead: `test:unit` (superseded by `test:unit:coverage`) and **`test:all-prompt` (`package.json:117`) which is never run anywhere automated.** |
| Tauri desktop release exercised? | **No.** `tauri`, `cargo`, `desktop:`, and `wrangler` appear **nowhere** in `.github/`. `tauri build` and `cargo check` are only reachable via `desktop-preflight.mjs:12-17`, behind `DESKTOP_PREFLIGHT_FULL=1`, and that script is never called by CI. **The Rust half of the product is never compiled in CI.** |
| Deployment? | **None.** `wrangler.toml` exists and `package.json:114-115` defines `deploy:cf`/`deploy:cf:preview`, but no `wrangler`/`cloudflare`/secret reference exists in `.github/`. |
| Artifacts / caching / matrix / concurrency / audit | Only pnpm store caching (`ci.yml:18`). **No artifact upload** (dist and coverage are computed then discarded), no matrix (Linux-only, despite shipping a Windows app), no `concurrency`, no `pnpm audit`, no Dependabot/CodeQL, no `permissions:` hardening, no `timeout-minutes`. |

**The 19 `desktop-*.mjs` scripts: a well-built manual runbook, unenforced.** 4 do genuine artifact verification (`desktop-verify-release.mjs:40-62` recomputes real SHA-256 and cross-checks `SHA256SUMS.txt`; `desktop-stage-release.mjs:71-78`; `desktop-verify-online-update.mjs:48-59` does the only network fetch; `desktop-update-manifest.mjs`), and `desktop-release-rules.mjs:35-55` has a real mtime-freshness gate that catches the classic stale-`.sig` mistake. But **7 of 19 are pure report generators** that write a markdown checklist and never fail on artifact quality (`desktop-github-release-notes`, `desktop-github-upload-commands`, `desktop-install-update-drill`, `desktop-code-signing-decision`, `desktop-storage-strategy`, plus `desktop-readiness`/`desktop-storage-audit` which only fail on source-string checks). Nothing publishes: `desktop-github-upload-commands.mjs:70,76` merely **prints** `gh release create/upload` commands for a human to paste. `desktop-code-signing-decision.mjs:75` **prints** `Get-AuthenticodeSignature` rather than checking it, and `tauri.conf.json:26` is `"csp": null` with **no code-signing config and an unsigned installer**.

Two concrete defects:
- **`test:desktop-edition` is referenced but not defined** in `package.json` — required by `desktop-preflight.mjs:4` and `desktop-readiness.mjs:52`. So `pnpm desktop:preflight` fails at step 1 and `desktop:readiness` permanently reports `missing=1`. The regression that "verifies" preflight only checks the string is present (`desktop-edition-regression.mjs:922`), so it locks the bug in.
- **Release-gate evidence can be forged by env var**: `desktop-release-gates.mjs:41-44` accepts `DESKTOP_RELEASE_GATES_LOCAL_READY=1` / `..._READINESS_READY=1` to pre-tick "已运行 …" boxes without running anything. The genuinely strict gate is `desktop-verify-release-gates.mjs:31` (fails if any `- [ ]` remains) — but it is manual-only.

**Assessment:** the CI that exists is *good* — `tsc -b` plus 179 regression scripts on every PR is far above average for a fan project, and the aggregate runner is self-expanding so new scripts are gated automatically. The gap is that **everything about shipping is manual, local, and unenforced**, and there is no artifact retention or `test:all-prompt` coverage.

---

## 5. Missing tooling

### 5.1 There is no linter, formatter, or schema tooling at all

`package.json` has **no `lint`, `format`, or `typecheck` script**, and there is **no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `biome.json`, or `.editorconfig`** anywhere in the repo. The only trace of a linter ever existing is **2 inline `eslint-disable` comments** in 106k lines.

### 5.2 The real cost, measured

I independently verified the brief's code statistics (they hold up). Counts over all TS/TSX excluding `node_modules`/`dist`/`.tmp-*`:

| Signal | Count | Why it matters |
|---|---|---|
| `<button>` elements | **408** | |
| **`<button>` missing `type=`** | **118 (29%)** | Inside a `<form>`, the default is `type="submit"`. This is the classic accidental-form-submit / double-submit bug class. No test covers it — **there are no component tests at all** (§2.4). |
| `as unknown as` | **63** | Each is a deliberate type-system bypass. Unaudited. |
| `as any` | **5** | Low; not the problem. |
| `: any` annotations | 8 | Low. |
| `useState(` | **427** | |
| `useEffect(` | 71 | Missing-deps bugs are invisible without `react-hooks/exhaustive-deps`. |
| Arrows returning JSX inline | **203** | Inline component definitions inside render → remount-on-every-render bugs. |
| `catch` blocks | **289** | |
| **`catch` whose entire body is `console.*`** | **28** | Swallowed errors. No `no-console`, no error reporting, no test. |
| `console.*` calls | **128** | No log-level discipline. |
| `JSON.parse(` | 59 | Includes the 7 unguarded upstream-frame parses in `chatCompletionClient.ts`. |
| `indexedDB` refs | 29 | The untested persistence layer. |
| `localStorage` refs | 11 | |
| `@ts-ignore` / `@ts-expect-error` | **0** | Genuinely good discipline. |
| `eslint-disable` | 2 | |

### 5.3 Concrete minimal setup, rules ranked by value

**Install:** `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react`, `eslint-plugin-import-x`. Flat config. **Do not add Prettier yet** — it would produce a 106k-line reformat diff that obliterates `git blame` and buries real changes; adopt it later in one dedicated commit, or use ESLint's stylistic rules only on changed files.

Enable in this order, each as a separate PR so the diff stays reviewable:

**Tier 1 — near-zero fix cost, high signal (do first):**
1. `react/jsx-boolean-value`, and specifically a targeted rule for **`<button>` requiring `type`** — via `react/button-has-type`. **118 real fixes.** This is the single highest value-per-effort rule in the list.
2. `react-hooks/rules-of-hooks` (`error`) — catches genuine runtime bugs.
3. `no-empty`, `no-fallthrough`, `no-constant-condition`, `no-unreachable` — correctness basics, currently unenforced.
4. `@typescript-eslint/no-unused-vars` (`warn`) — `factsToVariableCommands` being dead code (`utils/variableFacts.ts:1023-1351`) is exactly what this catches.

**Tier 2 — needs triage, medium cost:**
5. `react-hooks/exhaustive-deps` (`warn`) across 71 `useEffect`s. Expect real findings; do **not** set to `error` initially.
6. `@typescript-eslint/no-floating-promises` — requires type-aware linting (slower, needs `projectService`). High value in an app with this much async I/O; will surface real unhandled-rejection paths.
7. `no-console` (`warn`, allow `warn`/`error`) — forces the 28 console-only catch blocks to be looked at individually.
8. `@typescript-eslint/no-misused-promises` — catches `onClick={async () => ...}` handlers.

**Tier 3 — deliberately deferred:**
9. `@typescript-eslint/no-explicit-any` (`warn`) — only 5 instances; not worth the noise now.
10. **Ban `as unknown as` via `no-restricted-syntax`** on new code (`error`, with an existing-violations baseline). 63 sites is too many to fix at once, but this is the escape hatch that will silently grow.
11. Prettier/Biome formatting — separate, dedicated commit.

Also add scripts: `"lint": "eslint ."`, `"typecheck": "tsc --noEmit"`, and wire `lint` into `ci.yml` before `build`.

### 5.4 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` feasibility

`tsconfig.json` currently has `strict: true`, `skipLibCheck: true`, and **neither** of the two flags. My assessment: **not feasible now, and the reason is the test situation, not the type situation.**

- `noUncheckedIndexedAccess` turns every `arr[i]` and `record[key]` into `T | undefined`. Across 106k lines with heavy dynamic/bilingual record access (`state.NPC.[id=...]`, `worldbook[key]`, `parsedResponse.body[0]`), this will produce **thousands** of errors. Critically, with **242 modules (70.8%) never behaviourally tested**, the required edits are *unverifiable* — you would be adding `?.` and `?? fallback` across untested code paths, which is exactly how you convert a compile-time complaint into a silent runtime behaviour change (e.g. a fallback that quietly swallows a missing save field). Turning it on without coverage risks *introducing* data bugs.
- `exactOptionalPropertyTypes` is narrower but interacts badly with the many optional-field DTOs and the Chinese-keyed save schema; it typically requires rewriting object spreads like `{...base, field: maybeUndefined}` into conditional construction. Doable, but only in the `models/` + `tests/` layer where types are actually exercised.
- `noImplicitOverride` — trivially feasible (few classes; `dbService` is the main one). **Turn this on now.**

**Recommended sequencing:** (1) `noImplicitOverride` immediately. (2) `noUncheckedIndexedAccess` **only after** step 4 of §3.3 lands (`jsdom` + real `dbService`/`sendWorkflow` tests), and then module-by-module using `// @ts-strict-ignore`-style opt-in or a per-directory tsconfig rather than repo-wide. (3) `exactOptionalPropertyTypes` last, scoped to `models/` and `tests/`. Trying to flip either flag repo-wide today would generate a large, mechanically-edited, largely-unverified diff — the highest-risk kind of change in a codebase with this coverage profile.

---

## 6. Build config review

### 6.1 `vite.config.ts`

The build block is 23 lines (`:142-164`) and `target: 'es2022'` is justified in a comment by Tauri WebView2 + modern browsers (`:143`). `define.__APP_VERSION__` reads `package.json` at config time to avoid version drift (`:131-136`) — a good touch. The dev server also hosts **4 hand-rolled API proxy middlewares** (`/api/qianfan`, `/api/opencode`, `/api/pioneer`, `/api/ark`, `:26-128`) that reuse production handler cores — that is genuinely nice design (dev/prod parity for the proxy path).

### 6.2 `manualChunks` — the `chunk-app` problem is real

```ts
// vite.config.ts:147-151
manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    if (id.includes('/services/') || id.includes('/hooks/') || id.includes('/models/')) return 'chunk-app';
    return undefined;
  }
  ...
}
```

**What it lumps together:** `services/` (76 files, 20,632 lines) + `hooks/` (23 files, 10,247 lines) + `models/` (38 files, 9,244 lines) = **137 modules / 40,123 lines → one 1,126,379-byte chunk**, confirmed in `.bundle-baseline.json:13`.

**Impact on initial load.** These are statically imported by `App.tsx`, so `chunk-app` is in the eager load graph. At 1.1 MB raw (20.6% of the 5,463,614-byte total) it is the **second-largest artifact after a 2,953 KB monster chunk**, and the two together are **76% of all shipped JS**. Note the asymmetry: `components/` (89 files, 37,943 lines — *larger* than the app chunk in source) is **not** in `chunk-app` and therefore does get route-split, which is why `SettingsModal-*.js` (332 KB) and `AlbumPanel-*.js` (242 KB) exist as separate lazy chunks (`.bundle-baseline.json:17-22`). So the config splits the UI but **forces the entire domain/service/model layer into the critical path**, including code only reachable from lazily-loaded panels.

**Impact on cache invalidation — this is the worse problem.** A single shared chunk means **any edit to any one of 137 modules invalidates the whole 1.1 MB chunk** for every returning user. Editing a one-line string in `models/teyvat/steambird.ts` forces a full re-download of `services/ai/*`, all 23 hooks, and all 38 models. Since `chunk-app` is on the critical path, that is a full reload of the app's core. The content-hash in the filename (`chunk-app-D_6hFimO.js`) makes it *correct* but maximally *coarse*.

**Assessment: unsound as written.** It is not merely suboptimal — it defeats the purpose of the split, because the split boundary (UI vs. domain) does not match the change-frequency or load-priority boundary. Recommended replacement, in order of preference:

1. **Split by load priority:** `chunk-core` (state models + the turn loop: `models/teyvat/state.ts`, `hooks/useGame.ts`, `hooks/useGame/sendWorkflow.ts`) vs `chunk-domain` (the rest of services/models). Even a 2-way split roughly halves the invalidation blast radius on the critical path.
2. **Split by subsystem using path prefixes**, which the current `id.includes('/services/')` test already makes easy: `services/ai/*` (the provider adapters — large, and change independently of persistence), `services/storage/*` + `services/dbService.ts`, `models/teyvat/*`, `models/*`.
3. **Let Rollup decide.** Simply returning `undefined` for app modules and only chunking `node_modules` is often better than a coarse manual grouping, because Vite will then split on dynamic-import boundaries.

### 6.3 `.bundle-baseline.json` — what it gates, and why the gate is nearly toothless

`.bundle-baseline.json` (recorded `at: 2026-09-02T05:00:49Z`) pins five measurements from a real build and is enforced by `scripts/bundle-size-regression.mjs`:

| Baseline field | Value | Note |
|---|---|---|
| `indexBytes` | 194,447 | main entry, 3.6% of total |
| `maxChunkBytes` | **3,024,301** (2,953 KB) | `assets/chunk-st-presets-DMlFZxWT.js` — **55.4% of all shipped JS** |
| `totalJsBytes` | 5,463,614 | |
| `gzipTotalBytes` | 1,636,818 | 30% of raw |
| `chunk-app` | 1,126,379 | 20.6% |

The gate logic (`bundle-size-regression.mjs:31-36`):

```js
const capIndex = 300 * 1024;
const capMaxChunk = Math.min(Math.floor(baseline.maxChunkBytes * 1.15), 3.5 * 1024 * 1024);
const capTotalJs = Math.floor(baseline.totalJsBytes * 1.15);
```

Three concrete weaknesses:

1. **The largest chunk is effectively ungated.** `capMaxChunk = min(3024301 × 1.15, 3670016) = 3,477,946 B ≈ 3,396 KB`. A **3.3 MB single chunk passes**. The only genuinely tight cap is `indexBytes < 300 KB` — and index is the *smallest* artifact at 194 KB, so even that has 54% headroom. Total JS is only capped at 115% of an already-large baseline (≈6.28 MB).
2. **The budget is self-service with no review gate.** `bundle-size-report.mjs:46-48` writes the baseline whenever `--update` is passed, and `bundle-size-regression.mjs:7` instructs you to do exactly that when it fails ("run `pnpm build && node scripts/bundle-size-report.mjs --update` first"). So any developer hitting the cap is told to raise it. Nothing records *why* a budget increased; the report is not uploaded as a CI artifact (no `actions/upload-artifact`).
3. **The baseline is likely stale or from a different config, and it self-authorizes.** I could not trace the 2,953 KB chunk's origin: there are **no `?raw`/`?url`/`import.meta.glob` imports** anywhere in source, **no literal `st-presets`/`ST_PRESETS` identifier**, and `data/builtinPresets/` is only **7 KB across 2 files**. The name implies a Rollup auto-split chunk from the `utils/stPresetParser.ts` (24.7 KB) + `data/builtinPromptModules.ts` (61 KB) region — roughly 93 KB of source, which is nowhere near 2,953 KB of output. Whatever produced it, **because the cap is computed *from* the baseline, an inflated baseline permanently authorizes itself.**

**Additionally: `bundle-size-regression.mjs` is a landmine.** It is auto-swept into `test:all` by the `readdirSync` glob, it has **no entry in `package.json`** (so it is undiscoverable and un-runnable-by-name), and it does an **unguarded** `fs.readdirSync(path.join(dist, 'assets'))` at `:9` — note it *does* guard for the baseline's existence at `:7` but not for `dist`. **`dist/` is absent in this working copy** (verified), so `pnpm test` fails on a clean checkout while CI passes (because `ci.yml:20` builds first). This is the concrete manifestation of the §3.2 divergence.

---

## 7. Stray artifacts & repo hygiene

I probed `.git/index` (the staged-path table is plain UTF-8 within the binary) rather than trusting `.gitignore` alone, because "ignored" and "tracked" are different questions.

### 7.1 Correctly ignored — nothing to do

| Path | Ignored by | Tracked? | Verdict |
|---|---|---|---|
| `.tmp-regression/` (22 files, 18 KB) | `.gitignore:10` (`.tmp-*/`) | **No** | Correct. Build residue from regression scripts. Also excluded from typecheck (`tsconfig.json:19`). |
| `.tmp-story-weaving-regression/` (40 files, 296 KB) | `.gitignore:10` | **No** | Correct. Left behind by `story-weaving-regression.mjs:7`. |
| `.tmp-story-weaving-persistence-regression/` (3 files, 57 KB) | `.gitignore:10` | **No** | Correct. |
| `tsconfig.tsbuildinfo` (15 KB) | `.gitignore:8` (`*.tsbuildinfo`) | **No** | Correct (**contrary to the brief**). Emitted by `tsc -b`. |
| `.reasonix/`, `.trae/`, `.workbuddy/` | `.gitignore:21-23` | **No** | Correct. |
| `.superpowers/` | `.gitignore:41` | **No** | Correct. |
| `.pnpm-store/` | `.gitignore:17` | **No** | Correct. |
| `assets-src/` | `.gitignore:26` | **No** | Correct and intentional — the comment at `:25` explains only optimized output lives in `public/`. This matters: `assets-src/` holds multi-MB PNG candidates (`stelle-01.png` 2.2 MB, `须弥.png` 2.5 MB), so ignoring it prevents real repo bloat. |

### 7.2 Wrongly tracked

| Path | Size | Problem |
|---|---|---|
| `stories/assets/**` (16 files) | **742,988 B total**; `addon-library.png` alone **467,366 B (456 KB)** | These are **default Storybook scaffolding boilerplate** — `addon-library.png`, `accessibility.png`, `discord.svg`, `youtube.svg`, `figma-plugin.png`, `tutorials.svg`. `.storybook/main.ts` (306 B) registers **only `@storybook/addon-docs`**, so most of these images are referenced by no story at all. **456 KB of one PNG is 63% of all Storybook assets and larger than the entire `stories/` codebase it supports.** |
| `src-tauri/icons/icon.icns` | **2.76 MB** | The largest tracked file in the repo after `assets-src/`. It is a **macOS** icon for a project whose `tauri.conf.json:31` bundle target is **`["nsis"]` (Windows only)**. Dead weight for a Windows-only product. |

### 7.3 Wrongly ignored — the consequential finding

**`.gitignore:44` ignores `docs/` wholesale.**

```gitignore
# Local assistant memory / private planning notes
.claude/
.superpowers/
AGENTS.md
AGENTS-OLD.md
docs/
```

This collides directly with the tooling layer:

```js
// scripts/run-prompt-regressions.mjs:1-3
// 提示词相关回归脚本聚合入口（P0 准备项，2026-07-26 提示词优化计划）
// 用法：pnpm run test:all-prompt
// 清单来源：docs/superpowers/specs/2026-07-26-prompt-optimization-feasibility-review.md §3
```

The **provenance document for a 28-script test manifest is gitignored**. So the *why* behind `run-prompt-regressions.mjs`'s script list — which 28 scripts, chosen on what basis — is unrecoverable for anyone cloning the repo. Note also that this list (`:6-35`) **overlaps heavily with `run-all-regressions.mjs`'s auto-scan**, so `test:all-prompt`'s only unique value is curation rationale that lives in an ignored file.

Compounding it: `docs/` is also where generated release evidence would live, and `.desktop-release/` is ignored at `.gitignore:11`. **No release evidence is version-controlled** (§4).

### 7.4 Other observations

- **An empty module is compiled on every typecheck.** `components/features/Settings/WorldbookManagerModal.tsx` is **3 bytes — a bare UTF-8 BOM (`EF BB BF`), zero content**. It is the only file under 20 bytes in the source tree. I checked whether this is a dangerous truncated lazy-import target (as it superficially appears): **it is not.** It has **0 importers**; `App.tsx:57` imports the real 1,297-line `@/components/features/Worldbook/WorldbookManagerModal` (which has exactly 1 importer). So this is dead cruft left by a file move, not a runtime defect — but `tsconfig.json:18` (`include: ["**/*.ts", "**/*.tsx"]`) compiles it on every `tsc -b`, and it is a plausible source of a future "why does this module have no exports" confusion. Delete it.
- **Duplicate destructive-save UI with no test to keep them in sync.** `components/features/Settings/StorageManager.tsx` (2,551 lines) calls `deleteSave`/`deleteSaveTree`/`forceDeleteSave`/`repairSaveDatabase` in seven places, each gated only by a native `confirm()` (e.g. `:359`, `:365`, `:374`, `:379`, `:418`, `:778`, `:804`), and the same deletion surface is duplicated in `components/features/SaveLoad/SaveLoadModal.tsx` (1,519 lines, `deleteSave` `:211` / `deleteSaveTree` `:246`). **Both have 0 test references.** Two independent implementations of irreversible data deletion can drift apart with nothing to catch it.
- **`docs/` being ignored also means the 4 `.ts` files under `scripts/` and the `public/data/story-weaving-canon/legacy-hsr/` JSON set (≈5.7 MB of Penacony canon data, e.g. `story_canon_penacony_in_our_time.json` at 966 KB) are the only large canonical data assets, and those *are* tracked** — appropriate, since they ship to `public/`.
- **A repo-root `.bat`** (`启动旅行者纪事.bat`, 697 B) is tracked. Harmless, but an unexplained Windows-only launcher at the root with no README reference.
- **`CONTRIBUTING.md` (1,393 B) does not mention the test, lint, or build workflow** — no match for `test|CI|deploy|build`. The 179-script suite is the project's most valuable asset and is undocumented for contributors. `README.md` likewise never mentions the desktop release flow.
- **Root is otherwise clean.** No committed `dist/`, `coverage/`, `.env`, or `*.log`. The hygiene problem is confined to two oversized tracked binaries and the over-broad `docs/` ignore.

---

## 8. Prioritized recommendations

Ranked by value ÷ effort.

| # | Change | Expected benefit | Effort |
|---|---|---|---|
| **1** | **Remove the `coverage.include` allow-list** (`vitest.config.ts:11-15`). Optionally raise thresholds gradually per-directory. | Instantly makes **29 already-passing test files / 292 `it(` cases / 6,171 lines** visible to the coverage gate. Today the gate measures 471 lines = 0.44% of source. Highest value-per-character change available. | **S** |
| **2** | **Fix `bundle-size-regression.mjs`** — guard `dist` with `fs.existsSync` (mirror `:7`), add a `test:bundle` entry to `package.json`, and make `package.json:30`'s `test` script build first (or skip the bundle check when `dist` is absent). | `pnpm test` currently **fails with ENOENT on a clean checkout** while CI passes, because `test` has no build step but the auto-swept bundle script needs `dist/`. Restores trust in the primary developer command. | **S** |
| **3** | **Declare `sharp`** in `package.json` and replace the 4 hardcoded `../node_modules/.pnpm/sharp@0.34.5/...` imports with `import sharp from 'sharp'`. | Removes a **phantom dependency that gates CI** (`teyvat-avatar-audit.mjs` is in `test:release`). Any sharp bump or pnpm hoisting change currently breaks CI with module-not-found. | **S** |
| **4** | **Add ESLint (flat config) with Tier-1 rules only** — `react/button-has-type` (118 real fixes), `react-hooks/rules-of-hooks`, `no-empty`, `no-unreachable`, `@typescript-eslint/no-unused-vars`. Add `lint` script + a `ci.yml` step before `build`. | Fixes 118 potential accidental-form-submit bugs in code with **zero component tests**; enables unused-code detection (would have caught the dead `factsToVariableCommands`). **Skip Prettier for now** — a 106k-line reformat would bury real changes. | **S–M** |
| **5** | **Add a `.npmrc`/`package.json` `engines` + pin `node-version: 22.18` (or `22.x` with an explicit floor) and add `.nvmrc`.** | 12 regression scripts silently depend on Node's default type stripping (22.18+). `ci.yml:17`'s floating `node-version: 22` works by luck today. One `engines` field makes the requirement explicit. | **S** |
| **6** | **Break up the `chunk-app` manual chunk** (`vite.config.ts:147-151`) — split `services/ai/*`, `services/storage/*`+`dbService`, `models/teyvat/*`, and the turn-loop core into separate chunks; or simply return `undefined` for app modules and let Rollup split on dynamic-import boundaries. | Today **137 modules / 40,123 lines / 1.1 MB** share one content hash: a one-line edit to any model invalidates the whole app core on the critical path. Also shrinks initial load by letting lazily-reached services split off. | **M** |
| **7** | **Fix the baseline-gate math** (`bundle-size-regression.mjs:32`) — cap `maxChunkBytes` at an **absolute** budget (e.g. 1.5 MB) rather than `baseline × 1.15`, and require a reviewed commit to change `.bundle-baseline.json` instead of documenting `--update` as the fix. | Current cap permits a **3,396 KB** single chunk; the top-2 chunks are **76% of shipped JS**. Also investigate/refresh the stale baseline (§6.3). | **S** |
| **8** | **Add `jsdom` + `@testing-library/react`; wire up the already-installed-but-unused `fake-indexeddb`; use the existing `dbService` test seam `afterIndexedDbStaging`** (`services/dbService.ts:197-198`). Write first tests for `dbService` save/load and 3–5 critical components. | Unlocks the **first-ever** verification of 89 components / 37,943 lines and the **entire untested persistence layer** (1,975 lines, 29 `indexedDB` refs, `JSON.parse` of imported saves). The seam to make `dbService` testable was already built and is unused. | **M–L** |
| **9** | **Convert the 39 module-executing regression scripts** (24 behavioural + 15 hybrid) into `tests/behaviour/*.test.ts` under a second Vitest project, via a shared `loadModule()` bundling helper. **Keep the 5 genuinely valuable behavioural scripts as-is during migration.** | Removes ~2,000 lines of duplicated harness, replaces 111 copies of the same `assert` with `expect`, makes tests addressable by name (101 of 176 are currently undiscoverable), and drops 10-min serial spawns. | **M** |
| **10** | **Add `test:all-prompt` to `ci.yml`** and stop gitignoring the rationale doc (`docs/superpowers/specs/2026-07-26-prompt-optimization-feasibility-review.md`, cited at `run-prompt-regressions.mjs:3`). | 28 prompt-regression scripts are currently **ungated anywhere**; their selection rationale is unrecoverable from a clone because `docs/` is ignored (`.gitignore:44`). | **S** |
| **11** | **Add `noImplicitOverride: true`** to `tsconfig.json` now. **Defer** `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` until after #8, then apply per-directory. | `noImplicitOverride` is trivially safe. The other two would generate **thousands of edits across 242 untested modules (70.8%)** — mechanically adding `?.`/`?? fallback` to unverified code paths risks converting compile errors into silent runtime behaviour changes. | **S** now, **L** later |
| **12** | **Wire `cargo check` (or `tauri build`) into CI**, and add `actions/upload-artifact` for the bundle report + coverage. | **The Rust half of the product is never compiled in CI** — a PR breaking `src-tauri/src/lib.rs` passes green. Artifacts are currently computed and discarded, so bundle/coverage regressions leave no trace. | **M** |
| **13** | **Fix two `desktop-*.mjs` defects:** define the missing `test:desktop-edition` script, and remove the `DESKTOP_RELEASE_GATES_*_READY=1` env bypasses (`desktop-release-gates.mjs:41-44`). | `pnpm desktop:preflight` currently fails at step 1 and `desktop:readiness` permanently reports `missing=1`; release-gate evidence can be forged without running anything. | **S** |
| **14** | **Untrack `stories/assets/` boilerplate** (−743 KB, incl. a 456 KB unused PNG) and **`src-tauri/icons/icon.icns`** (−2.76 MB, a macOS icon for an NSIS-only Windows build). | ~3.5 MB of dead tracked binaries. | **S** |
| **15** | **Document the test/lint/build workflow in `CONTRIBUTING.md`**, including a short guide to which of the 179 regression scripts actually execute code vs. grep. | The 179-script suite is the project's greatest asset and is entirely undocumented; contributors cannot tell a behavioural test from a source grep. | **S** |

### What to do first, concretely

Items **1–5 are all `S`** and together remove two outright breakages (the `pnpm test` ENOENT, the `sharp` phantom dependency), make 29 hidden test files count, fix 118 latent button bugs, and pin the Node floor. That is a single afternoon of work and it addresses the majority of the findings with the least risk. Item **6** is the highest-value `M`, and **8** is the highest-ceiling change in the list.

### The two things I would not do

- **Do not delete the regression scripts wholesale.** `long-session-oom-regression.mjs`, `npc-ledger-variable-facts-behavior.mjs`, `story-weaving-regression.mjs`, `teyvat-avatar-audit.mjs`, and `teyvat-migration-failure-drill-regression.mjs` are real tests encoding real domain knowledge. The 39 module-executing scripts are the asset worth migrating, not discarding.
- **Do not enable `noUncheckedIndexedAccess` repo-wide today.** With 70.8% of modules behaviourally untested, a repo-wide flag flip produces a large, mechanically-generated, unverifiable diff — the highest-risk change category for a codebase in this coverage state.

---

## Summary judgement

The tooling here is **materially better than the brief anticipated, and worse than the script count suggests.**

Genuinely strong: a 23-line CI that gates `tsc -b` **plus 179 regression scripts on every PR**; a self-expanding aggregate runner that automatically picks up new `*-regression.mjs` files; four independently-invented `.mjs`→`.ts` interop strategies that execute real code with no build step (the esbuild→`data:` URL trick is elegant); real SHA-256 artifact verification in the desktop release path; a real mtime-freshness gate for stale updater signatures; zero `@ts-ignore`/`@ts-expect-error` in 106k lines; and genuine asset-integrity verification (120 avatars checked for dimensions, format and byte budget with `sharp`).

Genuinely weak, in order of severity: **`coverage.include` hides 29 of 32 working test files** and measures 0.44% of source; **~242 modules (70.8%) are never behaviourally verified**, including `sendWorkflow.ts`'s 2,075-line turn loop (1 test case), `dbService.ts` (never invoked, only `vi.mock`ed), and `chatCompletionClient.ts` (2,509 lines, `apiKey` header/body routing, 7 unguarded `JSON.parse`); **no component-test capability whatsoever** for 89 components / 37,943 lines despite `fake-indexeddb` already being installed and unused; **61.4% of the 3,914 regression assertions are source-text greps** and 120 of 176 scripts never execute project code; **`pnpm test` is broken on a clean checkout** while CI passes; a **phantom `sharp` dependency at a hardcoded pnpm store path gates CI**; the **largest bundle chunk is ungated at 3.3 MB** and one manual chunk binds 137 modules to a single cache key; and **everything about shipping is manual and unenforced**, with the Rust half of the product never compiled in CI.
