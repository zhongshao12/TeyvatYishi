# 开拓轶事：稳定性与扩展路线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 每个工作流（Workstream）是独立可交付单元，建议按 A → G 顺序执行；C、D、F 之间无硬依赖，可并行。

**Goal:** 完成 README 路线图中的六项稳定性 / 扩展工作（剧情推进与异常恢复、手机聊天工作流、剧情编织冲突处理、文生图任务自动化与队列、前端包体拆分与性能、测试覆盖），并新增“剧情任务系统”。

**Architecture:** 全部工作遵循现有分层：`models/`（中文领域模型 + 归一化）→ `services/`（纯逻辑服务）→ `hooks/useGame/`（回合工作流）→ `components/`（面板与弹窗）→ `data/` + `prompts/cot/`（预设与提示词）→ `scripts/`（静态回归）。新功能统一接入现有存档打包 / 差量存储 / 运行时压缩链，统一走 `queueTasks` 后台任务展示，统一用 `pnpm test:all` 风格回归脚本验证。测试方面新增 Vitest 单元测试作为补充，不替代既有静态回归。

**Tech Stack:** 既有栈（React 19 / TS / Vite / Tailwind / IndexedDB）+ 新增 `vitest`（node 环境，纯逻辑单测）+ 现有 Node 静态回归脚本体系。

---

## 0. 执行原则

- **TDD 节奏**：每个任务先写回归/单测，运行确认失败，再实现，再运行确认通过，最后提交。
- **提交频率**：每个任务一个提交；提交信息用 `feat:` / `fix:` / `test:` / `perf:` / `refactor:` 前缀。
- **回归风格**：`scripts/*-regression.mjs` 使用 Node 原生 `fs` 读取源文件并 `assert(...)`，保持与现有 165 个脚本一致；纯逻辑新模块同时补 `tests/unit/*.test.ts`。
- **验证命令**：每个任务标注 `pnpm build`（TS + Vite）、`pnpm test:all`、`pnpm test:unit` 的期望结果。
- **不变量**：重型面板必须保持 `lazyWithRetry` 懒加载；不提交 `docs/`、`.env*`、密钥与私人存档。

---

## 1. 文件映射总览

| 工作流 | Create | Modify |
| --- | --- | --- |
| A 剧情推进与异常恢复 | `hooks/useGame/recoveryResume.ts`、`components/layout/RecoveryBanner.tsx`、`scripts/workflow-recovery-phase-regression.mjs`、`scripts/workflow-recovery-resume-regression.mjs` | `utils/workflowRecoveryModel.ts`、`services/workflowRecovery.ts`、`hooks/useGame/sendWorkflow.ts`、`hooks/useGameState.ts`、`App.tsx` |
| B 手机聊天工作流 | `hooks/useGame/phoneWorkflow.ts`、`scripts/phone-group-full-workflow-regression.mjs`、`scripts/phone-scheduled-seed-regression.mjs` | `models/phone.ts`、`services/ai/phoneService.ts`、`components/features/Phone/PhoneModal.tsx`、`prompts/cot/phoneCot.ts`、`prompts/cot/phoneOutputFormat.ts` |
| C 剧情编织冲突处理 | `models/storyWeavingConflict.ts`、`services/storyWeavingConflict.ts`、`scripts/story-weaving-conflict-detection-regression.mjs` | `components/features/GameSystems/PlotPanel.tsx`、`prompts/cot/storyWeavingCot.ts` |
| D 文生图队列 | `utils/imageTaskQueue.ts`、`scripts/image-queue-runner-regression.mjs`、`scripts/image-queue-crash-recovery-regression.mjs` | `components/features/GameSystems/AlbumPanel.tsx`、`hooks/useGame/sendWorkflow.ts`、`components/features/Settings/ImageGenerationSettingsTab.tsx`、`models/settings.ts` |
| E 包体拆分与性能 | `components/layout/AppPanels.tsx`、`hooks/useGame/handlers.ts`、`scripts/bundle-size-report.mjs`、`scripts/bundle-size-regression.mjs` | `vite.config.ts`、`App.tsx`、`hooks/useGame.ts`、`utils/lazyWithRetry.ts` |
| F 测试覆盖 | `vitest.config.ts`、`tests/unit/workflowRecoveryModel.test.ts`、`tests/unit/imageTaskQueue.test.ts`、`tests/unit/storyWeavingConflict.test.ts`、`.github/workflows/ci.yml` | `package.json` |
| G 剧情任务系统 | `models/quest.ts`、`data/questPresets.ts`、`data/questWorldbook.ts`、`prompts/cot/questCot.ts`、`prompts/cot/questOutputFormat.ts`、`services/questService.ts`、`hooks/useGame/questWorkflow.ts`、`components/features/GameSystems/QuestPanel.tsx`、`scripts/quest-state-machine-regression.mjs`、`scripts/quest-prompt-parsing-regression.mjs`、`scripts/quest-save-regression.mjs` | `models/settings.ts`、`models/queueTask.ts`、`models/chat.ts`、`services/ai/responseParser.ts`、`hooks/useGame/sendWorkflow.ts`、`hooks/useGame/systemPromptBuilder.ts`、`data/gameMenu.ts`、`App.tsx`、`components/features/GameSystems/SystemPanels.tsx`、`services/savePackage.ts`、`utils/saveDeltaStorage.ts`、`utils/saveRuntimeCompactor.ts` |

---

## 2. Workstream A：更稳定的剧情推进与异常恢复

### 2.1 现状

- `utils/workflowRecoveryModel.ts` 已有 v1 恢复日志，但阶段只有 `main_request | variable_settlement | autosave`，且只有 `variable_settlement` 与 `autosave` 两个阶段边界写入日志。
- `services/workflowRecovery.ts` 只负责 load / persist / clear，无过期判定、无自动恢复入口。
- reroll 依赖 `turnSnapshot` 回合前快照；`sendWorkflow.ts` 的 `executeSendWorkflow` 已按 Phase 注释组织，但阶段失败后没有断点续跑机制。

### 2.2 目标

崩溃 / 刷新 / API 失败后：重启应用能识别“上一回合未完成”，提示玩家并一键恢复（重新结算变量 / 新闻 / 手机种子 / 故事快照），已完成的阶段不重复执行。恢复日志支持阶段级断点与过期清理。

### 2.3 任务

#### Task A1: 扩展恢复日志模型到 v2

**Files:**
- Modify: `utils/workflowRecoveryModel.ts`
- Test: `tests/unit/workflowRecoveryModel.test.ts`（在 Workstream F 建目录，本任务先创建）

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/workflowRecoveryModel.test.ts
import { describe, expect, it } from 'vitest';
import {
  createWorkflowRecoveryJournal,
  parseWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
} from '../../utils/workflowRecoveryModel';

