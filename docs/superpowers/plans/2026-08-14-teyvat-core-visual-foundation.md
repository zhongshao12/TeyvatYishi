# Teyvat Core and Adventurer Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有“旧崩铁模型 + 原神显示名”的运行时重构为唯一的提瓦特领域状态，并交付可供后续探索、战斗和养成直接复用的“冒险者手账”视觉基座。

**Architecture:** 采用单向边界迁移：旧数据只进入 `compat/legacy-hsr/`，通过分类、预览、用户消歧和原子迁移生成 `TeyvatGameState`；新运行时、提示词、UI 和存档只能依赖 `models/teyvat/`。保留现有主剧情、恢复日志、记忆、剧情编织、存档树和后台队列，但通过新的提瓦特接口读写。

**Tech Stack:** React 19、TypeScript 5.8 strict、Vite 6、Tailwind CSS 3、IndexedDB、Vitest 3、Storybook 10、Tauri 2、Cloudflare Pages、pnpm 10+、Node.js 22+

## Global Constraints

- `ElementId` 只允许 `anemo | geo | electro | dendro | hydro | pyro | cryo`；深渊属于 `PowerSource`，不是元素。
- 玩家是自定义旅行者；空与荧是两个独立原著角色，不能复用玩家身份字段。
- 原著魔神任务是可偏离轨道；已成立玩家事实优先，偏离必须保存证据、影响和回归可能。
- 真正的崩铁存档只能只读查看或导出；不得自动改写成提瓦特剧情。
- 部分原神化存档必须先备份，再原子迁移；无法确定的元素或星级必须要求用户消歧。
- 新运行时、提示词、业务 UI 和新存档不得出现白名单外的命途、光锥、黑塔、星穹、忆庭或手机语义。
- 全局视觉使用暖羊皮、水彩地区背景、皮革/木质边框和旅行青绿；危机态可局部使用暗色魔导书风格。
- 不打包原神官方立绘、截图、字体、Logo、语音或音乐；所有新增资产必须有来源记录。
- 本计划不实现可操作地图、元素反应战斗、敌人 AI、队伍切换、角色突破、圣遗物强化或祈愿系统。
- 保持 `kaituoyishi`、`KaiTuoYiShi`、Tauri identifier 和 Cloudflare project name 等基础设施标识稳定；只升级存档 `universe/schemaVersion`。
- 每个任务先写失败测试，再写最小实现；任务结束运行其专属测试并提交一次。
- 当前工作目录缺少 Git 元数据；执行环境若仍非 Git 仓库，不得运行 `git init`，只记录计划中的提交信息并继续验证。

---

## File Structure

### New domain files

- `models/teyvat/elements.ts`：七元素、力量来源和元素亲和模型。
- `models/teyvat/character.ts`：自定义旅行者、原著旅行者、NPC 和天赋模型。
- `models/teyvat/items.ts`：物品分类、星级、圣遗物五部位和背包模型。
- `models/teyvat/world.ts`：提瓦特世界、地区和未来探索接口。
- `models/teyvat/courier.ts`：信使联系人、会话、信件和来信种子。
- `models/teyvat/irminsul.ts`：世界树记忆条目和归一化。
- `models/teyvat/steambird.ts`：蒸汽鸟报条目和公开信息边界。
- `models/teyvat/codex.ts`：图鉴分类和条目。
- `models/teyvat/canon.ts`：原著轨道、偏离记录和影响模型。
- `models/teyvat/runtimeSlices.ts`：聊天、记忆、相册、任务和后台队列的提瓦特中立运行时切片。
- `models/teyvat/opening.ts`：六个开局预设和开局工厂输入。
- `models/teyvat/state.ts`：唯一 `TeyvatGameState`、`TeyvatSaveData` 和创建/归一化入口。
- `models/teyvat/domainCommand.ts`：提瓦特领域命令及结果。
- `models/teyvat/index.ts`：唯一公共导出面。

### Compatibility and migration files

- `compat/legacy-hsr/types.ts`：旧存档最小只读形状。
- `compat/legacy-hsr/classify.ts`：存档宇宙分类。
- `compat/legacy-hsr/migrate.ts`：部分原神化存档迁移。
- `compat/legacy-hsr/report.ts`：迁移报告和用户消歧项。

### New services and UI files

- `services/elementalAttunementService.ts`：元素亲和、突破准备和元素回响状态机。
- `services/teyvatOpeningFactory.ts`：从开局预设创建完整提瓦特状态。
- `services/canonDeviationService.ts`：创建、合并和注入偏离记录。
- `services/teyvatTurnTransaction.ts`：纯函数领域结算和原子提交。
- `services/ai/narrativeTurnParser.ts`：新 `NarrativeTurn` 协议解析。
- `components/features/SaveLoad/LegacyUniverseSaveCard.tsx`：真正崩铁存档只读/导出卡片。
- `components/features/SaveLoad/SaveMigrationDialog.tsx`：部分原神化存档迁移预览和消歧。
- `components/layout/RegionBackdrop.tsx`：地区、时间、天气和危机背景层。
- `components/layout/JournalCharacterBookmark.tsx`：桌面人物书签。
- `components/layout/JournalSystemTabs.tsx`：桌面索引签和移动底部书签。
- `styles/adventurer-journal-tokens.css`：手账设计令牌。
- `styles/adventurer-journal.css`：材质、布局和响应式样式。
- `data/regionVisuals.ts`：地区视觉配置和资产引用。
- `public/assets/regions/manifest.json`：资产来源、许可证和用途清单。
- `scripts/teyvat-runtime-language-audit.mjs`：旧术语运行时门禁。

---

### Task 1: Add the seven-element and character domain

**Files:**
- Create: `models/teyvat/elements.ts`
- Create: `models/teyvat/character.ts`
- Create: `models/teyvat/index.ts`
- Test: `tests/unit/teyvatElements.test.ts`

**Interfaces:**
- Produces: `ElementId`, `PowerSource`, `ElementalAttunement`, `Talent`, `TravelerProfile`, `CanonicalTravelerProfile`, `TeyvatNpcRecord`, `createEmptyTravelerProfile()`, `normalizeElementalAttunement()`.
- Consumes: no new project interface.

- [ ] **Step 1: Write the failing domain test**

```ts
import { describe, expect, it } from 'vitest';
import { ELEMENT_IDS, normalizeElementalAttunement } from '@/models/teyvat/elements';

describe('teyvat element domain', () => {
  it('contains exactly the seven canonical elements', () => {
    expect(ELEMENT_IDS).toEqual(['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo']);
    expect(ELEMENT_IDS).not.toContain('abyss');
  });

  it('clamps gameplay mastery without inventing a lore rank', () => {
    expect(normalizeElementalAttunement({ element: 'anemo', source: 'traveler_resonance', mastery: 140 })).toMatchObject({ mastery: 100 });
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `pnpm vitest run tests/unit/teyvatElements.test.ts`  
Expected: FAIL because `@/models/teyvat/elements` does not exist.

- [ ] **Step 3: Implement the minimal element and character types**

```ts
export const ELEMENT_IDS = ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'] as const;
export type ElementId = typeof ELEMENT_IDS[number];
export type PowerSource = 'vision' | 'traveler_resonance' | 'adeptal' | 'divine' | 'abyssal' | 'other';

export interface ElementalAttunement {
  element: ElementId;
  source: PowerSource;
  mastery: number;
  unlocked: boolean;
  unlockedAt: string;
  notes: string;
}

