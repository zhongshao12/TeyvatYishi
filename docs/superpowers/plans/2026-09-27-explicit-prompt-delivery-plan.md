# Explicit Prompt Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace independent-model prompt routing by module ID prefix with explicit targets, and make current versus last-sent context diagnostics distinguishable without enforcing a token limit.

**Architecture:** Keep `scope` for narrative scene selection and add `deliveryTargets` for model destinations. A single selector resolves saved modules and returns both selected modules and exclusion reasons. Current previews use this selector; last-sent request metadata is collected at the text client boundary without storing prompt bodies or credentials. This is the first of four independent plans in the approved design; settlement, storage, and resource contracts follow separately.

**Tech Stack:** React 19, TypeScript, Vitest, Vite, existing `ContextViewer` and IndexedDB settings.

**执行记录（2026-09-27）：** Task 1–4 的代码已提交到 `codex/prompt-delivery`，全量单元测试 183 个文件、1076 项通过，TypeScript、Lint（0 错误，项目存量警告 143 条）及生产构建通过。最后请求诊断按“请求尝试”标注，仅保留本次应用运行期的元数据；并未增加发送前硬上限或自动裁剪。浏览器手工验收仍待进行；下方步骤保留原计划文本作为实施依据。

---

## File map

- `models/prompts.ts`: destination type and field on prompt modules.
- `services/promptDelivery.ts`: one destination resolver and exclusion reason model; no React or storage dependencies.
- `services/promptModuleScopes.ts`: independent-model selector delegates to `promptDelivery`.
- `hooks/useGameState.ts`: one-time migration of saved custom modules; built-ins are rebuilt from source.
- `data/builtinPromptModules.ts`: assign source-controlled destinations to built-ins.
- `components/features/Settings/PromptModulesTab.tsx`: display and edit destinations for editable modules.
- `services/ai/requestMetadata.ts`: in-memory last-sent metadata, no prompt text or secrets.
- `services/ai/chatCompletionClient.ts`: capture metadata immediately before transport, not on a preview.
- `hooks/useGame/contextSnapshot.ts` and `components/features/Settings/ContextViewer.tsx`: show preview selection and separately labeled actual-request metadata.
- `tests/unit/promptDelivery.test.ts`, `tests/unit/requestMetadata.test.ts`, and existing prompt/context tests: routing, migration, privacy, no hard limit.

## Task 1: Explicit destination contract

**Files:** Create `services/promptDelivery.ts`, modify `models/prompts.ts`, test `tests/unit/promptDelivery.test.ts`.

- [ ] **Step 1: Write a failing resolver test.**

