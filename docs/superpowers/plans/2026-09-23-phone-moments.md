# Player Phone Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家可在手机发布、编辑、删除纯文字朋友圈；每条动态至多收到三位已认识且好感度严格大于 100 的 NPC 独立生成的评论。

**Architecture:** 朋友圈是 `CourierSystem` 的正式、可存档状态；纯函数负责验证、资格选择和幂等写回。模型每位 NPC 单独调用一次；异步协调器在提交时复核会话、帖子修订号、NPC 资格，UI 只负责操作和状态展示。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom、现有手机 AI 配置与 `chatCompletion`。

**Spec:** `docs/superpowers/specs/2026-09-23-phone-moments-and-turn-consistency-design.md`

## Global Constraints

- 仅玩家发纯文字动态；不做图片、点赞、转发、NPC 发帖或好感度奖励。
- 正文去空白后 1–500 字，最多 500 条帖子；超过上限要报错，不得静默删除。
- 评论正文 1–120 字，每帖最多三名不同 NPC；资格要求手机联系人唯一关联已认识 NPC 且 `好感度 > 100`。
- 编辑清空旧评论并使旧异步结果失效；删除可撤销；加载时 `generating` 改为可重试的 `failed`。
- 模型不可获知其他 NPC 私密记忆；失败不能用固定套话伪装为评论；不得覆盖当前脏工作树。

## Review Focus

1. 恰好 100 点好感不能评论，101 点可以（Task 2 测试）。
2. 同名联系人或缺少稳定 `npcId` 不得造成两次评论（Task 2 测试）。
3. 切档、编辑、删除或降好感后返回的旧模型结果不得入档（Task 3 测试）。
4. 读档后遗留的 `generating` 必须可重试而非永久转圈（Task 1 测试）。
5. 窄屏下发帖、编辑、删除撤销和私聊切换必须可触达，不重置聊天滚动（Task 4 测试及手测）。

---

### Task 1: 正式状态与归一化

**Files:**
- Modify: `models/teyvat/courier.ts`
- Test: `tests/unit/courierMomentsState.test.ts` (create)

**Interfaces:**
- Produces: `CourierMoment`, `CourierMomentComment`, `CourierMomentTarget`; `CourierSystem.moments?: CourierMoment[]`（可选以兼容现有 TypeScript 测试夹具，`createEmptyCourierSystem` 与 `normalizeCourierSystem` 均返回数组）。
- Consumes: existing `createEmptyCourierSystem()` and `normalizeCourierSystem(value)`.

- [ ] **Step 1: 写归一化 RED 用例**

```ts
import { expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';

it('adds an empty moments slice to old saves', () => {
  expect(createEmptyCourierSystem().moments).toEqual([]);
  expect(normalizeCourierSystem({ contacts: [] }).moments).toEqual([]);
});
it('recovers interrupted comment generation and rejects duplicate identities', () => {
  const result = normalizeCourierSystem({ moments: [{ id: 'p1', authorId: 'player', content: '今天真好', turn: 2, createdAt: 1, updatedAt: 1, revision: 1, targets: [{ npcId: 'amber', status: 'generating' }, { npcId: 'amber', status: 'done' }], comments: [] }] });
  expect(result.moments?.[0]?.targets).toEqual([{ npcId: 'amber', status: 'failed' }]);
});
```