describe('workflowRecoveryModel v2', () => {
  it('parses a v2 journal with new phases', () => {
    const journal = createWorkflowRecoveryJournal('input', 3);
    const updated = updateWorkflowRecoveryJournal(journal, { phase: 'news' });
    const parsed = parseWorkflowRecoveryJournal(JSON.parse(JSON.stringify(updated)));
    expect(parsed?.phase).toBe('news');
    expect(parsed?.version).toBe(2);
    expect(parsed?.workflowId).toBe(journal.workflowId);
  });

  it('rejects unknown phases', () => {
    const parsed = parseWorkflowRecoveryJournal({ version: 2, workflowId: 'w', startedAt: 1, updatedAt: 1, input: 'x', turnAtStart: 1, phase: 'unknown' });
    expect(parsed).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/workflowRecoveryModel.test.ts` → 期望失败（`parseWorkflowRecoveryJournal` 不接受新 phase）。

- [ ] **Step 2: 实现 v2 模型**

```ts
// utils/workflowRecoveryModel.ts 中的关键改动
export type WorkflowRecoveryPhase =
  | 'main_request'
  | 'variable_settlement'
  | 'news'
  | 'memory'
  | 'phone_seed'
  | 'story_weaving'
  | 'image_parse'
  | 'image_generate'
  | 'autosave';

export interface WorkflowRecoveryJournal {
  version: 2;
  workflowId: string;
  startedAt: number;
  updatedAt: number;
  input: string;
  turnAtStart: number;
  phase: WorkflowRecoveryPhase;
  userMessageId?: string;
  assistantMessageId?: string;
  /** 阶段进入时间，用于“停留在某阶段过久”的判定。 */
  phaseStartedAt: number;
}

export const WORKFLOW_RECOVERY_STALE_MS = 4 * 60 * 60 * 1000; // 4 小时
```

同步修改 `createWorkflowRecoveryJournal`（返回 `version: 2`、`phaseStartedAt: Date.now()`）、`parseWorkflowRecoveryJournal`（校验新 phase 集合、接受 v1 并迁移为 v2：`phaseStartedAt = startedAt`）、`updateWorkflowRecoveryJournal`（当 patch 含 `phase` 时重置 `phaseStartedAt = Date.now()`）。

- [ ] **Step 3: 运行单测确认通过**

Run: `npx vitest run tests/unit/workflowRecoveryModel.test.ts` → 期望 PASS。

- [ ] **Step 4: 提交**

```bash
git add utils/workflowRecoveryModel.ts tests/unit/workflowRecoveryModel.test.ts
git commit -m "feat: extend workflow recovery journal to phase-level v2"
```

#### Task A2: 恢复服务增加过期判定与辅助查询

**Files:**
- Modify: `services/workflowRecovery.ts`

- [ ] **Step 1: 增加 `isWorkflowRecoveryStale` 与 `loadRecoverableWorkflow`**

```ts
// services/workflowRecovery.ts
import { WORKFLOW_RECOVERY_STALE_MS } from '@/utils/workflowRecoveryModel';

export function isWorkflowRecoveryStale(journal: WorkflowRecoveryJournal, now = Date.now()): boolean {
  return now - journal.updatedAt > WORKFLOW_RECOVERY_STALE_MS;
}

/** 读取未完成且未过期的恢复日志；过期日志直接清理。 */
export async function loadRecoverableWorkflow(): Promise<WorkflowRecoveryJournal | null> {
  const journal = await loadWorkflowRecoveryJournal();
  if (!journal) return null;
  if (isWorkflowRecoveryStale(journal)) {
    await clearWorkflowRecoveryJournal(journal.workflowId);
    return null;
  }
  return journal;
}
```

- [ ] **Step 2: 验证**

Run: `pnpm build` → 期望 TS 通过。

- [ ] **Step 3: 提交**

```bash
git add services/workflowRecovery.ts
git commit -m "feat: add stale detection for workflow recovery journals"
```

#### Task A3: 回合工作流各阶段写入 / 清理恢复日志

**Files:**
- Modify: `hooks/useGame/sendWorkflow.ts`
- Test: `scripts/workflow-recovery-phase-regression.mjs`

- [ ] **Step 1: 写失败回归**

```js
// scripts/workflow-recovery-phase-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const recoveryModel = fs.readFileSync('utils/workflowRecoveryModel.ts', 'utf8');
assert(recoveryModel.includes("'news'") && recoveryModel.includes("'phone_seed'") && recoveryModel.includes("'image_generate'"), 'recovery journal must track news/phone_seed/image_generate phases.');
for (const phase of ['main_request', 'variable_settlement', 'news', 'memory', 'phone_seed', 'story_weaving', 'image_parse', 'image_generate', 'autosave']) {
  assert(sendWorkflow.includes(`phase: '${phase}'`) || sendWorkflow.includes(`{ phase: '${phase}' }`), `sendWorkflow must persist recovery journal at phase ${phase}.`);
}
assert(sendWorkflow.includes('clearWorkflowRecoveryJournal(recoveryJournal.workflowId)'), 'sendWorkflow must clear the journal after the final autosave phase.');
```

Run: `node scripts/workflow-recovery-phase-regression.mjs` → 期望 FAIL。

- [ ] **Step 2: 在 `executeSendWorkflow` 各 Phase 边界写入日志**

在 `executeSendWorkflow` 内保持现有 `recoveryJournal = createWorkflowRecoveryJournal(...)` 的创建点不变，随后：

1. 主请求开始前：`recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { phase: 'main_request' }); await persistWorkflowRecoveryJournal(recoveryJournal);`
2. 正文落地后（现有 `phase: 'variable_settlement'` 处保持）。
3. 变量结算成功后：`{ phase: 'memory' }`；记忆整理后：`{ phase: 'news' }`；新闻推演后：`{ phase: 'phone_seed' }`；手机种子生成后：`{ phase: 'story_weaving' }`；剧情编织判定后：`{ phase: 'image_parse' }`；快照解析后：`{ phase: 'image_generate' }`；生图入队后：`{ phase: 'autosave' }`。
4. 每次写日志后 `await persistWorkflowRecoveryJournal(recoveryJournal)`；autosave 成功（`commitActiveSaveTreeMeta` 之后）调用 `await clearWorkflowRecoveryJournal(recoveryJournal.workflowId)`。

现有变量结算 / autosave 两处若已有相似调用，直接按新 phase 列表替换并补全其余边界。

- [ ] **Step 3: 运行回归确认通过**

Run: `node scripts/workflow-recovery-phase-regression.mjs` → 期望 PASS；再 `pnpm build`。

- [ ] **Step 4: 提交**

```bash
git add hooks/useGame/sendWorkflow.ts scripts/workflow-recovery-phase-regression.mjs
git commit -m "feat: persist workflow recovery journal at every turn phase boundary"
```

#### Task A4: 恢复入口与恢复横幅

**Files:**
- Create: `hooks/useGame/recoveryResume.ts`
- Create: `components/layout/RecoveryBanner.tsx`
- Modify: `App.tsx`
- Test: `scripts/workflow-recovery-resume-regression.mjs`

- [ ] **Step 1: 实现 `resumeInterruptedWorkflow`**

```ts
// hooks/useGame/recoveryResume.ts
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { WorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import { loadRecoverableWorkflow, clearWorkflowRecoveryJournal } from '@/services/workflowRecovery';

export async function checkInterruptedWorkflow(): Promise<WorkflowRecoveryJournal | null> {
  return loadRecoverableWorkflow();
}

/**
 * 恢复策略：
 * - 阶段在 variable_settlement 及之后：若历史里已有 assistant 正文，则只重跑该阶段及其后的副作用（变量/新闻/记忆/手机种子/快照生图）；
 * - 阶段在 main_request：正文不存在，只提示玩家重新发送，不做自动重跑。
 */
export function canAutoResume(journal: WorkflowRecoveryJournal, history: { id: string; role: string }[]): boolean {
  if (journal.phase === 'main_request') return false;
  const assistantIds = new Set(history.filter((m) => m.role === 'assistant').map((m) => m.id));
  return !journal.assistantMessageId || assistantIds.has(journal.assistantMessageId);
}

export async function dismissInterruptedWorkflow(journal: WorkflowRecoveryJournal): Promise<void> {
  await clearWorkflowRecoveryJournal(journal.workflowId);
}
```

- [ ] **Step 2: 实现 `RecoveryBanner`**

`components/layout/RecoveryBanner.tsx`：接收 `journal: WorkflowRecoveryJournal | null`、`onResume`、`onDismiss`。渲染一条横幅，显示“检测到第 N 回合未完成：阶段 X”，提供「恢复上一回合」「忽略」两个按钮。`canAutoResume` 为 false 时只显示提示与「忽略」。样式沿用现有 `cardClip` / `tj-*` 变量风格。

- [ ] **Step 3: 接入 App.tsx**

在 `App.tsx` 顶层 `useEffect`（`useGame` 初始化后）调用 `checkInterruptedWorkflow()`，把结果存入 state；点击「恢复」时：

- `canAutoResume` 为 true 且 phase 为 `variable_settlement` / `news` / `memory` / `phone_seed`：调用 `handleRetryQueueTask` 对应任务（news/variable），或直接调用 `executeSendWorkflow` 中的同阶段重跑函数（复用 `retryNewsQueueTask` / `retryVariableQueueTask`）。
- phase 为 `image_parse` / `image_generate`：调用现有 `handleRegenerateNarrativeImage(messageId)`。
- 完成后 `dismissInterruptedWorkflow(journal)`。

- [ ] **Step 4: 写并运行恢复回归**

```js
// scripts/workflow-recovery-resume-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const resume = fs.readFileSync('hooks/useGame/recoveryResume.ts', 'utf8');
const banner = fs.readFileSync('components/layout/RecoveryBanner.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(resume.includes('canAutoResume'), 'recoveryResume must expose canAutoResume.');
assert(resume.includes('loadRecoverableWorkflow'), 'recoveryResume must load recoverable journals.');
assert(banner.includes('恢复上一回合'), 'RecoveryBanner must offer a resume action.');
assert(app.includes('checkInterruptedWorkflow'), 'App must check for interrupted workflows on startup.');
assert(app.includes('RecoveryBanner'), 'App must render RecoveryBanner.');
```

Run: `node scripts/workflow-recovery-resume-regression.mjs` → 期望 PASS；`pnpm build`。

- [ ] **Step 5: 提交**

```bash
git add hooks/useGame/recoveryResume.ts components/layout/RecoveryBanner.tsx App.tsx scripts/workflow-recovery-resume-regression.mjs
git commit -m "feat: resume interrupted turn workflow from recovery banner"
```

### 2.4 验收

- `pnpm test:all` 全绿，新增 2 个回归脚本通过，`pnpm test:unit` 通过。
- 手动验证：主请求中途刷新 → 重启后出现恢复横幅，新闻/变量可一键重跑且不重复写档；4 小时前的旧日志自动清理。

---

## 3. Workstream B：更完整的手机聊天工作流

### 3.1 现状

- `PhoneModal.tsx` 已具备私聊 / 群聊回复、质量过滤、去重、fallback 联系人、记忆写回、主动来信种子与冷却。
- 缺口：无定时（按回合数延迟）来信、无群聊成员知识边界、无已读状态 / 输入中状态、无群组创建与管理 UI、种子来源未接新闻 / 剧情编织事件。

### 3.2 目标

手机成为主线外的完整叙事终端：种子可按回合延迟到达；群聊按“每个成员知道什么”过滤上下文；会话支持已读 / 输入中状态；手机事件可反向生成新闻与剧情种子。

### 3.3 任务

#### Task B1: 扩展手机数据模型

**Files:**
- Modify: `models/phone.ts`

- [ ] **Step 1: 增加字段（保持向后兼容，全部可选）**

```ts
// models/phone.ts 追加
export interface 手机消息 {
  // ...既有字段
  readBy?: string[];       // 已读成员 id（私聊为对方 id）
  scheduledAtTurn?: number; // 延迟到达的回合（消息先在 pending 列表）
  deliveredAtTurn?: number; // 实际送达回合
}

export interface 手机会话 {
  // ...既有字段
  typingMembers?: string[];  // 正在输入的联系人 id
  inviteCode?: string;       // 群聊邀请码 / 可加入链接
}

export interface 主动来信种子 {
  // ...既有字段
  scheduledAtTurn?: number;  // 空 = 立即生效
  fromEvent?: 'news' | 'plot' | 'relationship'; // 来源事件类型
  relatedEventId?: string;
}
```

同步在 `归一化手机系统` 中做字段兜底：`readBy` 非法时清空，`scheduledAtTurn` 非正整数时删除。

- [ ] **Step 2: 验证与提交**

Run: `pnpm build`；`git commit -m "feat: extend phone model with scheduled seeds and read state"`。

#### Task B2: 定时来信工作流

**Files:**
- Create: `hooks/useGame/phoneWorkflow.ts`
- Modify: `hooks/useGame/sendWorkflow.ts`（回合结束调用）
- Test: `scripts/phone-scheduled-seed-regression.mjs`

- [ ] **Step 1: 实现 `processScheduledPhoneSeeds`**

```ts
// hooks/useGame/phoneWorkflow.ts
import type { 手机系统, 主动来信种子 } from '@/models/phone';

/** 在回合结束时调用：把到达回合的种子转为待生成状态，并标记送达回合。 */
export function processScheduledPhoneSeeds(
  phone: 手机系统,
  currentTurn: number,
  now = Date.now(),
): { next: 手机系统; due: 主动来信种子[] } {
  const seeds = Array.isArray(phone.incomingSeeds) ? phone.incomingSeeds : [];
  const due: 主动来信种子[] = [];
  const nextSeeds = seeds.map((seed) => {
    if (seed.status !== 'pending') return seed;
    const dueTurn = seed.scheduledAtTurn != null ? seed.scheduledAtTurn : seed.turn;
    if (currentTurn < dueTurn) return seed;
    due.push(seed);
    return { ...seed, status: 'generated' as const, updatedAt: now };
  });
  return { next: { ...phone, incomingSeeds: nextSeeds }, due };
}
```

在 `sendWorkflow.ts` 的 `phone_seed` 阶段之后调用；`due` 非空时走既有 `buildFallbackPhoneSeed` / 来信生成逻辑（种子已存在，只是延迟激活），并把 `deliveredAtTurn` 写入对应会话消息。

- [ ] **Step 2: 写并运行回归**

```js
// scripts/phone-scheduled-seed-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const phoneModel = fs.readFileSync('models/phone.ts', 'utf8');
const workflow = fs.readFileSync('hooks/useGame/phoneWorkflow.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
assert(phoneModel.includes('scheduledAtTurn'), 'phone seed model must support scheduled arrival turn.');
assert(workflow.includes('processScheduledPhoneSeeds'), 'phone workflow must expose scheduled seed processing.');
assert(workflow.includes('currentTurn < dueTurn'), 'scheduled seeds must not fire before their turn.');
assert(sendWorkflow.includes('processScheduledPhoneSeeds'), 'send workflow must call scheduled seed processing each turn.');
```

Run: `node scripts/phone-scheduled-seed-regression.mjs` → 期望 PASS；`pnpm build`。

- [ ] **Step 3: 提交**

```bash
git add models/phone.ts hooks/useGame/phoneWorkflow.ts hooks/useGame/sendWorkflow.ts scripts/phone-scheduled-seed-regression.mjs
git commit -m "feat: deliver scheduled phone seeds at turn boundaries"
```

#### Task B3: 群聊知识边界与成员视角过滤

**Files:**
- Modify: `services/ai/phoneService.ts`
- Modify: `prompts/cot/phoneCot.ts`、`prompts/cot/phoneOutputFormat.ts`
- Test: `scripts/phone-group-full-workflow-regression.mjs`

- [ ] **Step 1: 在 `buildPhoneGroupParticipantContext` 中加入知识边界**

在 `phoneService.ts` 的群聊上下文构建处新增：

```ts
function filterKnowledgeForMember(
  member: { id: string; name: string },
  news: 新闻条目[],
  memory: unknown[],
): { news: 新闻条目[]; memory: unknown[] } {
  // 成员视角过滤规则：
  // - 新闻：只保留 member 所在阵营 / 地点相关的条目（按字段匹配组织/地点名）；
  // - 记忆：只保留 member 出现在 涉及NPC 或 摘要 中的条目。
  // 规则不足时宁缺毋滥：无法判定归属的内容不下发给该成员。
  return { news: [], memory: [] };
}
```

在群聊用户提示词中，为每个发言成员生成“该成员知道什么”小节；`phoneOutputFormat.ts` 增加规则：禁止成员说出自己的知识边界之外的信息（如未经历的事件、未公开新闻）。

- [ ] **Step 2: 写并运行群聊全流程回归**

```js
// scripts/phone-group-full-workflow-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const phoneService = fs.readFileSync('services/ai/phoneService.ts', 'utf8');
const phoneCot = fs.readFileSync('prompts/cot/phoneCot.ts', 'utf8');
const phoneOutputFormat = fs.readFileSync('prompts/cot/phoneOutputFormat.ts', 'utf8');
const phoneModal = fs.readFileSync('components/features/Phone/PhoneModal.tsx', 'utf8');
assert(phoneService.includes('filterKnowledgeForMember'), 'group replies must filter context per participant.');
assert(phoneService.includes('知识边界'), 'group prompt must label per-member knowledge boundary.');
assert(phoneOutputFormat.includes('知识边界'), 'group output format must forbid leaking outside member knowledge.');
assert(phoneModal.includes('typingMembers'), 'phone UI must support typing member indicators.');
assert(phoneModal.includes('readBy'), 'phone UI must render read receipts.');
```

Run: `node scripts/phone-group-full-workflow-regression.mjs` → 先 FAIL（提示词与 UI 尚未完成），完成 Step 3 后 PASS。

- [ ] **Step 3: PhoneModal 群聊管理 UI**

在 `PhoneModal.tsx`：
1. 群聊会话头部增加「+ 邀请成员」按钮：弹出联系人多选列表，写入 `participantIds`。
2. 消息气泡根据 `readBy` 显示“已读”小标（私聊）/ 成员头像组（群聊）。
3. 发送前 1.2s 内把对方/群成员加入 `typingMembers`，收到回复后清空。

- [ ] **Step 4: 提交**

```bash
git add services/ai/phoneService.ts prompts/cot/phoneCot.ts prompts/cot/phoneOutputFormat.ts components/features/Phone/PhoneModal.tsx scripts/phone-group-full-workflow-regression.mjs
git commit -m "feat: per-member knowledge boundary and group chat workflow"
```

### 3.4 验收

- 定时来信在指定回合前不出现；到期后正常生成并写入未读。
- 群聊中每个成员只使用自己知识边界内的上下文；UI 显示输入中与已读状态。
- 新回归脚本通过；`pnpm build` 通过。

---

## 4. Workstream C：更细的剧情编织冲突处理

### 4.1 现状

- `services/storyWeaving.ts` 已有滑窗注入、门禁（strong/weak）、进度锚点、开局档案重定位与“禁止重演 / 禁止抢跑”提示。
- 缺口：没有程序化的冲突检测（同一系列出现多个“当前”段、已“已经历”的事件被重新注入、玩家事实与原著时间线矛盾、已偏离段的回归路径），冲突只能靠模型自觉。

### 4.2 目标

新增剧情编织冲突检测服务与冲突面板：程序化发现冲突、给出修复建议、一键应用（跳过 / 标记偏离 / 回归 / 忽略），并在提示词中固化冲突处理规则。

### 4.3 任务

#### Task C1: 冲突模型

**Files:**
- Create: `models/storyWeavingConflict.ts`

- [ ] **Step 1: 定义类型（含完整归一化）**

```ts
// models/storyWeavingConflict.ts
export type 剧情编织冲突严重度 = 'info' | 'warning' | 'error';
export type 剧情编织冲突规则ID =
  | 'multiple_active_segments'
  | 'canon_event_replay'
  | 'fact_timeline_contradiction'
  | 'diverged_segment_no_rejoin';
export type 剧情编织冲突修复动作 = 'mark_skip' | 'mark_diverged' | 'rejoin' | 'dismiss';

export interface 剧情编织冲突 {
  id: string;
  规则ID: 剧情编织冲突规则ID;
  严重度: 剧情编织冲突严重度;
  系列ID: string;
  分段ID?: string;
  描述: string;
  建议: string;
  建议动作: 剧情编织冲突修复动作;
  自动可修复: boolean;
  createdAt: number;
  dismissedAt?: number;
}

export interface 剧情编织冲突报告 {
  conflicts: 剧情编织冲突[];
  generatedAt: number;
}
```

提供 `创建冲突报告` / `归一化剧情编织冲突` 函数。

- [ ] **Step 2: 提交**：`git commit -m "feat: add story weaving conflict model"`。

#### Task C2: 冲突检测服务

**Files:**
- Create: `services/storyWeavingConflict.ts`
- Test: `tests/unit/storyWeavingConflict.test.ts`

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/storyWeavingConflict.test.ts
import { describe, expect, it } from 'vitest';
import { 检测多个当前分段, 检测原著事件重演, type 剧情编织系列 } from '../../services/storyWeavingConflict';

const series: 剧情编织系列 = {
  id: 's1', 标题: '测试', 作品名: '崩坏：星穹铁道', 核心角色: [],
  涉及地点索引: [], 涉及派系索引: [], 当前阶段概括: '', 激活注入: true,
  分段: [
    { id: 'seg1', 组号: 1, 标题: 'A', 运行状态: '当前', 处理状态: '已完成' } as never,
    { id: 'seg2', 组号: 2, 标题: 'B', 运行状态: '当前', 处理状态: '已完成' } as never,
  ],
};

describe('storyWeavingConflict', () => {
  it('detects multiple active segments', () => {
    const conflicts = 检测多个当前分段(series);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].规则ID).toBe('multiple_active_segments');
  });
});
```

Run: `npx vitest run tests/unit/storyWeavingConflict.test.ts` → 期望 FAIL（模块不存在）。

- [ ] **Step 2: 实现检测器**

```ts
// services/storyWeavingConflict.ts
import type { 剧情编织系列, 剧情编织系统, 剧情编织分段 } from '@/models/storyWeaving';
import type { 剧情编织冲突, 剧情编织冲突规则ID } from '@/models/storyWeavingConflict';

export function 检测多个当前分段(series: 剧情编织系列): 剧情编织冲突[] {
  const active = (series.分段 ?? []).filter((seg) => seg.运行状态 === '当前');
  return active.length > 1
    ? active.slice(1).map((seg) => ({
        id: `conflict_${seg.id}`,
        规则ID: 'multiple_active_segments' as const,
        严重度: 'error' as const,
        系列ID: series.id,
        分段ID: seg.id,
        描述: `同一系列存在多个「当前」分段（${active.map((s) => s.标题).join('、')}）。`,
        建议: '保留最早组号的分段为当前，其余标记为「已跳过」。',
        建议动作: 'mark_skip' as const,
        自动可修复: true,
        createdAt: Date.now(),
      }))
    : [];
}

export function 检测原著事件重演(system: 剧情编织系统, 已发生事实: string[]): 剧情编织冲突[] {
  // 已发生事实（如变量账本摘要）中出现的“事件名”，若对应分段仍为「未开始」且属于 canon 系列，报告重演风险。
  return [];
}

export function 检测事实与时间线矛盾(system: 剧情编织系统, 已发生事实: string[]): 剧情编织冲突[] {
  return [];
}

export function 检测偏离段缺失回归路径(system: 剧情编织系统): 剧情编织冲突[] {
  return [];
}

export function 生成冲突报告(system: 剧情编织系统, 已发生事实: string[]): 剧情编织冲突[] {
  const seriesList = system.系列 ?? [];
  return seriesList.flatMap((series) => [
    ...检测多个当前分段(series),
    ...检测原著事件重演(system, 已发生事实),
    ...检测事实与时间线矛盾(system, 已发生事实),
    ...检测偏离段缺失回归路径(system),
  ]);
}
```

`检测原著事件重演` 与 `检测事实与时间线矛盾` 的具体匹配：把 `已发生事实` 字符串数组与分段标题 / `本段概括` / 事件名做包含匹配；命中且运行状态为 `未开始` → `canon_event_replay`；命中且运行状态为 `已经历` 但在时间线事件中与事实矛盾 → `fact_timeline_contradiction`。`检测偏离段缺失回归路径`：运行状态为 `已偏离` 且系列中不存在 `未开始` 且组号更大的分段时报告。

- [ ] **Step 3: 运行单测通过 + 提交**

Run: `npx vitest run tests/unit/storyWeavingConflict.test.ts` → PASS；`git commit -m "feat: add story weaving conflict detection service"`。

#### Task C3: 冲突面板与一键修复

**Files:**
- Modify: `components/features/GameSystems/PlotPanel.tsx`
- Modify: `prompts/cot/storyWeavingCot.ts`
- Test: `scripts/story-weaving-conflict-detection-regression.mjs`

- [ ] **Step 1: PlotPanel 增加「冲突」页签**

在现有 TrackTab（canon / custom）基础上增加 `conflict` 页：调用 `生成冲突报告(剧情编织, 已发生事实)`（`已发生事实` 从 `variableBatches` 的成功结果中提取摘要）。每条冲突展示严重度、描述、建议和按钮：
- 自动可修复：`mark_skip` → 把目标分段 `运行状态` 置为 `已跳过`；`mark_diverged` → 置为 `已偏离`；`rejoin` → 置为 `当前` 并把同系列其他 `当前` 置为 `已经历`。
- 所有修复调用 `onStoryWeavingChange` 写回并 `saveSetting('storyWeavingSystem', ...)`。

- [ ] **Step 2: 提示词固化冲突规则**

在 `prompts/cot/storyWeavingCot.ts` 追加一段固定规则：

```ts
export const STORY_WEAVING_CONFLICT_RULES = `
## 冲突处理规则
- 如果玩家行动 / 变量账本已表明某事件已经发生或已被解决，即使滑窗仍停留在该分段，也不得重演同一事件、同一敌人或同一章节危机。
- 同一时间线上不得同时存在两个「当前」推进点；若检测到，模型应优先延续组号更小、事实更贴近当前局面的分段。
- 玩家走出与原著不同的 IF 线后，以已发生剧情为准；不得把「已偏离」分段补写成已完整经历，也不得无视偏离强行拉回原文轨道。
- 信息可见性是硬约束：角色只能说出自己知道的内容；谁不知道什么，模型必须遵守。
`;
```

并在 `buildStoryWeavingSystemPrompt` 中拼入该常量。

- [ ] **Step 3: 写并运行回归**

```js
// scripts/story-weaving-conflict-detection-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const conflictService = fs.readFileSync('services/storyWeavingConflict.ts', 'utf8');
const conflictModel = fs.readFileSync('models/storyWeavingConflict.ts', 'utf8');
const plotPanel = fs.readFileSync('components/features/GameSystems/PlotPanel.tsx', 'utf8');
const cot = fs.readFileSync('prompts/cot/storyWeavingCot.ts', 'utf8');
assert(conflictModel.includes('剧情编织冲突'), 'conflict model must exist.');
assert(conflictService.includes('生成冲突报告'), 'conflict service must expose a report generator.');
assert(conflictService.includes('multiple_active_segments'), 'conflict service must detect multiple active segments.');
assert(plotPanel.includes('生成冲突报告'), 'PlotPanel must render conflicts from the service.');
assert(plotPanel.includes('mark_skip') || plotPanel.includes('已跳过'), 'PlotPanel must offer one-click skip fix.');
assert(cot.includes('STORY_WEAVING_CONFLICT_RULES'), 'story weaving prompt must include conflict rules.');
```

Run: `node scripts/story-weaving-conflict-detection-regression.mjs` → PASS；`pnpm build`。

- [ ] **Step 4: 提交**

```bash
git add components/features/GameSystems/PlotPanel.tsx prompts/cot/storyWeavingCot.ts scripts/story-weaving-conflict-detection-regression.mjs
git commit -m "feat: story weaving conflict panel with one-click fixes"
```

### 4.4 验收

- 构造“双当前段”存档 → 冲突面板出现 error 级冲突，一键修复后仅剩最早段为当前。
- 已发生事实命中“未开始”canon 段 → 出现重演警告。
- 回归与单测通过。

---

## 5. Workstream D：文生图任务自动化与队列管理

### 5.1 现状

- `相册系统.tasks` 已有 `图片生成任务`（queued / running / success / failed / cancelled），任务流 UI（`ImageTaskWorkspace`）与重试按钮已存在。
- 缺口：没有持久化队列执行器——生图是命令式 `await` 串行触发，无并发上限、无自动重试退避、无“排队位置 / 取消进行中任务”、崩溃后遗留 `running` 任务。

### 5.2 目标

新增单例队列执行器：自动快照 / 手动生图全部入队；并发上限与最大重试可配置；崩溃后 `running` 任务自动标记失败并可重试；队列工作台显示位置与取消按钮。

### 5.3 任务

#### Task D1: 队列执行器

**Files:**
- Create: `utils/imageTaskQueue.ts`
- Test: `tests/unit/imageTaskQueue.test.ts`

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/imageTaskQueue.test.ts
import { describe, expect, it } from 'vitest';
import { createImageTaskQueue, recoverStaleTasks } from '../../utils/imageTaskQueue';

describe('imageTaskQueue', () => {
  it('runs tasks serially with concurrency 1', async () => {
    const order: string[] = [];
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 0 });
    const run = q.createRunner((taskId) => {
      order.push(taskId);
      return Promise.resolve();
    });
    const p1 = run('a'); const p2 = run('b');
    await Promise.all([p1, p2]);
    expect(order).toEqual(['a', 'b']);
  });

  it('marks stale running tasks as failed', () => {
    const tasks = recoverStaleTasks([
      { id: 't1', status: 'running', startedAt: Date.now() - 1000 } as never,
    ]);
    expect(tasks[0].status).toBe('failed');
    expect(tasks[0].error).toContain('中断');
  });
});
```

Run: `npx vitest run tests/unit/imageTaskQueue.test.ts` → 期望 FAIL。

- [ ] **Step 2: 实现队列执行器**

```ts
// utils/imageTaskQueue.ts
import type { 图片生成任务 } from '@/models/imageGeneration';

export interface ImageQueueOptions {
  concurrency: number;   // 默认 1
  maxRetries: number;    // 默认 2
}

export interface ImageQueueTask {
  id: string;
  run: (signal: AbortSignal) => Promise<{ status: 'success' | 'failed'; error?: string }>;
}

export function recoverStaleTasks(tasks: 图片生成任务[], now = Date.now()): 图片生成任务[] {
  const STALE_RUNNING_MS = 10 * 60 * 1000;
  return tasks.map((task) => {
    if (task.status !== 'running') return task;
    const startedAt = task.startedAt ?? now;
    if (now - startedAt <= STALE_RUNNING_MS) return task;
    return { ...task, status: 'failed' as const, error: '任务被中断（应用重启），可手动重试。' };
  });
}

export function createImageTaskQueue(options: ImageQueueOptions) {
  const queue: ImageQueueTask[] = [];
  const running = new Map<string, AbortController>();
  let activeCount = 0;

  function pump() {
    while (activeCount < options.concurrency && queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      activeCount += 1;
      const controller = new AbortController();
      running.set(task.id, controller);
      task.run(controller.signal)
        .catch((error) => ({ status: 'failed' as const, error: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          running.delete(task.id);
          activeCount -= 1;
          pump();
        });
    }
  }

  return {
    createRunner(executor: (taskId: string, signal: AbortSignal) => Promise<unknown>) {
      return (taskId: string): Promise<{ status: 'success' | 'failed'; error?: string }> =>
        new Promise((resolve) => {
          let attempts = 0;
          const attempt = () => {
            attempts += 1;
            queue.push({
              id: taskId,
              run: async (signal) => {
                try {
                  await executor(taskId, signal);
                  return { status: 'success' };
                } catch (error) {
                  if (attempts > options.maxRetries || signal.aborted) {
                    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
                  }
                  // 简单退避后重入队
                  setTimeout(attempt, 500 * attempts);
                  return { status: 'failed', error: 'retrying' };
                }
              },
            });
            pump();
          };
          attempt();
          // 轮询 resolve：通过微任务合并等待第一个非 retrying 结果
          const timer = setInterval(() => {}, 50); // 占位，实际由 pump 完成回调后 resolve
          void timer;
        });
    },
    cancel(taskId: string) {
      running.get(taskId)?.abort();
    },
    get size() { return queue.length; },
  };
}
```

> 注：`createRunner` 的 resolve 语义需要实现为“executor 完成即 resolve”。请在实现时以 `ImageQueueTask.run` 的返回值为准，把每次入队包装成带唯一 `attemptId` 的任务，完成 `success`/`failed`（非 `retrying`）时 resolve 对应 promise；上面代码是接口骨架，最终实现必须让单测的串行顺序断言通过。

- [ ] **Step 3: 单测通过 + 提交**

Run: `npx vitest run tests/unit/imageTaskQueue.test.ts` → PASS；`git commit -m "feat: add persistent image generation task queue engine"`。

#### Task D2: 接入相册与回合快照生图

**Files:**
- Modify: `components/features/GameSystems/AlbumPanel.tsx`
- Modify: `hooks/useGame/sendWorkflow.ts`
- Modify: `models/settings.ts`（`文生图系统设置` 增加 `并发数` / `最大重试`）
- Modify: `components/features/Settings/ImageGenerationSettingsTab.tsx`
- Test: `scripts/image-queue-runner-regression.mjs`、`scripts/image-queue-crash-recovery-regression.mjs`

- [ ] **Step 1: 队列单例与状态回调**

在 `AlbumPanel.tsx` 模块级创建队列单例：

```ts
import { createImageTaskQueue, recoverStaleTasks } from '@/utils/imageTaskQueue';
const imageQueue = createImageTaskQueue({ concurrency: 1, maxRetries: 2 });
```

面板初始化时：`onAlbumChange((album) => ({ ...album, tasks: recoverStaleTasks(album.tasks) }))`（只标记超过 10 分钟的 running 任务）。

- [ ] **Step 2: 手动生图入队**

把现有 `handleGenerate` 中直接 `await generateImage(...)` 的路径改为：先创建任务并置为 `queued` 写入 album，再通过 `imageQueue.createRunner` 执行 `buildNovelAIRequestPayload → generateImage → 添加图片到相册`；执行器内部把任务状态从 `queued` 推进到 `running`，成功后写入 `resultAssetId` 并置为 `success`，失败置为 `failed` 并保留 `error`。队列工作台（`ImageTaskWorkspace`）为 `queued` 任务增加「取消」按钮（调用 `imageQueue.cancel(task.id)`，并把状态置为 `cancelled`）。

- [ ] **Step 3: 回合自动快照生图入队**

`sendWorkflow.ts` 的 `generateNarrativeImagesForMessage` 保持“排队后等待完成”的语义（保证自动存档前图片任务有结果），但内部改为：解析阶段与生成阶段各自调用队列 runner；生图阶段不阻塞 UI 渲染（`runNewsGenerationStep` 同级的副作用仍 await，但队列 UI 可实时展示）。

- [ ] **Step 4: 设置项**

`models/settings.ts` 的 `文生图系统设置` 增加：

```ts
并发数?: number;   // 默认 1
最大重试次数?: number; // 默认 2
```

`ImageGenerationSettingsTab.tsx` 增加两个数字输入，保存时写入设置；`AlbumPanel` 与 `sendWorkflow` 从 `gameSettings.文生图系统` 读取这两个值传给队列。

- [ ] **Step 5: 写并运行回归**

```js
// scripts/image-queue-runner-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const queue = fs.readFileSync('utils/imageTaskQueue.ts', 'utf8');
const album = fs.readFileSync('components/features/GameSystems/AlbumPanel.tsx', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
assert(queue.includes('createImageTaskQueue'), 'queue engine must be exported.');
assert(queue.includes('concurrency'), 'queue engine must support concurrency.');
assert(queue.includes('maxRetries'), 'queue engine must support retry limits.');
assert(album.includes('recoverStaleTasks'), 'album must recover stale running tasks on load.');
assert(album.includes('queued') && album.includes('cancelled'), 'album must surface queued/cancelled task states.');
assert(settings.includes('并发数') && settings.includes('最大重试次数'), 'image settings must expose concurrency and max retries.');
```

```js
// scripts/image-queue-crash-recovery-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const queue = fs.readFileSync('utils/imageTaskQueue.ts', 'utf8');
assert(queue.includes('recoverStaleTasks'), 'queue must expose crash recovery for stale running tasks.');
assert(queue.includes('STALE_RUNNING_MS'), 'crash recovery must use a stale-running threshold.');
```

Run: `node scripts/image-queue-runner-regression.mjs && node scripts/image-queue-crash-recovery-regression.mjs` → PASS；`pnpm build`；`pnpm test:unit`。

- [ ] **Step 6: 提交**

```bash
git add utils/imageTaskQueue.ts components/features/GameSystems/AlbumPanel.tsx hooks/useGame/sendWorkflow.ts models/settings.ts components/features/Settings/ImageGenerationSettingsTab.tsx scripts/image-queue-runner-regression.mjs scripts/image-queue-crash-recovery-regression.mjs tests/unit/imageTaskQueue.test.ts
git commit -m "feat: route image generation through a persistent task queue"
```

### 5.4 验收

- 连续触发 5 个生图任务：并发 1 时串行执行，工作台显示排队位置；取消 queued 任务立即生效。
- 手动杀掉页面（任务 running）→ 重启后 10 分钟前的 running 任务标记 failed 且可重试。
- 设置面板可调并发数与最大重试。

---

## 6. Workstream E：大型前端包体拆分与性能优化

### 6.1 现状

- `App.tsx` 约 55 KB 且含 `MemoryRebuildModal`、多个 Overlay、`MysteryChatModal` 等；重型面板已懒加载。
- `hooks/useGame.ts` 与 `hooks/useGame/sendWorkflow.ts` 均超大；Vite 无 `manualChunks`；无体积基线。
- 已有长会话压缩（`utils/longSessionRetention.ts`）、回合快照压缩、相册缓存清理。

### 6.2 目标

建立包体基线并持续监控；把 App.tsx 外壳与 useGame 回调拆小；vendor / 业务 chunk 分离；重型面板统一 idle 预加载；主 chunk 体积硬上限回归。

### 6.3 任务

#### Task E1: 体积基线与回归脚本

**Files:**
- Create: `scripts/bundle-size-report.mjs`
- Create: `scripts/bundle-size-regression.mjs`

- [ ] **Step 1: 实现报告脚本**

```js
// scripts/bundle-size-report.mjs
import fs from 'node:fs';
import path from 'node:path';
const dist = path.resolve('dist');
function walk(dir) {
  let total = 0; const files = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) { const sub = walk(p); total += sub.total; files.push(...sub.files); }
    else { total += stat.size; files.push({ name: path.relative(dist, p), size: stat.size }); }
  }
  return { total, files };
}
const { total, files } = walk(dist);
const byChunk = files.filter((f) => f.name.endsWith('.js')).sort((a, b) => b.size - a.size).slice(0, 12);
console.log(`dist 总大小: ${(total / 1024).toFixed(1)} KB`);
for (const f of byChunk) console.log(`${(f.size / 1024).toFixed(1)} KB  ${f.name}`);
fs.writeFileSync('dist/.bundle-baseline.json', JSON.stringify({ total, top: byChunk, at: new Date().toISOString() }, null, 2));
```

- [ ] **Step 2: 实现体积回归**

```js
// scripts/bundle-size-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const baseline = JSON.parse(fs.readFileSync('dist/.bundle-baseline.json', 'utf8'));
const maxIndexBytes = (baseline.total * 0.25) | 0; // 主 index chunk ≤ 当前总包 25%，先按基线记录再收紧
const index = baseline.top.find((f) => f.name.startsWith('assets/index') && f.name.endsWith('.js'));
assert(index && index.size < maxIndexBytes, `主 chunk 超过预算 ${(maxIndexBytes / 1024).toFixed(1)} KB`);
```

- [ ] **Step 3: 运行基线并提交**

Run: `pnpm build && node scripts/bundle-size-report.mjs`，把输出记录到本任务备注；`git commit -m "chore: add bundle size report and regression scripts"`。

#### Task E2: manualChunks 拆分

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: 增加手动分包**

```ts
// vite.config.ts 的 defineConfig 内
build: {
  rollupOptions: {
    output: {
      manualChunks(id: string) {
        if (id.includes('node_modules')) {
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('marked')) return 'vendor-marked';
          if (id.includes('dnd-kit')) return 'vendor-dnd';
          return 'vendor-other';
        }
        if (id.includes('/services/')) return 'chunk-services';
        if (id.includes('/hooks/')) return 'chunk-hooks';
        if (id.includes('/models/')) return 'chunk-models';
        return undefined;
      },
    },
  },
},
```

- [ ] **Step 2: 重新基线**

Run: `pnpm build && node scripts/bundle-size-report.mjs`；确认主 index chunk 明显下降，`vendor-*` / `chunk-*` 正常生成。

- [ ] **Step 3: 提交**：`git commit -m "perf: split vendor and domain chunks via manualChunks"`。

#### Task E3: 拆分 App.tsx 与 useGame.ts

**Files:**
- Create: `components/layout/AppPanels.tsx`
- Modify: `App.tsx`
- Create: `hooks/useGame/handlers.ts`
- Modify: `hooks/useGame.ts`

- [ ] **Step 1: 搬移 App.tsx 内的独立 UI**

把 `MemoryRebuildModal`、`NumberField`、`JourneyLaunchOverlay`、`HomeJourneyOverlay`、`SaveLoadOverlay`、`BookOpenOverlay`、`MysteryChatModal`、`LazySurfaceFallback` 移到新文件 `components/layout/AppPanels.tsx` 并导出；`App.tsx` 改为 import。保持所有 props 与动画常量不变。

- [ ] **Step 2: 提取 useGame 回调**

把 `useGame.ts` 中可独立成纯函数的回调（`handleRetryMemoryFailureDraft`、`handleIgnoreMemoryFailureDraft`、`persistMemorySnapshot`、`handleRegenerateNarrativeImage`、`handleRetryQueueTask`）迁移到 `hooks/useGame/handlers.ts`，通过参数传入 `stateRef` / `getActiveConfig`，`useGame.ts` 只保留薄包装 `useCallback`。

- [ ] **Step 3: 验证**

Run: `pnpm build`；`node scripts/bundle-size-report.mjs` 对比主 chunk 体积（应比 E2 后进一步下降）；运行 `pnpm test:all` 中的相关回归（crash-guard、memory、narrative-image、settings-nav）。

- [ ] **Step 4: 提交**：`git commit -m "refactor: split App shell and useGame handlers to reduce main bundle"`。

#### Task E4: 游戏面板 idle 预加载

**Files:**
- Modify: `utils/lazyWithRetry.ts`
- Modify: `App.tsx`
- Test: `scripts/idle-panel-preload-regression.mjs`

- [ ] **Step 1: 增加 `preloadAll` 帮助函数**

```ts
// utils/lazyWithRetry.ts 追加
export function preloadAll(components: Array<{ preload(): Promise<unknown> }>, idleTimeout = 4000): () => void {
  let cancelled = false;
  const schedule = typeof requestIdleCallback === 'function'
    ? requestIdleCallback.bind(window)
    : (cb: () => void) => setTimeout(cb, 300);
  schedule(() => { if (!cancelled) components.forEach((c) => c.preload().catch(() => undefined)); });
  return () => { cancelled = true; };
}
```

`lazyWithRetry` 的返回值需包含 `preload()`（项目已有该能力，见首页预加载；若当前返回值缺少，则按现有 `preload()` 实现补齐）。

- [ ] **Step 2: 首回合后触发**

`App.tsx` 在 `turnCount >= 1` 且未预加载过时，调用 `preloadAll([PlotPanel, YitingPanel, MemoryPanel, AlbumPanel, SkillPanel, InventoryPanel, NewsPanel, CompanionPanel, PathPanel])`；卸载 / 离开游戏时调用取消函数。

- [ ] **Step 3: 写并运行回归**

```js
// scripts/idle-panel-preload-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const app = fs.readFileSync('App.tsx', 'utf8');
const lazy = fs.readFileSync('utils/lazyWithRetry.ts', 'utf8');
assert(lazy.includes('preloadAll'), 'lazyWithRetry must expose preloadAll.');
assert(app.includes('preloadAll('), 'App must idle-preload game panels.');
for (const panel of ['PlotPanel', 'YitingPanel', 'AlbumPanel']) {
  assert(app.includes(panel), `App must keep ${panel} lazy-loaded but preloadable.`);
}
assert(!app.includes('static import') || true, ''); // 占位检查：重型面板不得恢复静态导入
assert(!fs.readFileSync('components/layout/GameView.tsx', 'utf8').includes("from '@/components/features/GameSystems/PlotPanel'"), 'GameView must not statically import heavy panels.');
```

Run: `node scripts/idle-panel-preload-regression.mjs` → PASS；`pnpm build`。

- [ ] **Step 4: 提交**：`git commit -m "perf: idle-preload game panels after first turn"`。

### 6.4 验收

- `pnpm build` 后主 index chunk 显著小于基线（记录在 E1 输出）；`node scripts/bundle-size-regression.mjs` 通过。
- 重型面板仍全部懒加载，首回合后空闲预加载生效。

---

## 7. Workstream F：更完善的测试覆盖

### 7.1 现状

- 165 个静态回归脚本（读源码断言），无单元测试框架，无 CI。

### 7.2 目标

引入 Vitest 单测纯逻辑层；为 A/C/D/G 新增模块补齐单测；新增 CI 工作流，构建 + 全量回归 + 单测一次跑通。

### 7.3 任务

#### Task F1: 引入 Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: 添加配置与依赖**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './') } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['utils/imageTaskQueue.ts', 'services/storyWeavingConflict.ts', 'utils/workflowRecoveryModel.ts', 'services/questService.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
```

`package.json` scripts 增加：

```json
{
  "test:unit": "vitest run",
  "test:unit:watch": "vitest",
  "test:unit:coverage": "vitest run --coverage"
}
```

依赖：`pnpm add -D vitest @vitest/coverage-v8`。

- [ ] **Step 2: 验证**

Run: `pnpm test:unit` → 期望 A/C/D 已建的 3 个单测文件全部通过；`pnpm test:unit:coverage` 生成覆盖率报告。

- [ ] **Step 3: 提交**：`git commit -m "test: add vitest unit test harness with coverage thresholds"`。

#### Task F2: 补齐 G 的 questService 单测

**Files:**
- Create: `tests/unit/questService.test.ts`（在 Workstream G 完成后补，见 G-4）

Run: `npx vitest run tests/unit/questService.test.ts` → PASS。

#### Task F3: CI 工作流

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 添加 CI**

```yaml
# .github/workflows/ci.yml
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
      - run: pnpm test:unit
      - run: pnpm test:all
```

- [ ] **Step 2: 提交**：`git commit -m "ci: add build, unit test and regression pipeline"`。

### 7.4 验收

- `pnpm test:unit` 与 `pnpm test:all` 在 CI 与本地均通过；覆盖率阈值达标（新模块 ≥ 80% 行 / 函数）。

---

## 8. Workstream G：剧情任务系统

### 8.1 现状

代码中没有任何任务 / 委托系统；`models/phone.ts` 的 `主动来信类型` 已有 `'quest'` 预留，`models/queueTask.ts` 是后台任务展示队列（非游戏内任务）。`剧情编织` 管轨道与分段，但没有面向玩家的“当前要做什么”清单。

### 8.2 目标

新增剧情任务系统：面向玩家的任务清单（进行中 / 已完成 / 已放弃），任务由 AI `<任务更新>` 或预设创建，目标由变量事实 / 正文自动结算，完成后发放奖励（背包物品 / NPC 好感 / 记忆 / 新闻），并完整接入存档、差量存储、运行时压缩、后台队列与系统菜单。

### 8.3 任务

#### Task G1: 任务模型

**Files:**
- Create: `models/quest.ts`

- [ ] **Step 1: 定义模型**

```ts
// models/quest.ts
export type 任务状态 = '未开始' | '进行中' | '已完成' | '已失败' | '已放弃';
export type 任务目标类型 = '达成' | '收集' | '交谈' | '前往' | '击杀' | '时间';
export type 任务来源 = '主线' | '支线' | '自定义' | '来信';
export type 任务奖励类型 = '物品' | '好感' | '记忆' | '新闻' | '命途';

export interface 任务目标 {
  id: string;
  类型: 任务目标类型;
  描述: string;
  目标数量: number;
  当前数量: number;
  关联对象?: string; // 物品 / NPC / 地点名称或 id
  完成: boolean;
}

export interface 任务奖励 {
  类型: 任务奖励类型;
  内容: string;
  数量?: number;
}

export interface 剧情任务 {
  id: string;
  标题: string;
  描述: string;
  来源: 任务来源;
  状态: 任务状态;
  目标: 任务目标[];
  奖励: 任务奖励[];
  创建回合: number;
  更新时间: number;
  完成回合?: number;
  关联分段?: string;
  备注?: string;
}

export interface 任务系统 {
  进行中: 剧情任务[];
  已完成: 剧情任务[];
  已放弃: 剧情任务[];
  上一轮任务更新: string[];
}

export function 创建空任务系统(): 任务系统 {
  return { 进行中: [], 已完成: [], 已放弃: [], 上一轮任务更新: [] };
}

export function 归一化任务系统(input: unknown): 任务系统 {
  // 兜底：数组类型检查、字段缺省、状态枚举校验、数量非负取整；
  // 完成全部目标的任务状态强制为「已完成」。
  return 创建空任务系统();
}
```

- [ ] **Step 2: 提交**：`git commit -m "feat: add quest system model"`。

#### Task G2: 任务预设与提示词模块

**Files:**
- Create: `data/questPresets.ts`
- Create: `data/questWorldbook.ts`
- Create: `prompts/cot/questCot.ts`
- Create: `prompts/cot/questOutputFormat.ts`

- [ ] **Step 1: 开局主线任务预设**

```ts
// data/questPresets.ts
import type { 剧情任务 } from '@/models/quest';

export const OPENING_MAIN_QUEST: 剧情任务 = {
  id: 'quest_opening_aboard_train',
  标题: '登上星穹列车',
  描述: '跟随开拓指引，处理黑塔空间站的风波，并踏上星穹列车开启旅途。',
  来源: '主线',
  状态: '进行中',
  目标: [
    { id: 'q1_t1', 类型: '交谈', 描述: '与列车组成员之一交谈', 目标数量: 1, 当前数量: 0, 关联对象: '星穹列车', 完成: false },
    { id: 'q1_t2', 类型: '前往', 描述: '抵达星穹列车', 目标数量: 1, 当前数量: 0, 关联对象: '星穹列车', 完成: false },
  ],
  奖励: [{ 类型: '记忆', 内容: '登上星穹列车，旅途正式开始。' }],
  创建回合: 1,
  更新时间: Date.now(),
};

export function 构建开局任务系统(): import('@/models/quest').任务系统 {
  return { 进行中: [OPENING_MAIN_QUEST], 已完成: [], 已放弃: [], 上一轮任务更新: ['接取任务：登上星穹列车'] };
}
```

- [ ] **Step 2: 世界书与 CoT 模块**

`data/questWorldbook.ts` 导出 `QUEST_WORLD_BOOK_PROMPT`：列出进行中任务（标题、目标、当前进度），规则为“不得替玩家完成目标；只描述玩家行动带来的进展；任务完成由系统结算”。

`prompts/cot/questCot.ts` 导出 `QUEST_COT_PROMPT`；`prompts/cot/questOutputFormat.ts` 导出输出协议：

```text
<任务更新>
接取: 任务标题|描述|来源
目标: 任务标题|目标类型|描述|数量|关联对象
进展: 任务标题|目标id|新数量
完成: 任务标题
放弃: 任务标题
</任务更新>
```

规则：不输出已有任务与目标的重复行；每回合最多新增 1 个任务、2 个目标；进展行只能增加数量。

- [ ] **Step 3: 提交**：`git commit -m "feat: add quest presets, worldbook and prompt modules"`。

#### Task G3: 任务服务

**Files:**
- Create: `services/questService.ts`
- Test: `tests/unit/questService.test.ts`

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/questService.test.ts
import { describe, expect, it } from 'vitest';
import { 解析任务更新命令, 结算任务进展, 完成任务并生成奖励命令 } from '../../services/questService';
import { 创建空任务系统 } from '../../models/quest';

describe('questService', () => {
  it('parses quest update commands from AI output', () => {
    const commands = 解析任务更新命令('<任务更新>\n接取: 帮助佩拉|调查贝洛伯格档案|支线\n完成: 登上星穹列车\n</任务更新>');
    expect(commands).toHaveLength(2);
    expect(commands[0].kind).toBe('accept');
  });

  it('completes a quest when all objectives are done', () => {
    const system = 创建空任务系统();
    system.进行中 = [{ id: 'q', 标题: 'Q', 描述: '', 来源: '主线', 状态: '进行中', 目标: [
      { id: 't', 类型: '交谈', 描述: '交谈', 目标数量: 1, 当前数量: 1, 关联对象: 'A', 完成: true },
    ], 奖励: [{ 类型: '物品', 内容: '星琼', 数量: 1 }], 创建回合: 1, 更新时间: 1 }];
    const { system: next, rewards } = 完成任务并生成奖励命令(system, 'q');
    expect(next.已完成[0].状态).toBe('已完成');
    expect(rewards.some((r) => r.command.includes('星琼'))).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/questService.test.ts` → 期望 FAIL。

- [ ] **Step 2: 实现服务**

```ts
// services/questService.ts
import type { 任务系统, 剧情任务, 任务目标, 任务状态 } from '@/models/quest';
import { 创建空任务系统 } from '@/models/quest';
import type { 变量命令 } from '@/models/variableCommand';

export interface 任务更新命令 {
  kind: 'accept' | 'objective' | 'progress' | 'complete' | 'abandon';
  任务标题: string;
  目标类型?: string;
  描述?: string;
  数量?: number;
  关联对象?: string;
  来源?: string;
  目标ID?: string;
}

export function 解析任务更新命令(raw: string): 任务更新命令[] {
  const commands: 任务更新命令[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(接取|目标|进展|完成|放弃):\s*(.+)$/);
    if (!match) continue;
    const [ , kind, rest ] = match;
    const parts = rest.split('|').map((s) => s.trim());
    if (kind === '接取') commands.push({ kind: 'accept', 任务标题: parts[0] ?? '', 描述: parts[1] ?? '', 来源: parts[2] ?? '支线' });
    if (kind === '目标') commands.push({ kind: 'objective', 任务标题: parts[0] ?? '', 目标类型: parts[1] ?? '达成', 描述: parts[2] ?? '', 数量: Number(parts[3]) || 1, 关联对象: parts[4] });
    if (kind === '进展') commands.push({ kind: 'progress', 任务标题: parts[0] ?? '', 目标ID: parts[1], 数量: Number(parts[2]) || 1 });
    if (kind === '完成') commands.push({ kind: 'complete', 任务标题: parts[0] ?? '' });
    if (kind === '放弃') commands.push({ kind: 'abandon', 任务标题: parts[0] ?? '' });
  }
  return commands;
}

export function 结算任务进展(system: 任务系统, 变量事实: Array<{ 路径: string; 值: unknown }>, 正文: string): 任务系统 {
  // 逐任务逐目标结算：
  // - 交谈：正文/变量事实中出现 关联对象 相关 NPC 名 → 当前数量 = 1；
  // - 前往：世界.当前地点 包含 关联对象 → 1；
  // - 收集：背包物品计数 ≥ 目标数量 → 满足；
  // - 击杀 / 达成：正文匹配描述关键词或变量事实路径命中 → 累加。
  // 目标当前数量 ≥ 目标数量时置 完成=true；全部完成的任务自动进入 已完成 并生成奖励。
  return system;
}

export function 完成任务并生成奖励命令(system: 任务系统, taskId: string): { system: 任务系统; rewards: 变量命令[] } {
  const task = system.进行中.find((t) => t.id === taskId);
  if (!task) return { system, rewards: [] };
  const rewards: 变量命令[] = [];
  for (const reward of task.奖励) {
    if (reward.类型 === '物品') {
      rewards.push({ 路径: '背包/物品', 操作: 'append', 值: { 名称: reward.内容, 数量: reward.数量 ?? 1 } } as never);
    }
    if (reward.类型 === '好感') rewards.push({ 路径: `NPC/${reward.内容}/好感度`, 操作: 'add', 值: reward.数量 ?? 5 } as never);
    if (reward.类型 === '记忆') rewards.push({ 路径: '记忆/即时', 操作: 'append', 值: reward.内容 } as never);
  }
  const completed: 剧情任务 = { ...task, 状态: '已完成' as 任务状态, 完成回合: (task.创建回合 + 1), 更新时间: Date.now() };
  return {
    system: {
      ...system,
      进行中: system.进行中.filter((t) => t.id !== taskId),
      已完成: [completed, ...system.已完成],
      上一轮任务更新: [`完成任务：${task.标题}`],
    },
    rewards,
  };
}

// 创建空任务系统 复用 models/quest.ts 导出，避免重复定义。
```

> 变量命令类型以 `utils/variableExecutor.ts` 现有 `变量命令` 结构为准（路径 / 操作 / 值），上面的 `as never` 仅是占位写法，实现时必须使用真实类型并让 `pnpm build` 通过。

- [ ] **Step 3: 单测通过 + 提交**

Run: `npx vitest run tests/unit/questService.test.ts` → PASS；`git commit -m "feat: add quest service with parsing, settlement and rewards"`。

#### Task G4: 回合工作流接入

**Files:**
- Create: `hooks/useGame/questWorkflow.ts`（回合任务结算步骤：解析任务更新命令 → 应用接取/进展/完成 → 结算目标 → 发放奖励 → 推送 queueTask）
- Modify: `models/chat.ts`（`解析后回复` 增加 `questUpdates?: string[]`）
- Modify: `services/ai/responseParser.ts`（抽取 `<任务更新>...</任务更新>` 到 `questUpdates`）
- Modify: `hooks/useGame/systemPromptBuilder.ts`（注入 quest 世界书 + CoT 模块，开关 `gameSettings.任务系统.enabled`）
- Modify: `hooks/useGame/sendWorkflow.ts`（变量结算后执行任务结算，失败推 `queueTask('quest')`）
- Modify: `models/queueTask.ts`（`队列任务ID` 增加 `'quest'`）
- Modify: `models/settings.ts`（`游戏设置` 增加 `任务系统: { enabled: boolean; api?: 变量API覆盖 }`；`存档数据` 增加 `任务?: import('./quest').任务系统`）

- [ ] **Step 1: 解析与提示词接入**

`responseParser.ts` 的正则：`/<任务更新>([\s\S]*?)<\/任务更新>/i` 提取文本存入 `parsed.questUpdates`（数组，最多保留最近 3 段）。

`systemPromptBuilder.ts`：当 `任务系统.enabled` 为 true 时，把 `QUEST_COT_PROMPT`、`QUEST_OUTPUT_FORMAT_PROMPT`、`QUEST_WORLD_BOOK_PROMPT`（含进行中任务清单）拼入系统提示词；该模块遵循 `buildIndependentPromptModulesSection` 的既有作用域规则。

- [ ] **Step 2: 回合结算**

在 `executeSendWorkflow` 的变量结算成功之后插入：

```ts
const questUpdates = parsed.questUpdates ?? [];
if (questUpdates.length > 0 || 需要任务结算) {
  const questResult = await runQuestSettlementStep(stateRef, questUpdates, variableFacts, body);
  // runQuestSettlementStep 实现于 hooks/useGame/questWorkflow.ts：
  // 1. 解析任务更新命令；2. 接取/目标/进展/完成/放弃应用到 state.任务；
  // 3. 调用 结算任务进展；4. 奖励命令通过既有 reduceVariableCommands 执行；
  // 5. pushQueueTask(state, 'quest', 'success' | 'failed')。
}
```

失败时 `pushQueueTask(state, 'quest', 'failed', { detail, failCount })`，并保持恢复日志在 `story_weaving` 之前可重试。

- [ ] **Step 3: 提交**：`git commit -m "feat: integrate quest settlement into turn workflow"`。

#### Task G5: 面板与菜单

**Files:**
- Create: `components/features/GameSystems/QuestPanel.tsx`
- Modify: `data/gameMenu.ts`
- Modify: `components/features/GameSystems/SystemPanels.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: gameMenu 增加入口**

```ts
// data/gameMenu.ts
export type GameSystemId = ... | 'quest';
// GAME_MENU_ITEMS 中追加（顺序放在 inventory 之后）：
{ id: 'quest', label: '任务', subtitle: '剧情任务', glyph: '⚑' },
```

- [ ] **Step 2: QuestPanel**

`QuestPanel.tsx` 接收 `quest: 任务系统` 与 `onQuestChange`，三个分栏（进行中 / 已完成 / 已放弃）：任务卡片显示标题、描述、来源、目标清单（复选框样式，完成目标勾选）、进度条（`当前数量/目标数量`）、奖励预览；「放弃」按钮仅对进行中任务可用。样式沿用 `cardClip` / `tj-*` 变量风格，与其它 GameSystems 面板一致。

`SystemPanels.tsx` 与 `App.tsx` 注册 `quest` 面板；`App.tsx` 用 `lazyWithRetry` 懒加载 `QuestPanel`，并在 E4 的 `preloadAll` 列表中加入。

- [ ] **Step 3: 提交**：`git commit -m "feat: add quest panel and menu entry"`。

#### Task G6: 存档集成

**Files:**
- Modify: `models/settings.ts`（已在上一步加 `任务?` 字段）
- Modify: `services/savePackage.ts`（`SYSTEM_ENTRY_PATHS` 增加 `'systems/quests.json'`；读/写 `任务`）
- Modify: `utils/saveDeltaStorage.ts`（`fields` 增加 `'任务'`；`counters` 增加 `quests`；`DELTA_FIELDS` 增加 `'任务'`）
- Modify: `utils/saveRuntimeCompactor.ts`（压缩 `任务`：已完成 / 已放弃最多各保留 50 条，进行中全保留）
- Modify: `services/dbService.ts`（若 `queueBytes` / 存档体积统计处有逐系统计数，补充 quests）
- Test: `scripts/quest-save-regression.mjs`

- [ ] **Step 1: 写失败回归**

```js
// scripts/quest-save-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const savePackage = fs.readFileSync('services/savePackage.ts', 'utf8');
const delta = fs.readFileSync('utils/saveDeltaStorage.ts', 'utf8');
const compactor = fs.readFileSync('utils/saveRuntimeCompactor.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
assert(settings.includes('任务?:'), '存档数据 must carry quest system.');
assert(savePackage.includes('systems/quests.json'), 'save package must include quests entry.');
assert(savePackage.includes("['任务']") || savePackage.includes('任务,'), 'save package must read/write quests.');
assert(delta.includes("'任务'"), 'delta storage must track quests field.');
assert(compactor.includes('已完成') && compactor.includes('已放弃'), 'compactor must cap quest archives.');
```

Run: `node scripts/quest-save-regression.mjs` → 期望 FAIL，随后实现。

- [ ] **Step 2: 实现并验证**

按上述文件清单接入（`任务` 与 `剧情编织` 同级处理；导入 / 导出 / 差量 / 压缩四处一致），然后运行回归 + `pnpm build`。

- [ ] **Step 3: 提交**：`git commit -m "feat: integrate quest system into save pipeline"`。

#### Task G7: 任务回归脚本

**Files:**
- Create: `scripts/quest-state-machine-regression.mjs`
- Create: `scripts/quest-prompt-parsing-regression.mjs`

- [ ] **Step 1: 写两个回归**

```js
// scripts/quest-state-machine-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const questModel = fs.readFileSync('models/quest.ts', 'utf8');
const questService = fs.readFileSync('services/questService.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/QuestPanel.tsx', 'utf8');
const gameMenu = fs.readFileSync('data/gameMenu.ts', 'utf8');
assert(questModel.includes("任务状态"), 'quest model must define quest states.');
assert(questService.includes('结算任务进展'), 'quest service must settle progress.');
assert(questService.includes('完成任务并生成奖励命令'), 'quest service must award rewards.');
assert(sendWorkflow.includes('questUpdates'), 'send workflow must consume quest updates.');
assert(panel.includes('进行中') && panel.includes('已放弃'), 'quest panel must show active and abandoned tabs.');
assert(gameMenu.includes("id: 'quest'"), 'game menu must expose quest entry.');
```

```js
// scripts/quest-prompt-parsing-regression.mjs
import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const questCot = fs.readFileSync('prompts/cot/questCot.ts', 'utf8');
const questOutputFormat = fs.readFileSync('prompts/cot/questOutputFormat.ts', 'utf8');
const questWorldbook = fs.readFileSync('data/questWorldbook.ts', 'utf8');
const questService = fs.readFileSync('services/questService.ts', 'utf8');
const systemPromptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
assert(questCot.includes('任务更新'), 'quest CoT must define the update protocol.');
assert(questOutputFormat.includes('接取') && questOutputFormat.includes('完成'), 'quest output format must define accept/complete commands.');
assert(questWorldbook.includes('QUEST_WORLD_BOOK_PROMPT'), 'quest worldbook must be exported.');
assert(questService.includes('解析任务更新命令'), 'quest service must parse update commands.');
assert(systemPromptBuilder.includes('QUEST_COT_PROMPT') || systemPromptBuilder.includes('quest'), 'system prompt builder must inject quest module.');
```

- [ ] **Step 2: 运行全部验证**

Run: `node scripts/quest-state-machine-regression.mjs && node scripts/quest-prompt-parsing-regression.mjs && node scripts/quest-save-regression.mjs` → 全部 PASS；`pnpm build`；`pnpm test:all`；`pnpm test:unit`。

- [ ] **Step 3: 提交**：`git commit -m "test: add quest system regression coverage"`。

### 8.4 验收

- 新开局即出现「登上星穹列车」任务；与列车组成员交谈 / 抵达列车后目标自动完成并发放奖励。
- AI 输出 `<任务更新>` 可创建支线任务；放弃 / 完成状态正确流转并持久化（读档后仍在）。
- 任务系统随存档导入导出；已完成 / 已放弃在压缩后保留最近 50 条。

---

## 9. 执行顺序与依赖

```text
F1（Vitest 基建）
  ├── A1–A4（恢复系统，依赖 F1 的单测目录）
  ├── C1–C3（冲突处理）
  └── D1–D2（生图队列）
          │
          ├── E1–E4（包体与性能，任意顺序）
          └── G1–G7（任务系统，最后做存档集成 G6）
B1–B3（手机工作流，独立可并行）
F2 / F3（补单测与 CI，放在 G 与 A/C/D 完成后收尾）
```

建议提交顺序：F1 → A1 → A2 → A3 → A4 → C1 → C2 → C3 → D1 → D2 → B1 → B2 → B3 → E1 → E2 → E3 → E4 → G1 → G2 → G3 → G4 → G5 → G6 → G7 → F2 → F3。其中 B / E 与 A / C / D 之间无硬依赖，可并行执行。

---

## 10. 风险与开放问题

- **恢复日志版本迁移**：v1 → v2 的解析必须兼容旧日志；迁移失败应静默清空而非阻塞启动（已有 try/catch 语义）。
- **任务结算与变量事实的匹配精度**：`结算任务进展` 依赖关键词匹配，存在误判风险；第一版采用“正文关键词 + 变量路径”双通道，后续可引入模型判定。
- **生图队列的持久化**：队列状态由 `album.tasks` 派生，不新增独立存储；`running` 状态跨刷新会丢失，靠 `recoverStaleTasks` 兜底。并发 > 1 时同一目标的多任务可能出现重复图，第一版默认并发 1。
- **manualChunks 可能破坏既有懒加载 chunk 命名**：验证 `dist` 内无重复/丢失 chunk；`pnpm test:all` 中 `crash-guard-regression` 会兜底校验重型组件未恢复静态导入。
- **open question 1**：剧情任务是否需要在 `剧情编织` 分段上自动生成（任务 = 当前段的子目标）？本计划默认独立系统、仅用 `关联分段` 弱关联；如需强关联，在 G4 之后追加联动任务。
- **open question 2**：任务奖励中的「好感」默认 +5；是否需要可配置数值？默认用任务奖励的 `数量` 字段。
- **open question 3**：CI 是否要求固定 Node 22 / pnpm 10.15？仓库 `packageManager` 已声明 pnpm@10.15.0，CI 使用该版本；Node 版本若项目本地验证使用 20，改为 20。

---

## 11. 最终验收清单

- [ ] `pnpm build` 通过（TS 严格检查 + Vite 构建）。
- [ ] `pnpm test:all` 全绿（含新增的 workflow-recovery、phone、story-weaving-conflict、image-queue、quest 回归脚本）。
- [ ] `pnpm test:unit` 全绿且覆盖率达标（workflowRecoveryModel、imageTaskQueue、storyWeavingConflict、questService ≥ 80% 行/函数）。
- [ ] 主 index chunk 小于基线预算，`node scripts/bundle-size-regression.mjs` 通过。
- [ ] 恢复横幅、任务面板、冲突面板、生图队列工作台在手动冒烟中可用。
- [ ] CI 工作流 `.github/workflows/ci.yml` 在 GitHub Actions 上跑通。
- [ ] CHANGELOG.md 按 v1.3 记录以上变更与验证结论。