```ts
import { describe, expect, it } from 'vitest';
import { resolvePromptDeliveryTargets } from '@/services/promptDelivery';
import type { 提示词模块 } from '@/models/prompts';

const sample = (id: string, deliveryTargets?: 提示词模块['deliveryTargets']) => ({
  id, deliveryTargets, scope: ['calibration'], enabled: true,
}) as 提示词模块;

describe('prompt delivery', () => {
  it('uses an explicit target instead of an ID prefix', () => {
    expect(resolvePromptDeliveryTargets(sample('unrelated', ['courier']))).toEqual(['courier']);
    expect(resolvePromptDeliveryTargets(sample('custom_courier_wrong', ['variable']))).toEqual(['variable']);
  });
  it('does not guess a target for an unknown calibration module', () => {
    expect(resolvePromptDeliveryTargets(sample('custom_unknown'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run red:** `pnpm exec vitest run tests/unit/promptDelivery.test.ts`; expect import/behavior failure.
- [ ] **Step 3: Add `PromptDeliveryTarget = 'main' | 'variable' | 'courier' | 'steambird' | 'codex' | 'irminsulRecall' | 'irminsulArchive' | 'storyWeaving'` to `models/prompts.ts`, add optional `deliveryTargets?: PromptDeliveryTarget[]` to `提示词模块`, and implement the pure resolver below.**

```ts
export const PROMPT_DELIVERY_TARGETS: readonly PromptDeliveryTarget[] = [
  'main', 'variable', 'courier', 'steambird', 'codex',
  'irminsulRecall', 'irminsulArchive', 'storyWeaving',
];
export const PROMPT_DELIVERY_LABELS: Record<PromptDeliveryTarget, string> = {
  main: '主剧情', variable: '变量', courier: '手机', steambird: '蒸汽鸟报',
  codex: '图鉴', irminsulRecall: '世界树召回',
  irminsulArchive: '世界树归档', storyWeaving: '剧情编织',
};
export function resolvePromptDeliveryTargets(module: 提示词模块): PromptDeliveryTarget[] {
  if (module.deliveryTargets) return [...new Set(module.deliveryTargets)];
  if (!module.scope?.includes('calibration')) return ['main'];
  return [];
}
```

- [ ] **Step 4: Run green:** same Vitest command; expect 2/2 tests pass.
- [ ] **Step 5: Commit only these files:** `git add models/prompts.ts services/promptDelivery.ts tests/unit/promptDelivery.test.ts` then `git commit -m "feat: define explicit prompt delivery targets"`.

## Task 2: Migrate known destinations and route independent models

**Files:** Modify `services/promptDelivery.ts`, `services/promptModuleScopes.ts`, `data/builtinPromptModules.ts`, `hooks/useGameState.ts`, `tests/unit/promptDelivery.test.ts`, `tests/unit/promptModuleScopesBehavior.test.ts`.

- [ ] **Step 1: Add failing tests for known built-ins, a saved legacy custom module, and an explicit cross-system override.**

```ts
it('routes the source-controlled domain command rules to variable', () => {
  const builtin = createBuiltinPromptModules().find((module) => module.id === 'builtin_domain_command_rules');
  expect(builtin && resolvePromptDeliveryTargets(builtin)).toEqual(['variable']);
});
it('migrates an old custom courier ID exactly once', () => {
  expect(migratePromptDeliveryTargets([sample('custom_courier_1')])[0]?.deliveryTargets).toEqual(['courier']);
});
it('keeps explicit target authoritative after migration', () => {
  expect(migratePromptDeliveryTargets([sample('custom_courier_1', ['variable'])])[0]?.deliveryTargets).toEqual(['variable']);
});
```

- [ ] **Step 2: Run red:** `pnpm exec vitest run tests/unit/promptDelivery.test.ts tests/unit/promptModuleScopesBehavior.test.ts`; expect new migration tests fail.
- [ ] **Step 3: Implement the known-ID migration table below in `services/promptDelivery.ts`. In `filterIndependentPromptModules`, replace `matchers.some(...)` with `resolvePromptDeliveryTargets(module).includes(target)`. Source-controlled built-ins receive their explicit target from `makeBuiltin` via `legacyTargetForId`; saved customs are migrated in `migratePromptModules` after ID normalization. Preserve `enabled`, `scope`, `category`, and order checks.**

```ts
export function legacyTargetForId(id: string): PromptDeliveryTarget[] {
  if (/^(builtin|custom|st_import)_steambird_/u.test(id)) return ['steambird'];
  if (/^(builtin|custom|st_import)_courier_/u.test(id)) return ['courier'];
  if (/^(builtin|custom|st_import)_codex_/u.test(id)) return ['codex'];
  if (id === 'builtin_irminsul_recall' || /^(custom|st_import)_irminsul_recall_/u.test(id)) return ['irminsulRecall'];
  if (/^(builtin|custom|st_import)_irminsul_archive_/u.test(id)) return ['irminsulArchive'];
  if (/^builtin_canon_/u.test(id) || /^custom_storyWeaving_/u.test(id) || /^st_import_story_weaving_/u.test(id)) return ['storyWeaving'];
  if (/^builtin_(variable_|domain_command_)/u.test(id) || id === 'builtin_companion_archive_worldbook'
    || /^custom_(variable_|companionArchive_)/u.test(id)
    || /^st_import_(variable_|companion_archive_)/u.test(id)) return ['variable'];
  return [];
}
export function migratePromptDeliveryTargets(modules: 提示词模块[]): 提示词模块[] {
  return modules.map((module) => module.deliveryTargets !== undefined
    ? module
    : { ...module, deliveryTargets: module.scope?.includes('calibration') ? legacyTargetForId(module.id) : ['main'] });
}
```

In `makeBuiltin`, add `deliveryTargets: overrides.scope.includes('calibration') ? legacyTargetForId(overrides.id) : ['main']` before `...overrides`; an explicit override remains authoritative.
At the selector boundary, a missing `deliveryTargets` may use `legacyTargetForId(id)` for known old modules until saved settings are migrated; an explicit empty array means intentionally unassigned and must never fall back to the ID. New modules must write the field when created.

- [ ] **Step 4: Run green:** both Vitest files; expect all existing prefix-compatibility cases plus new explicit-target cases pass.
- [ ] **Step 5: Run `pnpm build` and commit only Task 2 files.**

## Task 3: Editable target UI and current-preview diagnosis

**Files:** Modify `components/features/Settings/PromptModulesTab.tsx`, `hooks/useGame/contextSnapshotTypes.ts`, `hooks/useGame/contextSnapshot.ts`, `tests/unit/promptDelivery.test.ts`.

- [ ] **Step 1: Add a failing pure test for exclusion reasons.**

```ts
it('explains disabled, wrong-target, and unassigned modules', () => {
  expect(explainPromptDelivery({ ...sample('x', ['courier']), enabled: false }, 'courier')).toBe('disabled');
  expect(explainPromptDelivery(sample('x', ['variable']), 'courier')).toBe('wrong-target');
  expect(explainPromptDelivery(sample('x'), 'courier')).toBe('unassigned');
});
```

- [ ] **Step 2: Run red:** `pnpm exec vitest run tests/unit/promptDelivery.test.ts`; expect missing helper.
- [ ] **Step 3: Implement the explanation and toggle helpers below in `services/promptDelivery.ts`. Add a target checkbox row to the existing module editor beside `ScopeChips`, update via `onPatch({ deliveryTargets: next })`, and show an unassigned warning. Make independent-system grouping use the explicit primary target, retaining `companionArchive` as a UI alias for the `variable` target only when that exact subtype is known.**

```ts
export type PromptDeliveryReason = 'selected' | 'disabled' | 'wrong-scope' | 'unassigned' | 'wrong-target';
export function explainPromptDelivery(module: 提示词模块, target: PromptDeliveryTarget): PromptDeliveryReason {
  if (!module.enabled) return 'disabled';
  if (target !== 'main' && !module.scope?.includes('calibration')) return 'wrong-scope';
  const targets = resolvePromptDeliveryTargets(module);
  if (!targets.length) return 'unassigned';
  return targets.includes(target) ? 'selected' : 'wrong-target';
}
export function togglePromptTarget(targets: PromptDeliveryTarget[], target: PromptDeliveryTarget): PromptDeliveryTarget[] {
  return targets.includes(target) ? targets.filter((item) => item !== target) : [...targets, target];
}
```

```tsx
<Field label="◆ 投递目标">
  <div className="flex flex-wrap gap-2">
    {PROMPT_DELIVERY_TARGETS.map((target) => <label key={target}>
      <input type="checkbox" disabled={readonly}
        checked={resolvePromptDeliveryTargets(m).includes(target)}
        onChange={() => onPatch({ deliveryTargets: togglePromptTarget(resolvePromptDeliveryTargets(m), target) })} />
      {PROMPT_DELIVERY_LABELS[target]}
    </label>)}
  </div>