- [ ] **Step 2: 运行 RED**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsState.test.ts`；预期 `moments` 不存在。
- [ ] **Step 3: 写最小数据结构与归一化**

```ts
export interface CourierMomentComment { id: string; npcId: string; npcName: string; content: string; createdAt: number }
export interface CourierMomentTarget { npcId: string; status: 'generating' | 'done' | 'failed' }
export interface CourierMoment {
  id: string; authorId: 'player'; content: string; turn: number;
  createdAt: number; updatedAt: number; revision: number;
  targets: CourierMomentTarget[]; comments: CourierMomentComment[];
}
// In CourierSystem add: moments?: CourierMoment[];
// In createEmptyCourierSystem return: moments: [].
function normalizeMoment(value: unknown): CourierMoment | null {
  if (!isRecord(value) || value.authorId !== 'player') return null;
  const id = text(value.id).trim();
  const content = text(value.content).trim();
  if (!id || !content || content.length > 500) return null;
  const seenTargets = new Set<string>();
  const targets = (Array.isArray(value.targets) ? value.targets : []).flatMap((target) => {
    if (!isRecord(target)) return [];
    const npcId = text(target.npcId).trim();
    if (!npcId || seenTargets.has(npcId) || seenTargets.size >= 3) return [];
    seenTargets.add(npcId);
    return [{ npcId, status: target.status === 'done' ? 'done' as const : 'failed' as const }];
  });
  const seenComments = new Set<string>();
  const comments = (Array.isArray(value.comments) ? value.comments : []).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const npcId = text(entry.npcId).trim();
    const comment = text(entry.content).trim();
    if (!npcId || !comment || comment.length > 120 || seenComments.has(npcId) || seenComments.size >= 3) return [];
    seenComments.add(npcId);
    return [{ id: text(entry.id), npcId, npcName: text(entry.npcName), content: comment, createdAt: Number(entry.createdAt) || 0 }];
  });
  return { id, authorId: 'player', content, turn: integer(value.turn), createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0, revision: Math.max(1, integer(value.revision)),
    targets: targets.map((target) => target.status === 'done' && !comments.some((comment) => comment.npcId === target.npcId)
      ? { ...target, status: 'failed' } : target), comments };
}
// In normalizeCourierSystem: flatMap(normalizeMoment), then filter duplicate post IDs.
// Preserve all valid existing posts even when a malformed old save has >500;
// createMoment blocks new posts until the count falls below 500.
```

- [ ] **Step 4: 运行 GREEN 和存档回归**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsState.test.ts tests/unit/teyvatSaveContract.test.ts`；预期通过。补一条 normalize→serialize→normalize 保留有效帖子/评论的断言。

### Task 2: 玩家操作与评论资格纯函数

**Files:**
- Create: `services/courierMoments.ts`
- Test: `tests/unit/courierMomentsActions.test.ts` (create)

**Interfaces:**
- Consumes: `CourierSystem`, `NPC记录[]`, `NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD`.
- Produces: `createMoment(system, input): CourierSystem`, `editMoment(system, id, content, now): CourierSystem`, `deleteMoment(system, id): CourierSystem`, `selectMomentCommenters(momentId, contacts, npcs): NPC记录[]`, `markMomentTarget(system, postId, revision, npcId, status): CourierSystem`, `appendMomentComment(system, postId, revision, comment): CourierSystem`.
- `input` is `{ id: string; content: string; turn: number; now: number }`; invalid operations throw `Error('MOMENT_EMPTY' | 'MOMENT_TOO_LONG' | 'MOMENT_LIMIT' | 'MOMENT_NOT_FOUND')`.

- [ ] **Step 1: 写 RED 用例**

```ts
import { expect, it } from 'vitest';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { createMoment, editMoment, deleteMoment, selectMomentCommenters } from '@/services/courierMoments';

it('creates, revises and deletes text without silently discarding it', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '  今天到蒙德了  ', turn: 3, now: 100 });
  expect(created.moments?.[0]?.content).toBe('今天到蒙德了');
  const edited = editMoment(created, 'p1', '见到了安柏', 101);
  expect(edited.moments?.[0]).toMatchObject({ content: '见到了安柏', revision: 2, comments: [], targets: [] });
  expect(deleteMoment(edited, 'p1').moments).toEqual([]);
  expect(() => createMoment(created, { id: 'p2', content: ' ', turn: 3, now: 102 })).toThrow('MOMENT_EMPTY');
});
it('requires unique known contact and affinity strictly above 100', () => {
  const contacts = [{ id: 'c1', npcId: 'amber', name: '安柏', available: true }, { id: 'c2', npcId: 'amber', name: '安柏', available: true }];
  const npcs = [创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), 创建NPC记录({ 姓名: '丽莎', 初见回合: 1 })]
    .map((npc) => npc.姓名 === '安柏' ? { ...npc, id: 'amber', 好感度: 101 } : { ...npc, id: 'lisa', 好感度: 100 });
  expect(selectMomentCommenters('p1', contacts, npcs).map((npc) => npc.id)).toEqual(['amber']);
});
```

Import `创建NPC记录` from `@/models/npc` at the top of the test.