export function normalizeElementalAttunement(input: Partial<ElementalAttunement>): ElementalAttunement {
  if (!ELEMENT_IDS.includes(input.element as ElementId)) throw new Error('INVALID_ELEMENT_ID');
  return {
    element: input.element as ElementId,
    source: input.source ?? 'other',
    mastery: Math.max(0, Math.min(100, Number(input.mastery) || 0)),
    unlocked: input.unlocked !== false,
    unlockedAt: String(input.unlockedAt ?? ''),
    notes: String(input.notes ?? ''),
  };
}
```

In `character.ts`, define `TalentCategory = 'normal_attack' | 'elemental_skill' | 'elemental_burst' | 'passive'`, keep existing basic Chinese profile fields, and use `元素共鸣`, `主元素`, and `天赋` rather than `命途列表`, `主命途`, or `战技列表`.

- [ ] **Step 4: Run the focused test and TypeScript build**

Run: `pnpm vitest run tests/unit/teyvatElements.test.ts && pnpm build`  
Expected: PASS; no strict-mode errors in the new domain files.

- [ ] **Step 5: Commit the domain foundation**

```bash
git add models/teyvat/elements.ts models/teyvat/character.ts models/teyvat/index.ts tests/unit/teyvatElements.test.ts
git commit -m "feat: add teyvat element and character domain"
```

### Task 2: Add world, inventory, extension systems, and `TeyvatGameState`

**Files:**
- Create: `models/teyvat/items.ts`
- Create: `models/teyvat/world.ts`
- Create: `models/teyvat/courier.ts`
- Create: `models/teyvat/irminsul.ts`
- Create: `models/teyvat/steambird.ts`
- Create: `models/teyvat/codex.ts`
- Create: `models/teyvat/canon.ts`
- Create: `models/teyvat/runtimeSlices.ts`
- Create: `models/teyvat/state.ts`
- Modify: `models/teyvat/index.ts`
- Test: `tests/unit/teyvatState.test.ts`

**Interfaces:**
- Consumes: Task 1 `TravelerProfile`, `TeyvatNpcRecord`, `ElementId`.
- Produces: `ItemCategory`, `ItemRarity`, `ArtifactSlot`, `TeyvatInventory`, `RegionId`, `TeyvatWorld`, `CourierSystem`, `IrminsulMemory`, `SteambirdNews`, `ArchiveCodex`, `CanonDeviation`, `CanonTrack`, `ConversationLog`, `MemoryLedger`, `JourneyAlbum`, `QuestJournal`, `BackgroundQueueState`, `TeyvatGameState`, `TeyvatSaveData`, `createEmptyTeyvatGameState()`, `normalizeTeyvatGameState()`.

- [ ] **Step 1: Write the failing state invariant test**

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat';

it('creates the only writable universe state', () => {
  const state = createEmptyTeyvatGameState();
  expect(state.universe).toBe('teyvat');
  expect(state.schemaVersion).toBe(2);
  expect(state).toHaveProperty('信使');
  expect(state).not.toHaveProperty('手机');
  expect(state).not.toHaveProperty('忆庭');
});

it('rejects a non-teyvat runtime state', () => {
  expect(() => normalizeTeyvatGameState({ universe: 'hsr' })).toThrow('UNSUPPORTED_RUNTIME_UNIVERSE');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run tests/unit/teyvatState.test.ts`  
Expected: FAIL because the state module is missing.

- [ ] **Step 3: Implement the focused state files**

Use this exact state root:

```ts
export const TEYVAT_SCHEMA_VERSION = 2 as const;

export interface TeyvatGameState {
  universe: 'teyvat';
  schemaVersion: typeof TEYVAT_SCHEMA_VERSION;
  turnCount: number;
  旅行者: TravelerProfile;
  世界: TeyvatWorld;
  NPC: TeyvatNpcRecord[];
  背包: TeyvatInventory;
  信使: CourierSystem;
  世界树: IrminsulMemory;
  图鉴: ArchiveCodex;
  蒸汽鸟报: SteambirdNews;
  原著轨道: CanonTrack;
  对话: ConversationLog;
  记忆: MemoryLedger;
  相册: JourneyAlbum;
  任务: QuestJournal;
  后台队列: BackgroundQueueState;
}
```

Define item categories as `weapon | artifact | food | material | gadget | quest | furnishing`; define `ItemRarity = 1 | 2 | 3 | 4 | 5`; define artifact slots as `flower | plume | sands | goblet | circlet`. In `canon.ts`, define `CanonDeviation` and `CanonTrack` before `state.ts` imports them. In `runtimeSlices.ts`, port the existing neutral chat, album, memory, task, recovery-log and queue fields into the five new slices, removing fields whose enums or examples depend on the old universe. `TeyvatGameState` is the only mutable root from this task onward; do not keep sidecar state or deprecated aliases.

- [ ] **Step 4: Run state tests and build**

Run: `pnpm vitest run tests/unit/teyvatElements.test.ts tests/unit/teyvatState.test.ts && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit the complete state model**

```bash
git add models/teyvat tests/unit/teyvatState.test.ts
git commit -m "feat: define teyvat runtime state"
```

### Task 3: Classify and migrate legacy saves without overwriting originals

**Files:**
- Create: `compat/legacy-hsr/types.ts`
- Create: `compat/legacy-hsr/report.ts`
- Create: `compat/legacy-hsr/classify.ts`
- Create: `compat/legacy-hsr/migrate.ts`
- Test: `tests/unit/legacySaveMigration.test.ts`
- Test fixture: `tests/fixtures/saves/partial-teyvat-save.json`
- Test fixture: `tests/fixtures/saves/legacy-hsr-save.json`

**Interfaces:**
- Consumes: Task 1 `ElementId`; Task 2 `TeyvatGameState`, `normalizeTeyvatGameState()`.
- Produces: `classifySaveUniverse(input)`, `migratePartialTeyvatSave(input, resolutions)`, `SaveMigrationResult`, `MigrationIssue`, `MigrationReport`.

- [ ] **Step 1: Write classification and atomicity tests**

```ts
expect(classifySaveUniverse({ universe: 'teyvat', schemaVersion: 2 })).toBe('teyvat');
expect(classifySaveUniverse(legacyHsrFixture)).toBe('legacy-hsr');
expect(classifySaveUniverse(partialTeyvatFixture)).toBe('partial-teyvat');

const unresolved = migratePartialTeyvatSave({ 旅人: { 主命途: 'nihility' } }, {});
expect(unresolved.status).toBe('needs-input');
expect(unresolved).not.toHaveProperty('state');
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `pnpm vitest run tests/unit/legacySaveMigration.test.ts`  
Expected: FAIL because the compatibility modules and fixtures are missing.

- [ ] **Step 3: Implement explicit classification and deterministic mappings**

```ts
export type SaveUniverseClass = 'teyvat' | 'partial-teyvat' | 'legacy-hsr' | 'unknown';

export const LEGACY_PATH_ELEMENT_MAP = {
  hunt: 'electro', destruction: 'pyro', preservation: 'geo', abundance: 'dendro',
  remembrance: 'cryo', erudition: 'hydro', elation: 'anemo',
} as const;

export type SaveMigrationResult =
  | { status: 'migrated'; state: TeyvatGameState; report: MigrationReport }
  | { status: 'needs-input'; issues: MigrationIssue[]; report: MigrationReport }
  | { status: 'legacy-universe'; raw: unknown; report: MigrationReport }
  | { status: 'invalid'; errors: string[]; report: MigrationReport };
```

Classify explicit `universe` first. For unmarked saves, require at least two independent signals before declaring `legacy-hsr` or `partial-teyvat`; examples are an opening region ID plus a known location, or a known legacy character plus a legacy story series. Never classify from one free-text match.

- [ ] **Step 4: Run the migration test and verify source fixtures are unchanged**

Run: `pnpm vitest run tests/unit/legacySaveMigration.test.ts`  
Expected: PASS, including a deep-equality assertion showing the input object was not mutated.

- [ ] **Step 5: Commit the compatibility boundary**

```bash
git add compat/legacy-hsr tests/unit/legacySaveMigration.test.ts tests/fixtures/saves
git commit -m "feat: add atomic legacy save migration"
```

### Task 4: Version local packages and cloud backups by universe and schema

**Files:**
- Create: `models/teyvat/save.ts`
- Modify: `models/teyvat/index.ts`
- Modify: `models/settings.ts`
- Modify: `services/savePackage.ts`
- Modify: `services/cloudBackupPackage.ts`
- Modify: `services/cloudBackupBuilder.ts`
- Modify: `services/cloudBackupMerge.ts`
- Modify: `services/storage/saveCatalog.ts`
- Test: `tests/unit/teyvatSaveContract.test.ts`
- Modify: `scripts/save-package-regression.mjs`
- Modify: `scripts/cloud-backup-package-regression.mjs`

**Interfaces:**
- Consumes: Tasks 2–3 state and migration result.
- Produces: `TeyvatSaveData`, `TeyvatSaveManifest`, `ParsedSavePackage`, `parseSavePackageByUniverse()`, catalog `universe/schemaVersion` fields.

- [ ] **Step 1: Write failing package contract tests**

```ts
const blob = await buildSavePackage(teyvatSave);
const parsed = await parseSavePackageByUniverse(await blob.arrayBuffer());
expect(parsed.kind).toBe('teyvat');
expect(parsed.manifest).toMatchObject({ universe: 'teyvat', schemaVersion: 2 });
expect(JSON.stringify(parsed)).not.toMatch(/"主命途"|"命途列表"|"手机"|"忆庭"/);
```