</Field>
```

- [ ] **Step 4: Extend `ContextSnapshot` with `deliveryDecisions?: Array<{ id: string; title: string; target: PromptDeliveryTarget; reason: PromptDeliveryReason; estimatedTokens: number }>`; populate it from the same selector used by runtime, render a clearly titled “当前预览” table in `ContextViewer`, and leave current prompt text view unchanged.**
- [ ] **Step 5: Run green:** `pnpm exec vitest run tests/unit/promptDelivery.test.ts tests/unit/contextViewerComposition.test.ts` and `pnpm build`; verify editable target remains saved after reopening settings; commit Task 3 files only.

## Task 4: Last actual request metadata and non-blocking context usage

**Files:** Create `services/ai/requestMetadata.ts`, modify `services/ai/chatCompletionClient.ts`, `hooks/useGame/contextSnapshotTypes.ts`, `hooks/useGame/contextSnapshot.ts`, `components/features/Settings/ContextViewer.tsx`; test `tests/unit/requestMetadata.test.ts`.

- [ ] **Step 1: Write a failing test for a metadata-only record and no blocking.**

```ts
it('records estimated usage without retaining prompt text or keys', () => {
  const record = createRequestMetadata({ target: 'main', model: 'example',
    systemPrompt: 'private prompt', messages: [{ role: 'user', content: 'secret input' }],
    configuredWindow: undefined });
  expect(record.estimatedInputTokens).toBeGreaterThan(0);
  expect(JSON.stringify(record)).not.toMatch(/private prompt|secret input|apiKey/i);
  expect(record.windowRatio).toBeUndefined();
});
```

- [ ] **Step 2: Run red:** `pnpm exec vitest run tests/unit/requestMetadata.test.ts`; expect missing function.
- [ ] **Step 3: Implement an in-memory per-target map with `createRequestMetadata` and `rememberRequestMetadata`; count prompt and message segments using the existing `estimateTextTokens`, storing only target, model, segment labels/token estimates, optional window ratio, timestamp, and returned API usage. Hook the common `chatCompletion` and `chatCompletionNonStream` entry points immediately before transport, passing an optional target/purpose from main, variable, courier, and other text callers. Keep `maxContext` optional; never reject or mutate a request based on estimate.**

```ts
export interface RequestMetadata {
  target: PromptDeliveryTarget;
  model: string;
  estimatedInputTokens: number;
  segments: Array<{ label: string; estimatedTokens: number }>;
  windowRatio?: number;
  sentAt: number;
  actualInputTokens?: number;
}
const lastByTarget = new Map<PromptDeliveryTarget, RequestMetadata>();
export function createRequestMetadata(input: {
  target: PromptDeliveryTarget; model: string; systemPrompt: string;
  messages: Array<{ role: string; content: string }>; configuredWindow?: number;
}): RequestMetadata {
  const segments = [
    { label: 'system', estimatedTokens: estimateTextTokens(input.systemPrompt) },
    ...input.messages.map((message, index) => ({ label: `${message.role} ${index + 1}`, estimatedTokens: estimateTextTokens(message.content) })),
  ];
  const estimatedInputTokens = segments.reduce((total, segment) => total + segment.estimatedTokens, 0);
  return { target: input.target, model: input.model, segments, estimatedInputTokens,
    ...(input.configuredWindow && input.configuredWindow > 0 ? { windowRatio: estimatedInputTokens / input.configuredWindow } : {}),
    sentAt: Date.now() };
}
export function rememberRequestMetadata(record: RequestMetadata): void { lastByTarget.set(record.target, record); }
export function readLastRequestMetadata(target: PromptDeliveryTarget): RequestMetadata | undefined { return lastByTarget.get(target); }
```
- [ ] **Step 4: Render “上次实际发送（仅元数据）” next to “当前预览”, with a non-blocking notice only when configured `maxContext` exists and estimated usage is high; do not show a ratio when it is absent.**
- [ ] **Step 5: Run green:** metadata and context tests, `pnpm lint`, `pnpm build`, `pnpm test:unit`; inspect that no API Key or prompt body is stored; commit Task 4 files only.

## Handoff to the next three plans

After Task 4 is verified, write separate executable plans from the approved design for: (1) precise committed-turn receipt projections; (2) storage attribution and backup reminders; (3) content registry validation and failure diagnostics. Each must be independently testable and must not change the no-hard-limit rule.