- [ ] **Step 2: 运行 RED**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsActions.test.ts`；预期函数不存在。
- [ ] **Step 3: 实现纯函数**

```ts
const MAX_POSTS = 500;
export function createMoment(system: CourierSystem, input: { id: string; content: string; turn: number; now: number }): CourierSystem {
  const content = input.content.trim();
  if (!content) throw new Error('MOMENT_EMPTY');
  if (content.length > 500) throw new Error('MOMENT_TOO_LONG');
  if ((system.moments ?? []).length >= MAX_POSTS) throw new Error('MOMENT_LIMIT');
  return { ...system, moments: [{ id: input.id, authorId: 'player', content, turn: input.turn, createdAt: input.now, updatedAt: input.now, revision: 1, targets: [], comments: [] }, ...(system.moments ?? [])] };
}
export function editMoment(system: CourierSystem, id: string, contentInput: string, now: number): CourierSystem {
  const content = contentInput.trim();
  if (!content) throw new Error('MOMENT_EMPTY');
  if (content.length > 500) throw new Error('MOMENT_TOO_LONG');
  if (!(system.moments ?? []).some((post) => post.id === id)) throw new Error('MOMENT_NOT_FOUND');
  return { ...system, moments: (system.moments ?? []).map((post) => post.id === id
    ? { ...post, content, updatedAt: now, revision: post.revision + 1, targets: [], comments: [] } : post) };
}
export function deleteMoment(system: CourierSystem, id: string): CourierSystem {
  if (!(system.moments ?? []).some((post) => post.id === id)) throw new Error('MOMENT_NOT_FOUND');
  return { ...system, moments: (system.moments ?? []).filter((post) => post.id !== id) };
}
export function selectMomentCommenters(momentId: string, contacts: readonly CourierContact[], npcs: readonly NPC记录[]): NPC记录[] {
  const byId = new Map(npcs.map((npc) => [npc.id, npc]));
  const unique = new Map<string, NPC记录>();
  for (const contact of contacts) {
    const npc = contact.npcId ? byId.get(contact.npcId) : undefined;
    if (npc && npc.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD && contact.available) unique.set(npc.id, npc);
  }
  const eligible = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (!eligible.length) return [];
  const start = [...momentId].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0) % eligible.length;
  return [...eligible.slice(start), ...eligible.slice(0, start)].slice(0, 3);
}
export function markMomentTarget(system: CourierSystem, postId: string, revision: number, npcId: string, status: CourierMomentTarget['status']): CourierSystem {
  return { ...system, moments: (system.moments ?? []).map((post) => post.id === postId && post.revision === revision
    ? { ...post, targets: [...post.targets.filter((target) => target.npcId !== npcId), { npcId, status }].slice(0, 3) } : post) };
}
export function appendMomentComment(system: CourierSystem, postId: string, revision: number, comment: CourierMomentComment): CourierSystem {
  return { ...system, moments: (system.moments ?? []).map((post) => post.id === postId && post.revision === revision
    && post.comments.length < 3 && !post.comments.some((old) => old.npcId === comment.npcId)
    ? { ...post, comments: [...post.comments, comment], targets: post.targets.map((target) => target.npcId === comment.npcId ? { ...target, status: 'done' as const } : target) }
    : post) };
}
```

- [ ] **Step 4: 运行 GREEN**：同 Step 2 命令；追加 500 条边界、500 字边界、相同 NPC 重复联系人、101/100、修订号不匹配幂等测试并要求通过。

### Task 3: 单角色 AI 与异步安全提交

**Files:**
- Create: `services/ai/courierMomentComments.ts`
- Create: `hooks/useGame/courierMomentWorkflow.ts`
- Test: `tests/unit/courierMomentWorkflow.test.ts` (create)

**Interfaces:**
- Consumes: `resolveCourierApiConfig`, `chatCompletion`, `buildCourierSenderProfile`, Task 2 纯函数。
- Produces: `generateMomentComment(config, { post, npc, profile }): Promise<string>` and `runMomentComments(deps, postId, revision): Promise<void>`.
- `deps` supplies `getSessionId`, `getCourier`, `setCourier`, `getNpcs`, `getApiConfig`, `generateComment`; no React state is captured before `await`.

- [ ] **Step 1: 写 RED 用例（可控 deferred promise）**

```ts
import { expect, it, vi } from 'vitest';
import { runMomentComments } from '@/hooks/useGame/courierMomentWorkflow';