Also assert that a fixture with `universe: 'hsr'` returns `{ kind: 'legacy-hsr' }` and is not passed to `normalizeTeyvatGameState()`.

- [ ] **Step 2: Run focused save tests and verify failure**

Run: `pnpm vitest run tests/unit/teyvatSaveContract.test.ts`  
Expected: FAIL because package manifests do not contain universe/schema fields.

- [ ] **Step 3: Add manifest fields and parsing union**

```ts
export interface TeyvatSaveManifest {
  app: 'KaiTuoYiShi';
  kind: 'save-package' | 'save-tree-package';
  format: 'ktysave';
  packageVersion: number;
  universe: 'teyvat';
  schemaVersion: 2;
  files: string[];
}

export type ParsedSavePackage =
  | { kind: 'teyvat'; manifest: TeyvatSaveManifest; save: TeyvatSaveData }
  | { kind: 'partial-teyvat'; raw: unknown; migration: SaveMigrationResult }
  | { kind: 'legacy-hsr'; raw: unknown }
  | { kind: 'invalid'; errors: string[] };
```

Update catalog records and cloud node fingerprints to include `universe` and `schemaVersion`. A merge must reject cross-universe nodes before staging any writes.

- [ ] **Step 4: Run package, cloud, and build checks**

Run: `pnpm vitest run tests/unit/teyvatSaveContract.test.ts && node scripts/save-package-regression.mjs && node scripts/cloud-backup-package-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit save version isolation**

```bash
git add models/teyvat/save.ts models/teyvat/index.ts models/settings.ts services/savePackage.ts services/cloudBackupPackage.ts services/cloudBackupBuilder.ts services/cloudBackupMerge.ts services/storage/saveCatalog.ts tests/unit/teyvatSaveContract.test.ts scripts/save-package-regression.mjs scripts/cloud-backup-package-regression.mjs
git commit -m "feat: isolate teyvat save universe"
```

### Task 5: Cut the React runtime and save/load workflow over to `TeyvatGameState`

**Files:**
- Create: `hooks/useTeyvatRuntime.ts`
- Modify: `models/teyvat/character.ts`
- Modify: `models/teyvat/world.ts`
- Modify: `models/teyvat/courier.ts`
- Modify: `models/teyvat/items.ts`
- Modify: `models/teyvat/irminsul.ts`
- Modify: `models/teyvat/codex.ts`
- Modify: `models/teyvat/steambird.ts`
- Modify: `models/teyvat/runtimeSlices.ts`
- Modify: `models/teyvat/state.ts`
- Modify: `compat/legacy-hsr/types.ts`
- Modify: `compat/legacy-hsr/migrate.ts`
- Modify: `services/savePackage.ts`
- Modify: `services/dbService.ts`
- Modify: `hooks/useGameState.ts`
- Modify: `hooks/useGame/saveLoadWorkflow.ts`
- Modify: `hooks/useGame.ts`
- Modify: `App.tsx`
- Test: `tests/unit/teyvatRuntimeReducer.test.ts`
- Modify: `scripts/save-isolation-regression.mjs`

**Interfaces:**
- Consumes: Task 2 `TeyvatGameState`; Task 4 `TeyvatSaveData`.
- Produces: `useTeyvatRuntime()`, `replaceGameState(next)`, `updateGameState(updater)`, `buildTeyvatSavePayload()`.

- [ ] **Step 1: Write the pure runtime reducer test**

```ts
const initial = createEmptyTeyvatGameState();
const next = updateTeyvatState(initial, (draft) => ({
  ...draft,
  世界: { ...draft.世界, 当前地点: '蒙德城' },
}));
expect(next.世界.当前地点).toBe('蒙德城');
expect(initial.世界.当前地点).not.toBe('蒙德城');
```

- [ ] **Step 2: Run the reducer test and verify failure**

Run: `pnpm vitest run tests/unit/teyvatRuntimeReducer.test.ts`  
Expected: FAIL because the runtime hook/reducer is missing.

- [ ] **Step 3: Introduce one game-state atom and update save loading**

```ts
const [game, setGame] = useState<TeyvatGameState>(createEmptyTeyvatGameState);

const updateGameState = useCallback((updater: (current: TeyvatGameState) => TeyvatGameState) => {
  setGame((current) => normalizeTeyvatGameState(updater(current)));
}, []);
```

`applySaveToState()` must parse and fully normalize a temporary `nextGame` before calling `replaceGameState(nextGame)`. Remove direct sequential setters for `旅人/世界/手机/忆庭/智库/新闻`; neutral UI settings and API settings remain separate local configuration.

**Approved sequencing amendment (user ruling A):** Before the React cutover, expand the schema-2 Teyvat slices with neutral fields required by the existing runtime: traveler attributes/capabilities, opening and narrative-mode metadata, time periods and world events, structured response/snapshot/token/debug chat metadata, failed memory drafts, courier conversation seeds, plot state, story-weaving state, and variable batches. Use Teyvat-neutral field names and types; do not store legacy model objects, deprecated aliases, or a `legacyRuntime` slice. Add a pure DB-record classification/migration entry that maps old records through `compat/legacy-hsr/` into a complete temporary `TeyvatGameState`. Only after normalization succeeds may `replaceGameState()` run once.

- [ ] **Step 4: Run runtime, save isolation, and build checks**

Run: `pnpm vitest run tests/unit/teyvatRuntimeReducer.test.ts && node scripts/save-isolation-regression.mjs && pnpm build`  
Expected: PASS; no partial state writes occur before validation.

- [ ] **Step 5: Commit the runtime cutover**

```bash
git add hooks/useTeyvatRuntime.ts hooks/useGameState.ts hooks/useGame/saveLoadWorkflow.ts hooks/useGame.ts App.tsx tests/unit/teyvatRuntimeReducer.test.ts scripts/save-isolation-regression.mjs
git commit -m "refactor: use a single teyvat runtime state"
```

### Task 6: Add migration preview and true legacy read-only UI

**Files:**
- Create: `components/features/SaveLoad/LegacyUniverseSaveCard.tsx`
- Create: `components/features/SaveLoad/SaveMigrationDialog.tsx`
- Modify: `components/features/SaveLoad/SaveLoadModal.tsx`
- Modify: `services/exportService.ts`
- Test: `stories/SaveMigrationDialog.stories.tsx`
- Create: `scripts/save-migration-ui-regression.mjs`

**Interfaces:**
- Consumes: Task 3 `SaveMigrationResult`, `MigrationIssue`; Task 4 parsed package union.
- Produces: user resolutions `Record<string, ElementId | ItemRarity>`, read-only export action, atomic “confirm migration” action.

- [ ] **Step 1: Write the failing UI regression**

```js
assert.match(source, /旧宇宙存档/);
assert.match(source, /只读查看/);
assert.match(source, /导出原档/);
assert.match(dialogSource, /选择初始元素/);
assert.doesNotMatch(dialogSource, /自动转换剧情/);
```

- [ ] **Step 2: Run the regression and verify failure**

Run: `node scripts/save-migration-ui-regression.mjs`  
Expected: FAIL because the UI components are absent.

- [ ] **Step 3: Implement the two explicit flows**

```tsx
if (parsed.kind === 'legacy-hsr') {
  return <LegacyUniverseSaveCard onExport={() => exportRawSave(parsed.raw)} />;
}
if (parsed.kind === 'partial-teyvat' && parsed.migration.status === 'needs-input') {
  return <SaveMigrationDialog issues={parsed.migration.issues} onConfirm={runResolvedMigration} />;
}
```

Disable the confirm button until every issue has a resolution. Display the source backup identifier and migration report before the write call.

- [ ] **Step 4: Run UI regression, Storybook build, and production build**

Run: `node scripts/save-migration-ui-regression.mjs && pnpm build-storybook && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit migration UI**

```bash
git add components/features/SaveLoad services/exportService.ts stories/SaveMigrationDialog.stories.tsx scripts/save-migration-ui-regression.mjs
git commit -m "feat: add safe save migration UI"
```

### Task 7: Replace path and skill semantics with elements and talents

**Files:**
- Create: `services/elementalAttunementService.ts`
- Create: `models/teyvat/opening.ts`
- Create: `services/teyvatOpeningFactory.ts`
- Modify: `data/journeyPresets.ts`
- Modify: `components/features/NewGame/NewGameWizard.tsx`
- Modify: `components/features/GameSystems/PathPanel.tsx`
- Modify: `components/features/GameSystems/SkillPanel.tsx`
- Modify: `components/features/Path/PathAwakeningInvitation.tsx`
- Modify: `components/features/Path/PathDebugView.tsx`
- Modify: `components/features/Chat/TurnItem.tsx`
- Modify: `data/gameMenu.ts`
- Modify: `models/index.ts`
- Remove after callers migrate: `models/path.ts`
- Remove after callers migrate: `models/skill.ts`
- Remove after callers migrate: `models/journey.ts`
- Remove after callers migrate: `services/pathService.ts`
- Test: `tests/unit/elementalAttunementService.test.ts`
- Modify: `scripts/skill-system-regression.mjs`
- Modify: `scripts/opening-preset-regression.mjs`

**Interfaces:**
- Consumes: Task 1 element, traveler and talent types.
- Produces: `advanceElementalMastery()`, `unlockElement()`, `setPrimaryElement()`, `enterElementalEcho()`, `applyElementalEchoResult()`, `OFFICIAL_OPENING_PRESETS`, `createTeyvatGameFromOpeningPreset()`.

- [ ] **Step 1: Write failing service tests**

```ts
const traveler = createEmptyTravelerProfile();
const unlocked = unlockElement(traveler, 'anemo', { source: 'traveler_resonance', unlockedAt: '1日 08:00' });
expect(unlocked.元素共鸣[0].element).toBe('anemo');
expect(unlocked).not.toHaveProperty('命途列表');
expect(advanceElementalMastery(unlocked, 'anemo', 120).元素共鸣[0].mastery).toBe(100);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run tests/unit/elementalAttunementService.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement pure services and migrate UI labels/props**

```ts
export function setPrimaryElement(traveler: TravelerProfile, element: ElementId): TravelerProfile {
  if (!traveler.元素共鸣.some((entry) => entry.element === element && entry.unlocked)) {
    throw new Error('ELEMENT_NOT_UNLOCKED');
  }
  return { ...traveler, 主元素: element };
}
```

Rename component props to `traveler.元素共鸣`, `traveler.天赋`, `关联元素`, and “元素回响”. Do not retain a hidden `harmony` or `nihility` option. The seven official elements are the complete selection list.

Move the six preset types and values into `models/teyvat/opening.ts`. Implement `createTeyvatGameFromOpeningPreset(presetId)` in `services/teyvatOpeningFactory.ts`; it must start from `createEmptyTeyvatGameState()`, apply only the selected region/location/identity seed, and return a normalized `TeyvatGameState`. After every caller imports the new contracts, delete the three old model files and the old path service.

- [ ] **Step 4: Run element, opening, skill, and build checks**

Run: `pnpm vitest run tests/unit/elementalAttunementService.test.ts && node scripts/opening-preset-regression.mjs && node scripts/skill-system-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit the element/talent cutover**

```bash
git add services/elementalAttunementService.ts services/teyvatOpeningFactory.ts models/teyvat/opening.ts models/index.ts data/journeyPresets.ts data/gameMenu.ts components/features/NewGame components/features/GameSystems/PathPanel.tsx components/features/GameSystems/SkillPanel.tsx components/features/Path components/features/Chat/TurnItem.tsx tests/unit/elementalAttunementService.test.ts scripts/skill-system-regression.mjs scripts/opening-preset-regression.mjs
git rm services/pathService.ts models/path.ts models/skill.ts models/journey.ts
git commit -m "refactor: replace paths with elemental attunement"
```

### Task 8: Replace light-cone inventory semantics with real artifacts and item rarity

**Files:**
- Modify: `models/teyvat/items.ts`
- Modify: `utils/inventoryActions.ts`
- Modify: `utils/variableRegistry.ts`
- Modify: `utils/variableExecutor.ts`
- Modify: `components/features/GameSystems/InventoryPanel.tsx`
- Modify: `hooks/useGame/systemPromptBuilder.ts`
- Retire after imports migrate: `models/inventory.ts`
- Test: `tests/unit/teyvatInventory.test.ts`
- Modify: `scripts/inventory-variable-regression.mjs`
- Modify: `scripts/equipment-retirement-regression.mjs`

**Interfaces:**
- Consumes: Task 2 `TeyvatInventory`, `TeyvatItem`, `ArtifactSlot`, `ItemRarity`.
- Produces: `normalizeTeyvatItem()`, `addInventoryItem()`, `consumeInventoryItem()`, artifact slot validation.

- [ ] **Step 1: Write failing inventory tests**

```ts
expect(normalizeTeyvatItem({ category: 'artifact', name: '行者之心', rarity: 5, slot: 'flower' })).toMatchObject({ rarity: 5, slot: 'flower' });
expect(() => normalizeTeyvatItem({ category: 'artifact', name: '错误圣遗物', rarity: 6 })).toThrow('INVALID_ITEM_RARITY');
expect(JSON.stringify(addInventoryItem(empty, artifact))).not.toMatch(/lightcone|蓝|紫|金/);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run tests/unit/teyvatInventory.test.ts`  
Expected: FAIL against the old category and quality model.

- [ ] **Step 3: Implement item normalization and update command examples**

```ts
export const ITEM_RARITIES = [1, 2, 3, 4, 5] as const;
export const ARTIFACT_SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const;
```

Change variable paths from `旅行者.背包` to root `背包.items`; require `rarity` as an integer. The prompt example must use a real neutral item such as `{"category":"food","name":"提瓦特煎蛋","rarity":1,"quantity":2}`.

- [ ] **Step 4: Run inventory regressions and build**