it('drops a late result after a session or revision change', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  let session = 1;
  const amber = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 好感度: 101 };
  let courier = createMoment({ ...createEmptyCourierSystem(), contacts: [{ id: 'amber-contact', npcId: 'amber', name: '安柏', available: true }] }, { id: 'p1', content: '今天真好', turn: 1, now: 1 });
  const config = { id: 'phone', name: '手机', provider: 'openai', baseUrl: 'http://example.invalid', apiKey: 'test', model: 'test', createdAt: 1, updatedAt: 1 } as API配置项;
  const deps = { getSessionId: () => session, getCourier: () => courier,
    setCourier: (update: (old: typeof courier) => typeof courier) => { courier = update(courier); },
    getNpcs: () => [amber], getApiConfig: () => config,
    generateComment: vi.fn(() => pending) };
  const run = runMomentComments(deps, 'p1', 1);
  session = 2; resolve('今天辛苦啦！'); await run;
  expect(courier.moments?.[0]?.comments).toEqual([]);
});
```

Import `createMoment`、`createEmptyCourierSystem`、`创建NPC记录`、`API配置项` in the test. Repeat the deferred-promise case with revision changed to 2, post deleted, and affinity changed to 100; assert no comment is written. Use three eligible NPCs and a `generateComment` mock that rejects for one to pin independent failure and targeted retry.

- [ ] **Step 2: 运行 RED**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentWorkflow.test.ts`；预期缺少新模块。
- [ ] **Step 3: 实现 AI 提示和响应校验**

```ts
export async function generateMomentComment(config: API配置项, input: { post: CourierMoment; npc: NPC记录; profile: CourierSenderProfile }): Promise<string> {
  const prompt = [
    `你是${input.npc.姓名}，给旅行者的朋友圈留一条自然的短评论。只输出评论正文，不写角色名、旁白或系统说明。`,
    `性格：${input.profile.personality ?? ''}`,
    `说话方式：${input.profile.speechStyle ?? ''}`,
    `你与旅行者共享且你本人知道的记忆：${(input.profile.sharedExperiences ?? []).slice(-3).join('；')}`,
    `旅行者动态：${input.post.content}`,
    '只能依据上述内容；不臆测其他角色私下经历。长度 1 到 120 字。',
  ].join('\n');
  const raw = await chatCompletion(config, { messages: [{ role: 'user', content: prompt }], systemPrompt: '', maxTokens: 256 }, { onDelta: () => undefined, onDone: () => undefined, onError: (error) => { throw error; } });
  const text = raw.trim().replace(/^【?[^\n：]{1,20}】?[:：]\s*/u, '');
  if (!text || text.length > 120 || /系统提示|提示词|记忆库|关于.{0,30}对.*印象/u.test(text)) throw new Error('MOMENT_COMMENT_INVALID');
  return text;
}
```

- [ ] **Step 4: 实现协调器的 CAS 写回**

```ts
export async function runMomentComments(deps: MomentWorkflowDeps, postId: string, revision: number): Promise<void> {
  const sessionId = deps.getSessionId();
  const initial = deps.getCourier();
  const post = initial.moments?.find((item) => item.id === postId && item.revision === revision);
  if (!post) return;
  const selected = post.targets.length ? post.targets.map((target) => target.npcId)
    : selectMomentCommenters(postId, initial.contacts, deps.getNpcs()).map((npc) => npc.id);
  for (const npcId of selected.slice(0, 3)) {
    const live = deps.getCourier();
    const currentPost = live.moments?.find((item) => item.id === postId && item.revision === revision);
    const npc = deps.getNpcs().find((item) => item.id === npcId);
    if (deps.getSessionId() !== sessionId || !currentPost || !npc || npc.好感度 <= 100) return;
    if (currentPost.targets.find((target) => target.npcId === npcId)?.status === 'done') continue;
    const config = deps.getApiConfig();
    if (!config) { deps.setCourier((old) => markMomentTarget(old, postId, revision, npcId, 'failed')); continue; }
    deps.setCourier((old) => markMomentTarget(old, postId, revision, npcId, 'generating'));
    try {
      const content = await deps.generateComment(config, { post: currentPost, npc, profile: buildCourierSenderProfile(npc) });
      if (deps.getSessionId() !== sessionId) return;
      deps.setCourier((old) => {
        const stillEligible = old.contacts.some((contact) => contact.npcId === npcId && contact.available)
          && deps.getNpcs().some((person) => person.id === npcId && person.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD);
        return stillEligible ? appendMomentComment(old, postId, revision, { id: `${postId}_${revision}_${npcId}`, npcId, npcName: npc.姓名, content, createdAt: Date.now() }) : old;
      });
    } catch {
      if (deps.getSessionId() !== sessionId) return;
      deps.setCourier((old) => old.contacts.some((contact) => contact.npcId === npcId && contact.available)
        && deps.getNpcs().some((person) => person.id === npcId && person.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD)
        ? markMomentTarget(old, postId, revision, npcId, 'failed') : old);
    }
  }
}
```