Run: `pnpm vitest run tests/unit/teyvatInventory.test.ts && node scripts/inventory-variable-regression.mjs && node scripts/equipment-retirement-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit inventory semantics**

```bash
git add models/teyvat/items.ts utils/inventoryActions.ts utils/variableRegistry.ts utils/variableExecutor.ts components/features/GameSystems/InventoryPanel.tsx hooks/useGame/systemPromptBuilder.ts tests/unit/teyvatInventory.test.ts scripts/inventory-variable-regression.mjs scripts/equipment-retirement-regression.mjs
git rm models/inventory.ts
git commit -m "refactor: add artifact and teyvat item inventory"
```

### Task 9: Cut over courier, Irminsul, Steambird, and codex systems

**Files:**
- Create: `services/ai/courierService.ts`
- Create: `services/ai/steambirdModel.ts`
- Create: `services/irminsulArchive.ts`
- Create: `services/irminsulRetrieval.ts`
- Create: `services/codexRetrieval.ts`
- Create: `services/codexAiRetrievalIndex.ts`
- Create: `hooks/useGame/courierWorkflow.ts`
- Create: `hooks/useGame/steambirdWorkflow.ts`
- Create: `components/features/Courier/CourierModal.tsx`
- Create: `components/features/GameSystems/SteambirdPanel.tsx`
- Create: `components/features/GameSystems/IrminsulPanel.tsx`
- Create: `components/features/Codex/productionAdapter.ts`
- Modify: all import sites that reference the replaced modules
- Remove after callers migrate: `services/ai/phoneService.ts`, `services/ai/newsModel.ts`
- Remove after callers migrate: `services/yitingArchive.ts`, `services/yitingRetrieval.ts`
- Remove after callers migrate: `services/zhikuRetrieval.ts`, `services/zhikuAiRetrievalIndex.ts`
- Remove after callers migrate: `hooks/useGame/phoneWorkflow.ts`, `hooks/useGame/newsWorkflow.ts`
- Remove after callers migrate: `components/features/Phone/PhoneModal.tsx`
- Remove after callers migrate: `components/features/GameSystems/NewsPanel.tsx`, `components/features/GameSystems/YitingPanel.tsx`
- Remove after callers migrate: `components/features/ZhikuV2/productionAdapter.ts`
- Test: `tests/unit/teyvatExtensionSystems.test.ts`
- Create: `scripts/courier-memory-seed-regression.mjs`
- Create: `scripts/steambird-update-regression.mjs`
- Create: `scripts/irminsul-archive-regression.mjs`
- Retire after replacements pass: `scripts/phone-memory-seed-regression.mjs`, `scripts/news-update-regression.mjs`, `scripts/yiting-archive-regression.mjs`

**Interfaces:**
- Consumes: Task 2 `CourierSystem`, `IrminsulMemory`, `SteambirdNews`, `ArchiveCodex`.
- Produces: services that accept and return only the new system types.

- [ ] **Step 1: Write failing normalization and information-boundary tests**

```ts
expect(createEmptyCourierSystem()).toMatchObject({ contacts: [], conversations: [], unreadTotal: 0 });
expect(createEmptyIrminsulMemory()).toEqual({ entries: [] });
expect(normalizeSteambirdArticle({ visibility: 'private' })).toBeNull();
expect(JSON.stringify(createEmptyCourierSystem())).not.toMatch(/手机/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run tests/unit/teyvatExtensionSystems.test.ts`  
Expected: FAIL until all new system creators exist.

- [ ] **Step 3: Update services and UI to the new contracts**

Use `CourierMessage`, `CourierConversation`, `IrminsulEntry`, `SteambirdArticle`, and `CodexEntry` at service boundaries. Preserve existing private/group/system conversation behavior and unread calculations, but remove phone hardware language from visible copy and prompt inputs. Steambird generation must receive only `publicFacts`. Rename every import, exported symbol, React component, workflow and service at the same boundary; old names are not accepted as runtime aliases.

- [ ] **Step 4: Run extension-system regressions and build**

Run: `pnpm vitest run tests/unit/teyvatExtensionSystems.test.ts && node scripts/courier-memory-seed-regression.mjs && node scripts/steambird-update-regression.mjs && node scripts/irminsul-archive-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit extension-system cutover**

```bash
git add models/teyvat services/ai/courierService.ts services/ai/steambirdModel.ts services/irminsulArchive.ts services/irminsulRetrieval.ts services/codexRetrieval.ts services/codexAiRetrievalIndex.ts hooks/useGame/courierWorkflow.ts hooks/useGame/steambirdWorkflow.ts components/features/Courier/CourierModal.tsx components/features/GameSystems/SteambirdPanel.tsx components/features/GameSystems/IrminsulPanel.tsx components/features/Codex/productionAdapter.ts tests/unit/teyvatExtensionSystems.test.ts scripts/courier-memory-seed-regression.mjs scripts/steambird-update-regression.mjs scripts/irminsul-archive-regression.mjs
git rm services/ai/phoneService.ts services/ai/newsModel.ts services/yitingArchive.ts services/yitingRetrieval.ts services/zhikuRetrieval.ts services/zhikuAiRetrievalIndex.ts hooks/useGame/phoneWorkflow.ts hooks/useGame/newsWorkflow.ts components/features/Phone/PhoneModal.tsx components/features/GameSystems/NewsPanel.tsx components/features/GameSystems/YitingPanel.tsx components/features/ZhikuV2/productionAdapter.ts scripts/phone-memory-seed-regression.mjs scripts/news-update-regression.mjs scripts/yiting-archive-regression.mjs
git commit -m "refactor: migrate teyvat extension systems"
```

### Task 10: Add canon deviation records to story weaving

**Files:**
- Modify: `models/teyvat/canon.ts`
- Create: `services/canonDeviationService.ts`
- Modify: `models/teyvat/state.ts`
- Modify: `services/storyWeaving.ts`
- Modify: `services/storyProgressService.ts`
- Modify: `services/storyWeavingConflict.ts`
- Modify: `data/storyWeavingPreset.ts`
- Modify: `components/features/GameSystems/PlotPanel.tsx`
- Test: `tests/unit/canonDeviationService.test.ts`
- Modify: `tests/unit/storyWeavingConflict.test.ts`

**Interfaces:**
- Consumes: Task 2 world/state plus `CanonTrack` and `CanonDeviation` definitions.
- Produces: `recordCanonDeviation()`, `mergeCanonDeviation()`, `buildCanonContextWindow()`.

- [ ] **Step 1: Write failing deviation tests**

```ts
const deviation = recordCanonDeviation(track, {
  anchorId: 'teyvat_prologue_mondstadt_act1',
  turn: 7,
  evidence: ['玩家提前救下关键证人'],
  affectedCharacters: ['安柏'],
  worldEffects: ['骑士团更早获得深渊线索'],
  returnability: 'conditional',
});
expect(deviation.status).toBe('diverged');
expect(buildCanonContextWindow(deviation)).toContain('不得重演原事件结果');
```

- [ ] **Step 2: Run deviation tests and verify failure**

Run: `pnpm vitest run tests/unit/canonDeviationService.test.ts`  
Expected: FAIL because the canon service does not exist.

- [ ] **Step 3: Implement immutable deviation recording and wire story progress**

```ts
export interface CanonDeviation {
  id: string;
  anchorId: string;
  turn: number;
  evidence: string[];
  affectedCharacters: string[];
  worldEffects: string[];
  blockedAnchorIds: string[];
  returnability: 'none' | 'conditional' | 'open';
}
```

Replace legacy HSR keyword fallback tables in `storyProgressService.ts` with Teyvat region/anchor IDs. Plot UI must display the evidence and affected downstream anchors.

- [ ] **Step 4: Run canon and conflict tests**

Run: `pnpm vitest run tests/unit/canonDeviationService.test.ts tests/unit/storyWeavingConflict.test.ts && pnpm test:story-weaving && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit canon deviation support**

```bash
git add models/teyvat/canon.ts models/teyvat/state.ts services/canonDeviationService.ts services/storyWeaving.ts services/storyProgressService.ts services/storyWeavingConflict.ts data/storyWeavingPreset.ts components/features/GameSystems/PlotPanel.tsx tests/unit/canonDeviationService.test.ts tests/unit/storyWeavingConflict.test.ts
git commit -m "feat: track player canon deviations"
```

### Task 11: Introduce the structured `NarrativeTurn` protocol

**Files:**
- Create: `models/teyvat/narrativeTurn.ts`
- Create: `services/ai/narrativeTurnParser.ts`
- Modify: `models/teyvat/index.ts`
- Modify: `models/chat.ts`
- Modify: `services/ai/responseParser.ts`
- Modify: `components/features/Chat/TurnItem.tsx`
- Test: `tests/unit/narrativeTurnParser.test.ts`
- Modify: `scripts/action-options-cleanup-regression.mjs`

**Interfaces:**
- Produces: `NarrativeTurn`, `StoryBlock`, `PlayerChoice`, `FactCandidate`, `ContinuationSummary`, `parseNarrativeTurn()`.
- Consumes: no later-task interface.

- [ ] **Step 1: Write failing parser tests**

```ts
const turn = parseNarrativeTurn(JSON.stringify({
  body: [{ kind: 'narration', text: '风穿过风起地的巨树。' }],
  choices: [{ id: 'follow_amber', label: '跟随安柏返回蒙德城' }],
  factCandidates: [{ domain: 'world', fact: '当前地点仍是风起地', evidence: '正文第一句' }],
  continuation: { summary: '安柏准备带玩家入城', unresolved: ['龙吼来源'] },
}));
expect(turn.body[0].text).toContain('风起地');
expect(JSON.stringify(turn)).not.toContain('thinking');
```

- [ ] **Step 2: Run the parser test and verify failure**

Run: `pnpm vitest run tests/unit/narrativeTurnParser.test.ts`  
Expected: FAIL because the parser is missing.

- [ ] **Step 3: Implement strict parsing with conservative repair**

```ts
export interface NarrativeTurn {
  body: StoryBlock[];
  choices: PlayerChoice[];
  factCandidates: FactCandidate[];
  continuation: ContinuationSummary;
}

export function parseNarrativeTurn(raw: string): NarrativeTurn {
  const value = parseJsonObjectWithSingleRepair(raw);
  return normalizeNarrativeTurn(value);
}
```

Keep the old tagged parser only inside a compatibility function for already stored chat history. New main responses must use the JSON contract and must not require `<thinking>`.

- [ ] **Step 4: Run parser, action-option, and build checks**

Run: `pnpm vitest run tests/unit/narrativeTurnParser.test.ts && node scripts/action-options-cleanup-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit narrative protocol**

```bash
git add models/teyvat/narrativeTurn.ts models/teyvat/index.ts models/chat.ts services/ai/narrativeTurnParser.ts services/ai/responseParser.ts components/features/Chat/TurnItem.tsx tests/unit/narrativeTurnParser.test.ts scripts/action-options-cleanup-regression.mjs
git commit -m "feat: add structured narrative turn protocol"
```

### Task 12: Add atomic domain commands and cut over `sendWorkflow`

**Files:**
- Create: `models/teyvat/domainCommand.ts`
- Create: `services/teyvatTurnTransaction.ts`
- Create: `utils/teyvatCommandRegistry.ts`
- Modify: `services/ai/variableModel.ts`
- Modify: `utils/variableFacts.ts`
- Modify: `hooks/useGame/sendWorkflow.ts`
- Modify: `services/workflowRecovery.ts`
- Test: `tests/unit/teyvatTurnTransaction.test.ts`
- Modify: `tests/unit/workflowRecoveryModel.test.ts`

**Interfaces:**
- Consumes: Task 2 `TeyvatGameState`; Task 11 `FactCandidate`.
- Produces: `TeyvatDomainCommand`, `reduceTeyvatTurn()`, `commitTeyvatTurn()`, `TeyvatTurnTransactionResult`.

- [ ] **Step 1: Write transaction rollback tests**

```ts
const result = reduceTeyvatTurn(initial, [
  { action: 'set', root: '世界', path: '当前地点', value: '蒙德城', evidence: '正文写明进城' },
  { action: 'set', root: '旅行者', path: '命途列表', value: [], evidence: '无' },
]);
expect(result.status).toBe('rejected');
expect(result.nextState).toBe(initial);
expect(result.errors[0].code).toBe('UNKNOWN_DOMAIN_PATH');
```

- [ ] **Step 2: Run transaction tests and verify failure**

Run: `pnpm vitest run tests/unit/teyvatTurnTransaction.test.ts`  
Expected: FAIL because the transaction layer is missing.

- [ ] **Step 3: Implement command whitelist and one-shot commit**

```ts
export type TeyvatDomainRoot = '旅行者' | '世界' | 'NPC' | '背包' | '任务' | '信使' | '原著轨道';

export interface TeyvatDomainCommand {
  action: 'set' | 'add' | 'sub' | 'push' | 'delete';
  root: TeyvatDomainRoot;
  path: string;
  value?: unknown;
  evidence: string;
}
```

`sendWorkflow` must store the parsed narrative as pending, reduce all synchronous commands against the frozen snapshot, and call `replaceGameState()` once only when every command succeeds. Background tasks receive the committed state and public facts. Add recovery stages `narrative_received`, `settlement_pending`, `settlement_committed`, and `autosave_committed`.

- [ ] **Step 4: Run transaction, recovery, and reroll checks**

Run: `pnpm vitest run tests/unit/teyvatTurnTransaction.test.ts tests/unit/workflowRecoveryModel.test.ts && pnpm test:reroll-snapshot && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit atomic settlement**

```bash
git add models/teyvat/domainCommand.ts services/teyvatTurnTransaction.ts utils/teyvatCommandRegistry.ts services/ai/variableModel.ts utils/variableFacts.ts hooks/useGame/sendWorkflow.ts services/workflowRecovery.ts tests/unit/teyvatTurnTransaction.test.ts tests/unit/workflowRecoveryModel.test.ts
git commit -m "refactor: settle teyvat turns atomically"
```

### Task 13: Rewrite main, opening, and elemental prompts around `NarrativeTurn`

**Files:**
- Create: `prompts/narrative/mainPrompt.ts`
- Create: `prompts/narrative/openingPrompt.ts`
- Create: `prompts/narrative/elementalEchoPrompt.ts`
- Remove after import migration: `prompts/cot/mainCot.ts`
- Remove after import migration: `prompts/cot/openingCot.ts`
- Remove after import migration: `prompts/cot/pathAwakeningCot.ts`
- Modify: `hooks/useGame/systemPromptBuilder.ts`
- Modify: `data/builtinPromptModules.ts`
- Modify: `data/openingWorldbookPreset.ts`
- Modify: `data/builtinWorldbookConfig.ts`
- Test: `tests/unit/teyvatPromptContract.test.ts`
- Modify: `scripts/prompt-context-regression.mjs`
- Modify: `scripts/opening-story-alignment-regression.mjs`

**Interfaces:**
- Consumes: Task 10 canon context; Task 11 `NarrativeTurn` schema.
- Produces: prompts that request only the new JSON shape and Teyvat concepts.

- [ ] **Step 1: Write failing prompt assertions**

```ts
const prompt = buildOpeningSystemPrompt(traveler, world, settings, 1, options).systemPrompt;
expect(prompt).toContain('NarrativeTurn');
expect(prompt).toContain('自定义旅行者');
expect(prompt).not.toMatch(/崩铁|星穹|舱内|命途|光锥|<thinking>/);
```

- [ ] **Step 2: Run prompt tests and verify current residuals fail**

Run: `pnpm vitest run tests/unit/teyvatPromptContract.test.ts`  
Expected: FAIL and identify the current HSR language.

- [ ] **Step 3: Replace prompt content and output contract**

The new top-level instruction must say:

```text
你是《旅行者纪事》的提瓦特叙事主持者。玩家是与空、荧并存的自定义旅行者。
只返回一个符合 NarrativeTurn schema 的 JSON 对象，不输出思维链、Markdown 代码块或额外标签。
原著锚点是可偏离参考；已成立玩家事实和 CanonDeviation 优先。
```

Replace “元素回响考试/七执政直接授力” with an introspective gameplay event that can unlock or deepen an attunement without asserting unsupported canon facts. Move all callers to `prompts/narrative/`; the runtime must not retain a `cot` entry point or require visible reasoning tags.

- [ ] **Step 4: Run prompt, opening, and build checks**

Run: `pnpm vitest run tests/unit/teyvatPromptContract.test.ts && node scripts/prompt-context-regression.mjs && node scripts/opening-story-alignment-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit core prompt rewrite**

```bash
git add prompts/narrative/mainPrompt.ts prompts/narrative/openingPrompt.ts prompts/narrative/elementalEchoPrompt.ts hooks/useGame/systemPromptBuilder.ts data/builtinPromptModules.ts data/openingWorldbookPreset.ts data/builtinWorldbookConfig.ts tests/unit/teyvatPromptContract.test.ts scripts/prompt-context-regression.mjs scripts/opening-story-alignment-regression.mjs
git rm prompts/cot/mainCot.ts prompts/cot/openingCot.ts prompts/cot/pathAwakeningCot.ts
git commit -m "refactor: rewrite core prompts for teyvat"
```

### Task 14: Rewrite subsystem prompts, AI examples, data, and image rules

**Files:**
- Create: `prompts/subsystems/domainCommandPrompt.ts`
- Create: `prompts/subsystems/domainCommandOutputFormat.ts`
- Create: `prompts/subsystems/steambirdPrompt.ts`
- Create: `prompts/subsystems/courierPrompt.ts`
- Create: `prompts/subsystems/courierOutputFormat.ts`
- Create: `prompts/subsystems/courierStyle.ts`
- Create: `prompts/subsystems/irminsulPrompt.ts`
- Create: `prompts/subsystems/codexPrompt.ts`
- Create: `prompts/subsystems/canonPrompt.ts`
- Create: `prompts/subsystems/canonOutputFormat.ts`
- Remove after import migration: `prompts/cot/variableCot.ts`, `prompts/cot/variableOutputFormat.ts`
- Remove after import migration: `prompts/cot/newsCot.ts`
- Remove after import migration: `prompts/cot/phoneCot.ts`, `prompts/cot/phoneOutputFormat.ts`, `prompts/cot/phoneStyle.ts`
- Remove after import migration: `prompts/cot/yitingCot.ts`, `prompts/cot/zhikuCot.ts`
- Remove after import migration: `prompts/cot/storyWeavingCot.ts`, `prompts/cot/storyWeavingOutputFormat.ts`
- Modify: `services/ai/variableModel.ts`
- Modify: `services/ai/steambirdModel.ts`
- Modify: `utils/imagePromptRules.ts`
- Modify: `models/settings.ts`
- Modify: `data/worldbookPresets.ts`
- Modify: `data/storyModeWorldbooks.ts`
- Test: `tests/unit/teyvatSubsystemPrompt.test.ts`
- Modify: `scripts/novelai-prompt-compiler-regression.mjs`

**Interfaces:**
- Consumes: Tasks 8–12 new domain and narrative contracts.
- Produces: subsystem prompts with no old-world examples and image style rules described by observable original traits.

- [ ] **Step 1: Write the failing subsystem prompt scan**

```ts
for (const prompt of [variablePrompt, newsPrompt, courierPrompt, irminsulPrompt, codexPrompt, weavingPrompt, imageRules]) {
  expect(prompt).not.toMatch(/崩坏：星穹铁道|黑塔空间站|帕姆|星际和平周报|命途|光锥|hsrBaseStyle/i);
}
expect(newsPrompt).toContain('蒸汽鸟报');
expect(courierPrompt).toContain('信使');
```

- [ ] **Step 2: Run the focused scan and verify failure**

Run: `pnpm vitest run tests/unit/teyvatSubsystemPrompt.test.ts`  
Expected: FAIL on the existing variable, news, image and setting defaults.

- [ ] **Step 3: Replace every old example with validated Teyvat examples**

Use examples such as 风起地、璃月港、安柏、凯瑟琳、提瓦特煎蛋 and丘丘人营地. Rename persisted image-rule fields from `hsrBaseStyle/hsrCharacterAnchorRule` to `journalFantasyBaseStyle/teyvatCharacterAnchorRule`; migrate the old setting keys only in `compat/legacy-hsr/migrate.ts`. Change every subsystem import to `prompts/subsystems/` and delete the replaced prompt modules after aggregate prompt tests pass.

Use this visual rule text:

```text
warm watercolor fantasy travel journal, hand-painted environment, parchment texture,
aged brass ornament, restrained cel shading, original costume details, no logo, no game screenshot
```

- [ ] **Step 4: Run subsystem, image, prompt aggregate, and build checks**

Run: `pnpm vitest run tests/unit/teyvatSubsystemPrompt.test.ts && node scripts/novelai-prompt-compiler-regression.mjs && pnpm test:all-prompt && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit subsystem content migration**

```bash
git add prompts/subsystems services/ai/variableModel.ts services/ai/steambirdModel.ts utils/imagePromptRules.ts models/settings.ts data/worldbookPresets.ts data/storyModeWorldbooks.ts compat/legacy-hsr/migrate.ts tests/unit/teyvatSubsystemPrompt.test.ts scripts/novelai-prompt-compiler-regression.mjs
git rm prompts/cot/variableCot.ts prompts/cot/variableOutputFormat.ts prompts/cot/newsCot.ts prompts/cot/phoneCot.ts prompts/cot/phoneOutputFormat.ts prompts/cot/phoneStyle.ts prompts/cot/yitingCot.ts prompts/cot/zhikuCot.ts prompts/cot/storyWeavingCot.ts prompts/cot/storyWeavingOutputFormat.ts
git commit -m "refactor: migrate teyvat subsystem prompts"
```

### Task 15: Enforce the runtime language and data audit

**Files:**
- Create: `scripts/teyvat-runtime-language-audit.mjs`
- Create: `scripts/config/teyvat-language-allowlist.json`
- Modify: `scripts/lib/regressionManifest.mjs`
- Modify: `App.tsx`
- Modify: `models/index.ts`, `models/character.ts`, `models/npc.ts`, `models/world.ts`, `models/chat.ts`, `models/quest.ts`, `models/variableCommand.ts`, `models/prompts.ts`, `models/worldbook.ts`, `models/storyWeaving.ts`, `models/settings.ts`
- Modify: `hooks/useGame.ts`, `hooks/useGameState.ts`, `hooks/useGame/contextSnapshot.ts`, `hooks/useGame/turnSnapshot.ts`, `hooks/useGame/tavernMessageChainBuilder.ts`, `hooks/useGame/saveLoadWorkflow.ts`, `hooks/useGame/npcPresence.ts`, `hooks/useGame/memoryUtils.ts`
- Modify: `services/ai/travelerTemplate.ts`, `services/ai/responseParser.ts`, `services/ai/openingArchive.ts`, `services/ai/storySnapshotPipeline.ts`, `services/ai/skillGenerator.ts`, `services/ai/narrativeImageParse.ts`, `services/ai/imagePromptTokenizer.ts`, `services/storyWeaving.ts`, `services/npcRelationshipPlanning.ts`, `services/memoryCompression.ts`, `services/savePackage.ts`
- Modify: `utils/commandRegistry.ts`, `utils/albumActions.ts`, `utils/contextComposition.ts`, `utils/promptPayloadSanitizer.ts`, `utils/worldbook.ts`, `utils/npcArchiveEnrichment.ts`, `utils/variableFacts.ts`
- Modify: production files under `components/` and `data/` reported by the first audit, renaming their exported symbols and filenames when the old term is part of the public contract
- Test: script self-test fixtures under `scripts/fixtures/teyvat-language-audit/`

**Interfaces:**
- Consumes: final runtime file tree after Tasks 7–14.
- Produces: exit code 0 only when banned terms occur exclusively in approved compatibility/history paths.

- [ ] **Step 1: Create failing and passing audit fixtures**

```text
scripts/fixtures/teyvat-language-audit/fail.ts: export const label = '黑塔空间站';
scripts/fixtures/teyvat-language-audit/pass.ts: export const label = '蒙德城';
```

The audit self-test must assert fail.ts is rejected and pass.ts is accepted.

- [ ] **Step 2: Run the audit against the runtime and verify it reports remaining files**

Run: `node scripts/teyvat-runtime-language-audit.mjs --self-test && node scripts/teyvat-runtime-language-audit.mjs`  
Expected: self-test PASS; runtime audit FAIL with an exact file/line report until residuals are removed.

- [ ] **Step 3: Implement the allowlist and remove every reported runtime residual**

The allowlist may include only:

```json
{
  "pathPrefixes": ["compat/legacy-hsr/", "public/zhiku-presets/legacy-hsr/", "public/data/story-weaving-canon/legacy-hsr/"],
  "files": ["原神化改造计划.md", "CHANGELOG.md"]
}
```

Scan the runtime roots `App.tsx`, `components/`, `hooks/`, `models/`, `prompts/`, `services/`, `utils/`, `data/`, and `public/` for `.ts`, `.tsx`, `.json`, `.css`, and `.html`. Exclude `tests/`, `stories/`, `scripts/fixtures/`, generated `dist`, `coverage`, `storybook-static`, `node_modules`, and `src-tauri/target`; tests are checked by their own assertions and are not shipped runtime content. For each reported production hit, either migrate the content or move genuinely historical data under an allowlisted `legacy-hsr` directory whose loader is read-only.

- [ ] **Step 4: Run the audit, prompt suite, and build**

Run: `node scripts/teyvat-runtime-language-audit.mjs && pnpm test:all-prompt && pnpm build`  
Expected: PASS with zero non-allowlisted hits.

- [ ] **Step 5: Commit the audit gate and cleanup**

```bash
git add scripts/teyvat-runtime-language-audit.mjs scripts/config/teyvat-language-allowlist.json scripts/fixtures/teyvat-language-audit scripts/lib/regressionManifest.mjs App.tsx models hooks services utils components data public
git commit -m "test: enforce teyvat runtime language"
```

Before staging, inspect `git status --short`; stage only audit-driven runtime edits. Never stage `.superpowers/`, local logs, generated builds, or unrelated user files. If the working tree already contains user edits under a broad directory above, replace that directory argument with the exact files changed for this task.

### Task 16: Add adventurer-journal tokens, region backgrounds, and asset provenance

**Files:**
- Create: `styles/adventurer-journal-tokens.css`
- Create: `styles/adventurer-journal.css`
- Modify: `styles/root-theme.css`
- Modify: `styles/global.css`
- Modify: `styles/themes.ts`
- Create: `data/regionVisuals.ts`
- Create: `public/assets/regions/manifest.json`
- Create: `public/assets/regions/mondstadt-journal.webp`
- Create: `public/assets/regions/liyue-journal.webp`
- Create: `public/assets/regions/inazuma-journal.webp`
- Create: `public/assets/regions/sumeru-journal.webp`
- Create: `public/assets/regions/fontaine-journal.webp`
- Create: `public/assets/regions/natlan-journal.webp`
- Test: `tests/unit/regionVisuals.test.ts`
- Create: `scripts/region-asset-provenance-regression.mjs`

**Interfaces:**
- Produces: `REGION_VISUALS`, CSS tokens `--journal-leather`, `--journal-parchment`, `--journal-travel-green`, `--journal-antique-gold`, motion and contrast variables.
- Consumes: Task 2 `RegionId`.

- [ ] **Step 1: Write failing region config and provenance tests**

```ts
expect(Object.keys(REGION_VISUALS)).toEqual(['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan']);
for (const visual of Object.values(REGION_VISUALS)) {
  expect(visual.background).toMatch(/^\/assets\/regions\/.+\.webp$/);
  expect(visual.overlayOpacity).toBeGreaterThanOrEqual(0.35);
}
```

The provenance script must require `file`, `sourceType`, `creator`, `license`, `prompt`, and `sha256` for each asset.

- [ ] **Step 2: Run tests and verify missing files fail**

Run: `pnpm vitest run tests/unit/regionVisuals.test.ts && node scripts/region-asset-provenance-regression.mjs`  
Expected: FAIL because configs and assets do not exist.

- [ ] **Step 3: Generate six original watercolor backgrounds and add tokens**

During execution, invoke the image generation skill once per region with these exact prompts:

```text
Mondstadt: Original Japanese-Western fantasy travel-journal landscape, windswept green highlands, dandelions and a distant old-European fantasy city, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.

Liyue: Original Japanese-Western fantasy travel-journal landscape, layered karst peaks, amber evening harbor lights and restrained eastern-fantasy roof silhouettes, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.

Inazuma: Original Japanese-Western fantasy travel-journal landscape, storm-lit island cliffs, violet clouds, distant shrine roofs and luminous sakura mist, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.

Sumeru: Original Japanese-Western fantasy travel-journal landscape, lush rainforest terraces flowing into a sunlit desert and distant scholarly fantasy city, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.

Fontaine: Original Japanese-Western fantasy travel-journal landscape, elegant canal city, pale-blue waterworks, brass clockwork details and bright cloud reflections, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.

Natlan: Original Japanese-Western fantasy travel-journal landscape, volcanic highlands, red-gold canyon vegetation, geothermal mist and a distant cliff settlement, warm watercolor and gouache, hand-painted paper grain, open central negative space for readable UI, no characters, no logo, no text, no game screenshot, no copied landmark composition, 16:9.
```

Convert outputs to WebP, record the exact prompt and SHA-256 in the manifest, and keep each file under 650 KB.

- [ ] **Step 4: Run asset, unit, build, and bundle checks**

Run: `pnpm vitest run tests/unit/regionVisuals.test.ts && node scripts/region-asset-provenance-regression.mjs && pnpm build && node scripts/bundle-size-regression.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit visual tokens and assets**

```bash
git add styles/adventurer-journal-tokens.css styles/adventurer-journal.css styles/root-theme.css styles/global.css styles/themes.ts data/regionVisuals.ts public/assets/regions tests/unit/regionVisuals.test.ts scripts/region-asset-provenance-regression.mjs
git commit -m "feat: add adventurer journal visual foundation"
```

### Task 17: Rebuild the app shell as character bookmark, story page, and system tabs

**Files:**
- Create: `components/layout/RegionBackdrop.tsx`
- Create: `components/layout/JournalCharacterBookmark.tsx`
- Create: `components/layout/JournalSystemTabs.tsx`
- Modify: `components/layout/GameView.tsx`
- Modify: `components/layout/TopBar.tsx`
- Modify: `components/layout/LeftPanel.tsx`
- Modify: `components/layout/RightMenu.tsx`
- Modify: `components/layout/MobileQuickMenu.tsx`
- Modify: `components/features/Chat/ChatList.tsx`
- Modify: `components/features/Chat/TurnItem.tsx`
- Modify: `components/ui/Modal.tsx`
- Modify: `styles/adventurer-journal.css`
- Create: `stories/AdventurerJournalShell.stories.tsx`
- Create: `scripts/adventurer-journal-layout-regression.mjs`

**Interfaces:**
- Consumes: Task 16 `REGION_VISUALS`; Task 5 runtime selectors.
- Produces: responsive shell, `RegionBackdropProps`, mobile bottom tabs, reduced-motion behavior.

- [ ] **Step 1: Write failing structural regression assertions**

```js
assert.match(gameViewSource, /RegionBackdrop/);
assert.match(gameViewSource, /JournalCharacterBookmark/);
assert.match(gameViewSource, /JournalSystemTabs/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /--journal-parchment/);
```

- [ ] **Step 2: Run layout regression and verify failure**

Run: `node scripts/adventurer-journal-layout-regression.mjs`  
Expected: FAIL because the shell components are missing.

- [ ] **Step 3: Implement desktop and mobile composition**

```tsx
<RegionBackdrop region={game.世界.当前地区} weather={game.世界.当前天气} danger={dangerState}>
  <TopBar />
  <div className="journal-shell">
    <JournalCharacterBookmark traveler={game.旅行者} />
    <main className="journal-story-page"><ChatList /></main>
    <JournalSystemTabs active={activeSystem} onSelect={onSystemSelect} />
  </div>
</RegionBackdrop>
```

At widths below 768px, hide the desktop bookmark and render `JournalSystemTabs` as a bottom tab bar. Use `aria-current`, visible focus rings, 44×44 px minimum touch targets, safe-area padding, and no required animation.

- [ ] **Step 4: Run regression, Storybook, mobile checks, and build**

Run: `node scripts/adventurer-journal-layout-regression.mjs && pnpm build-storybook && node scripts/phone-mobile-layout-regression.mjs && pnpm build`  
Expected: PASS.

- [ ] **Step 5: Commit the journal shell**

```bash
git add components/layout components/features/Chat components/ui/Modal.tsx styles/adventurer-journal.css stories/AdventurerJournalShell.stories.tsx scripts/adventurer-journal-layout-regression.mjs
git commit -m "feat: build adventurer journal app shell"
```

### Task 18: Run final gates and synchronize documentation/version claims

**Files:**
- Modify: `README.md`
- Modify: `项目文档.md`
- Modify: `原神化改造计划.md`
- Modify: `CHANGELOG.md`
- Modify: `data/releaseAnnouncements.ts`
- Modify: `package.json`
- Modify: `.gitignore` only if `.superpowers/` is not already ignored
- Create: `scripts/teyvat-six-opening-smoke-regression.mjs`
- Create: `scripts/teyvat-migration-failure-drill-regression.mjs`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green release gates and documentation that matches implemented behavior.

- [ ] **Step 1: Write the six-opening and migration-failure drills**

```js
for (const preset of OFFICIAL_OPENING_PRESETS) {
  const state = createTeyvatGameFromOpeningPreset(preset.id);
  assert.equal(state.universe, 'teyvat');
  assert.ok(state.世界.当前地点);
  assert.equal(JSON.stringify(state).match(/命途|光锥|黑塔空间站/g), null);
}
```

The failure drill must inject an unresolved legacy element and a failed storage write, then assert the original save bytes and previous catalog record are unchanged.

- [ ] **Step 2: Run the new gates and collect failures**

Run: `node scripts/teyvat-six-opening-smoke-regression.mjs && node scripts/teyvat-migration-failure-drill-regression.mjs`  
Expected: PASS after Tasks 1–17; any failure is fixed before documentation claims are changed.

- [ ] **Step 3: Update docs and version metadata with exact delivered scope**

Document that the completed release contains the Teyvat runtime, safe migration, structured turn protocol and adventurer-journal shell. Explicitly list map exploration, elemental combat, party progression and wishing as separate subsequent milestones. Remove the prior claim that M0–M7 was complete before runtime semantics were migrated.

- [ ] **Step 4: Run the complete release verification**

Run in order:

```bash
node scripts/teyvat-runtime-language-audit.mjs
node scripts/region-asset-provenance-regression.mjs
node scripts/teyvat-six-opening-smoke-regression.mjs
node scripts/teyvat-migration-failure-drill-regression.mjs
pnpm test:unit
pnpm test:all
pnpm build-storybook
pnpm build
node scripts/bundle-size-regression.mjs
```

Expected: every command exits 0. Record exact test counts, bundle sizes and any non-blocking warnings in `CHANGELOG.md`.

- [ ] **Step 5: Commit the verified milestone**

```bash
git add README.md 项目文档.md 原神化改造计划.md CHANGELOG.md data/releaseAnnouncements.ts package.json .gitignore scripts/teyvat-six-opening-smoke-regression.mjs scripts/teyvat-migration-failure-drill-regression.mjs
git commit -m "docs: complete teyvat core milestone"
```

---

## Execution Notes

- Run tasks strictly in order because each task's interfaces are consumed by later tasks.
- After each task, inspect `git diff --check` and the focused test output before proceeding.
- Do not use broad search-and-replace across `compat/legacy-hsr/` or legacy data archives; those files intentionally preserve old terms.
- Do not delete the old model/service file until `rg` confirms no runtime importer remains.
- If a task reveals a genuinely missing product decision, stop that task and return to the approved design spec rather than inventing a new rule.