- [ ] **Step 5: 运行 GREEN**：运行 Step 2 命令；再测试输出包含元术语、空字符串、超长文本均为失败状态，不能使用本地套话替代。

### Task 4: 手机界面与 App 集成

**Files:**
- Create: `components/features/Courier/CourierMomentsPanel.tsx`
- Modify: `components/features/Courier/CourierModal.tsx`
- Modify: `App.tsx`
- Test: `tests/unit/courierMomentsUi.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1–3 APIs.
- Produces: `CourierModalProps.onRequestMomentComments?: (postId: string, revision: number) => void`; `CourierMomentsPanel` props `{ courier, onCreate, onEdit, onDelete, onRetry }`. App queues requests until the new post/revision is present in committed game state.

- [ ] **Step 1: 写 RED UI 用例**

```tsx
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';

it('publishes a text post and requests asynchronous comments', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const onCourierChange = vi.fn(); const onRequestMomentComments = vi.fn();
  await act(async () => root.render(createElement(CourierModal, { courier: createEmptyCourierSystem(), onCourierChange, onRequestMomentComments, onClose: vi.fn() })));
  await act(async () => (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('朋友圈')) as HTMLButtonElement).click());
  const editor = host.querySelector('textarea[aria-label="朋友圈正文"]') as HTMLTextAreaElement;
  await act(async () => { editor.value = '今天到蒙德了'; editor.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('发布')) as HTMLButtonElement).click());
  expect(onCourierChange).toHaveBeenCalled();
  expect(onRequestMomentComments).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); host.remove();
});
```

- [ ] **Step 2: 运行 RED**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsUi.test.tsx`；预期找不到朋友圈入口。
- [ ] **Step 3: 实现独立面板与手机入口**

```tsx
const [phoneSection, setPhoneSection] = useState<'chats' | 'moments'>('chats');
const publish = (content: string) => {
  const id = `moment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  onCourierChange((old) => createMoment(old, { id, content, turn: currentTurn, now: Date.now() }));
  onRequestMomentComments?.(id, 1);
};
const saveEdit = (id: string, content: string, previousRevision: number) => {
  onCourierChange((old) => editMoment(old, id, content, Date.now()));
  onRequestMomentComments?.(id, previousRevision + 1);
};
// Panel renders a 500-character-count textarea, publish button, newest-first
// cards with edit/delete/retry buttons, target failure labels, and comments.
// Keep its scroll container min-h-0 overflow-y-auto and controls min-h-11.
// Delete captures the old post and pushes a 9-second undo toast. Undo reinserts
// only when its ID is absent, with revision incremented and any generating
// targets changed to failed. That prevents pre-deletion model results from
// being accepted after an undo restores the same post ID.
```

- [ ] **Step 4: 集成 App 的会话安全入口**

```tsx
const pendingMomentsRef = useRef(new Map<string, { revision: number; sessionId: number }>());
const requestMomentComments = (postId: string, revision: number) => {
  pendingMomentsRef.current.set(postId, { revision, sessionId: state.getGameSessionId() });
};
useEffect(() => {
  for (const [postId, pending] of pendingMomentsRef.current) {
    const { revision, sessionId } = pending;
    if (sessionId !== state.getGameSessionId()) { pendingMomentsRef.current.delete(postId); continue; }
    if (!state.game.手机.moments?.some((post) => post.id === postId && post.revision === revision)) continue;
    pendingMomentsRef.current.delete(postId);
    void runMomentComments({
      getSessionId: state.getGameSessionId,
      getCourier: () => readLiveGameState(state).手机,
      setCourier: state.set手机,
      getNpcs: () => mapTeyvatNpcsToLegacy(readLiveGameState(state)),
      getApiConfig: () => resolveCourierApiConfig(state.gameSettings.手机系统?.api,
        state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId) ?? state.apiSettings.configs[0] ?? null),
      generateComment: generateMomentComment,
    }, postId, revision);
  }
}, [state.game.手机.moments]);
// Pass onRequestMomentComments={requestMomentComments} at the existing CourierModal call site.
```

- [ ] **Step 5: 运行 GREEN 与全量门槛**：`node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsUi.test.tsx tests/unit/courierModalBehavior.test.ts`; 然后运行项目全量 Vitest、`tsc --noEmit`、ESLint、生产构建及 `git diff --check`。手工在窄屏检查发布、编辑清评论、删除撤销、失败重试、切回私聊的滚动位置。

不在当前共享脏 `main` 自动提交；若用户另行授权隔离工作树，才仅暂存本计划路径提交。
