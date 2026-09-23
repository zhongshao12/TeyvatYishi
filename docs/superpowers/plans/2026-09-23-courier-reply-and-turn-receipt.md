# 手机回信一致性与回合结算回执 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 连续手机消息基于最新已提交状态生成一次可信回信，并在正文下方显示该回合真实入账的变化或失败原因。

**Architecture:** 手机 UI 只发稳定消息 ID；一个按会话防抖、全局串行的调度器读取活体根并把指定消息范围交给原有手机模型流水线。结算回执由存档内的变量命令批次纯投影生成，再通过 `ChatList` 传给正式 assistant 回合组件，不改变结算本身。

**Tech Stack:** React 19、TypeScript 5.8、Vitest 3.2、Vite 6.2、pnpm 10.15；Windows PowerShell。

**Spec:** `docs/superpowers/specs/2026-09-23-remaining-player-experience-design.md` 的“第一批”及“故障与边界处理”。第二、三批分别另写实施计划，避免独立子系统互相阻塞。

## Global Constraints

- 不重写整个 `App`，不新增战斗或祈愿系统，不改变既有存档格式及模型供应商选择。
- 同一会话最后一次玩家发送后等待 500 毫秒；期间再发送则重置等待窗。角色气泡原有的每条 500 毫秒展示间隔保持不变。
- 手机模型失败不得用本地模板伪装成功；保留玩家消息与待答范围，允许显式重试。切档、删会话、解散群聊时旧结果不得写回。
- 回执只能使用已提交的变量命令批次；失败与拒绝需可见，不显示原始提示词、API 密钥或原始模型文本。
- 当前工作区含既有未提交改动。每步先看目标文件 diff；不得覆盖、清理或把其他人的改动混入提交。无法安全隔离任务提交时记录原因，不强制提交。

## Review Focus

1. 同一毫秒连点发送导致玩家消息 ID 冲突：Task 1 的唯一 ID 测试保证两条都保留。
2. 群聊有人被 `@` 而玩家连续补发：Task 2 的批量上下文测试保证原文顺序和末条点名规则均明确。
3. 第一批模型运行时玩家再发消息：Task 3 的队列测试保证第二批不丢失，也不进入已开始的第一批。
4. 切档或删群恰逢逐条展示回信：Task 4 的提交守卫测试保证后续气泡、NPC 记忆和打字标志不污染新会话。
5. 长会话压缩、重掷或旧存档缺少批次：Task 5 的回执测试保证“不知道”不显示为“已成功”。

---

## File map

- `components/features/Courier/CourierModal.tsx`：玩家消息唯一 ID、仅上报回信意图、重试入口。
- `utils/courierReplyBatch.ts`：按消息 ID 提取一批玩家发言并合成单次模型输入；不管 React、API 或存档。
- `hooks/useGame/courierReplyQueue.ts`：500 毫秒防抖、跨会话串行、失败保留、会话失效；不生成文案。
- `hooks/useGame/courierBackgroundJobs.ts`：将指定批次接入现有私聊/群聊生成，立即回信模式禁用模板兜底；后台任务沿用原策略。
- `utils/courierReplyCommit.ts`：会话身份、消息 ID 与会话存活的纯检查，供每次异步写回复用。
- `services/ai/courierLetterModel.ts`：群聊/私聊提示词明确多条玩家消息的顺序，不捏造角色不可知事实。
- `App.tsx`：绑定队列与活体根、会话 CAS、NPC 记忆合并、逐条展示和错误状态。
- `utils/turnSettlementReceipt.ts`：从已提交批次纯投影安全、简短的 UI 模型。
- `components/features/Chat/TurnSettlementReceipt.tsx`：可展开的玩家可读回执。
- `components/features/Chat/ChatList.tsx`、`components/features/Chat/TurnItem.tsx`：向正式 assistant 回合传递并显示回执。
- `tests/unit/courierReplyBatch.test.ts`、`tests/unit/courierReplyQueue.test.ts`、`tests/unit/courierImmediateReply.test.ts`、`tests/unit/courierReplyCommit.test.ts`、`tests/unit/turnSettlementReceipt.test.ts`、`tests/unit/turnSettlementReceiptUi.test.tsx`：行为与回归测试。

### Task 1: 稳定消息 ID 与批量玩家输入

**Files:**
- Create: `utils/courierReplyBatch.ts`
- Modify: `components/features/Courier/CourierModal.tsx:260-284`
- Create: `tests/unit/courierReplyBatch.test.ts`

**Interfaces:**
- Produces: `createCourierPlayerMessageId(): string`；`buildCourierPlayerBatch(conversation: CourierConversation, messageIds: readonly string[]): CourierMessage | null`。
- `buildCourierPlayerBatch` 按会话实际消息顺序去重，只接受 `senderId === 'player'` 且非空的指定 ID；返回一条仅供模型使用的虚拟消息，`id` 是最后一条真实消息 ID，`content` 是按顺序编号的原文，绝不写入会话。

- [ ] **Step 1: 写失败测试。** 用两次 ID 创建、逆序/重复 ID、夹杂 NPC ID 和缺失 ID 覆盖；缺失任一要求的玩家消息时返回 `null`，不能悄悄少答。

```ts
import { expect, it } from 'vitest';
import { buildCourierPlayerBatch, createCourierPlayerMessageId } from '@/utils/courierReplyBatch';
import type { CourierConversation, CourierMessage } from '@/models/teyvat/courier';

const player = (id: string, content: string): CourierMessage => ({ id, senderId: 'player', senderName: '旅人', role: 'user', content, turn: 1, timestamp: 1, readBy: ['player'] });
const conversation: CourierConversation = { id: 'c', title: '安柏', participantIds: ['player', 'amber'], type: 'private', messages: [player('a', '第一句'), player('b', '第二句')], unread: 0, typingMemberIds: [], updatedAt: 1 };

it('keeps two sends in the same millisecond distinct', () => expect(createCourierPlayerMessageId()).not.toBe(createCourierPlayerMessageId()));
it('orders the requested player messages by conversation order', () => expect(buildCourierPlayerBatch(conversation, ['b', 'a', 'b'])?.content).toBe('1. 第一句\n2. 第二句'));
it('does not silently answer an incomplete range', () => expect(buildCourierPlayerBatch(conversation, ['a', 'missing'])).toBeNull());
```

- [ ] **Step 2: 确认测试先失败。** Run: `pnpm exec vitest run tests/unit/courierReplyBatch.test.ts`。Expected: FAIL，因新模块不存在。
- [ ] **Step 3: 最小实现。** 用 `crypto.randomUUID()`（无该 API 时采用单调计数器加时间戳）创建 ID；纯函数在返回前验证去重后的所有 ID 都找到且均为玩家消息。`CourierModal.sendMessage` 对同一发送只创建一次 `messageId`，函数式 `onCourierChange` 与回信意图都用该 ID，不再生成渲染快照。

```ts
const messageId = createCourierPlayerMessageId();
onCourierChange((previous) => appendCourierMessage(previous, selected.id, { id: messageId, senderId: 'player', senderName: travelerName?.trim() || '旅人', role: 'user', content, turn: resolveCourierMessageTurn(currentTurn, selected.messages), timestamp: Date.now(), readBy: ['player'] }));
onRequestReply?.(selected.id, messageId);
```

- [ ] **Step 4: 运行测试与类型检查。** Run: `pnpm exec vitest run tests/unit/courierReplyBatch.test.ts`；`pnpm exec tsc -b --pretty false`。Expected: PASS / exit 0。若 `App` 旧回调签名暂时不兼容，先在同一任务改接收签名但保持旧实现只用于过渡，最终由 Task 4 移除快照路径。
- [ ] **Step 5: 检查目标 diff。** Run: `git diff -- components/features/Courier/CourierModal.tsx utils/courierReplyBatch.ts tests/unit/courierReplyBatch.test.ts`。只保留任务相关 hunk；目标文件若已有用户改动，不以整文件提交覆盖它。

### Task 2: 指定批次进入模型流水线，立即回信不伪造兜底

**Files:**
- Modify: `hooks/useGame/courierBackgroundJobs.ts:31-52,337-485`
- Modify: `services/ai/courierLetterModel.ts:163-215`（仅提示词说明）
- Create: `tests/unit/courierImmediateReply.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildCourierPlayerBatch`。
- Produces: `CourierReplyPassInput` 新增 `replyBatch?: { conversationId: string; messageIds: readonly string[] }` 与 `fallbackPolicy?: 'local' | 'error'`。没有 `replyBatch` 的后台任务仍按原候选规则；`fallbackPolicy` 默认 `'local'`，立即回信传 `'error'`。

- [ ] **Step 1: 写失败测试。** 在同一会话放两条玩家消息，传显式 ID，注入群聊生成器捕获 `context.playerMessage.content`；再测试指定会话最后是联系人消息时仍按 ID 回答；无 API / 模型抛错且 `fallbackPolicy: 'error'` 时 Promise reject，输入 `courier` 和 `npcs` 原样保持；默认策略的既有后台回归继续通过。

```ts
import { expect, it } from 'vitest';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import type { API配置项 } from '@/models/settings';
import { runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';

const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1 };
const courier = { ...createEmptyCourierSystem(), contacts: [{ id: 'amber', name: '安柏', available: true }], conversations: [{ id: 'group', title: '群聊', participantIds: ['player', 'amber'], messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '第一句', turn: 2, timestamp: 1, readBy: ['player'] }, { id: 'p2', senderId: 'player', senderName: '旅人', role: 'user', content: '第二句', turn: 2, timestamp: 2, readBy: ['player'] }], unread: 0, type: 'group' as const, typingMemberIds: [], updatedAt: 2 }] };
it('answers the ordered batch once and refuses an unavailable API', async () => {
  let captured = '';
  const result = await runCourierReplyPass({ courier, npcs: [], letterApiConfig: config, turn: 2, maxReplies: 1, replyBatch: { conversationId: 'group', messageIds: ['p1', 'p2'] }, fallbackPolicy: 'error', groupReplyGenerator: async (_config, context) => { captured = context.playerMessage.content; return '收到了'; } });
  expect(captured).toBe('1. 第一句\n2. 第二句');
  expect(result.replied).toBe(1);
  await expect(runCourierReplyPass({ courier, npcs: [], letterApiConfig: null, turn: 2, replyBatch: { conversationId: 'group', messageIds: ['p1'] }, fallbackPolicy: 'error' })).rejects.toThrow('PHONE_REPLY_API_UNAVAILABLE');
});
```

- [ ] **Step 2: 确认测试先失败。** Run: `pnpm exec vitest run tests/unit/courierImmediateReply.test.ts`。Expected: FAIL，显式批次尚未生效或无 API 未抛错。
- [ ] **Step 3: 最小实现。** 显式批次只从指定会话构建 candidate；任一 ID 不存在则抛 `PHONE_REPLY_BATCH_STALE`。私聊 `contactId` 沿用现有“最近联系人消息，否则第一个非玩家成员”的规则，缺少成员时拒绝生成。群聊 `selectGroupReplyMembers` 用批次虚拟消息（任一条包含 `@` 均可点名）；私聊/群聊生成收到按序文本。`fallbackPolicy === 'error'` 时无配置或生成异常直接抛，且任何生成中间结果不提交。默认后台策略不变。

```ts
const explicitConversation = input.replyBatch
  ? input.courier.conversations.find((item) => item.id === input.replyBatch?.conversationId)
  : undefined;
const explicitMessage = explicitConversation && input.replyBatch
  ? buildCourierPlayerBatch(explicitConversation, input.replyBatch.messageIds)
  : null;
if (input.replyBatch && (!explicitConversation || !explicitMessage)) throw new Error('PHONE_REPLY_BATCH_STALE');
const explicitContactId = explicitConversation
  ? [...explicitConversation.messages].reverse().find((item) => item.senderId !== 'player')?.senderId
    ?? explicitConversation.participantIds.find((id) => id !== 'player')
  : undefined;
if (input.replyBatch && !explicitContactId) throw new Error('PHONE_REPLY_CONTACT_MISSING');
const candidates = explicitConversation && explicitMessage && explicitContactId
  ? [{ conversation: explicitConversation, playerMessage: explicitMessage, contactId: explicitContactId }]
  : findCourierReplyCandidates(input.courier, input.maxReplies ?? 2, preclaimed);
if (input.fallbackPolicy === 'error' && !input.letterApiConfig) throw new Error('PHONE_REPLY_API_UNAVAILABLE');
```

- [ ] **Step 4: 明确提示词。** `buildCourierReplyPrompt` 与 `buildCourierGroupReplyPrompt` 在收到编号的多条输入时说“按顺序回应这些连续消息，不要逐条机械复读”；保留既有角色知识边界与人设约束。原 `@` 解析仍只在 `selectGroupReplyMembers`，测试覆盖 `@全体成员`、单独点名及普通消息。
- [ ] **Step 5: 定向测试。** Run: `pnpm exec vitest run tests/unit/courierImmediateReply.test.ts tests/unit/courierNaturalMessages.test.ts`；`pnpm test:phone-reply`。Expected: PASS。

### Task 3: 可重试的 500 毫秒手机调度器

**Files:**
- Create: `hooks/useGame/courierReplyQueue.ts`
- Create: `tests/unit/courierReplyQueue.test.ts`

**Interfaces:**
- Produces: `createCourierReplyQueue({ getSessionId, dispatch, delayMs? })`，返回 `{ enqueue(intent), retry(conversationId), invalidateSession(), dispose() }`。`intent` 为 `{ conversationId: string; messageId: string; sessionId: number }`；`dispatch` 接收 `{ conversationId, messageIds, sessionId }` 并返回 `Promise<'sent' | 'retry' | 'defer'>`：`sent` 表示完成或目标失效；`retry` 保留待答并等待玩家手动重试；`defer` 表示被另一合法作业占用，500 毫秒后自动再试。
- 全局同一时刻最多一个 dispatch；每会话 500 毫秒静默窗，模型失败不自动重试；其他会话可继续。运行中的批次与新发送的批次分离。

- [ ] **Step 1: 写失败测试，使用 Vitest fake timers。** 同会话 0/300/600 毫秒发三条，1099 毫秒仍未 dispatch、1100 毫秒只 dispatch 一次且顺序为三条；一批运行中再发一条，待前批完成后另发；另一会话不中断；返回 `retry` 后不自动循环，手动 `retry()` 才重发；返回 `defer` 后 500 毫秒自动再试；`invalidateSession`/`dispose` 后旧计时器无效。

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { createCourierReplyQueue } from '@/hooks/useGame/courierReplyQueue';

afterEach(() => vi.useRealTimers());
it('coalesces consecutive sends by conversation', async () => {
  vi.useFakeTimers();
  const dispatch = vi.fn(async () => 'sent' as const);
  const queue = createCourierReplyQueue({ getSessionId: () => 7, dispatch, delayMs: 500 });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(300);
  queue.enqueue({ conversationId: 'amber', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(499);
  expect(dispatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0]?.[0].messageIds).toEqual(['p1', 'p2']);
  queue.dispose();
});
```

- [ ] **Step 2: 确认测试先失败。** Run: `pnpm exec vitest run tests/unit/courierReplyQueue.test.ts`。Expected: FAIL，模块不存在。
- [ ] **Step 3: 实现纯调度边界。** `Map<conversationId,{sessionId,pendingIds,timer,failed}>` 管待答；全局 `active` 管运行中。计时器只标记 ready，`pump()` 串行取 ready 队首并把当时待答 ID 移至运行批次；`sent` 丢弃已处理 ID，`retry` 把 ID 放回队首并标记失败，`defer` 放回队首并自动重新计时。每次 `pump` 与完成后检查 `getSessionId()`；不同 session 的旧队列直接清空。`retry()` 只对 failed 项生效。`dispose` 清 timer。

```ts
export interface CourierReplyIntent { conversationId: string; messageId: string; sessionId: number }
export interface CourierReplyBatchIntent { conversationId: string; messageIds: string[]; sessionId: number }
export type CourierReplyDispatchResult = 'sent' | 'retry' | 'defer';
export interface CourierReplyQueueOptions { getSessionId: () => number; dispatch: (batch: CourierReplyBatchIntent) => Promise<CourierReplyDispatchResult>; delayMs?: number }
```

- [ ] **Step 4: 运行定向测试。** Run: `pnpm exec vitest run tests/unit/courierReplyQueue.test.ts`。Expected: PASS；`vi.useRealTimers()` 在 `afterEach` 恢复。

### Task 4: 接入活体状态、CAS 与失败重试 UI

**Files:**
- Modify: `App.tsx:257-397,1270-1285`
- Modify: `components/features/Courier/CourierModal.tsx:20-60` 及会话底部错误提示区域
- Create: `utils/courierReplyCommit.ts`
- Create: `tests/unit/courierReplyCommit.test.ts`
- Test: `tests/unit/courierImmediateReply.test.ts`、`tests/unit/courierReplyQueue.test.ts`、现有 `tests/unit/gameSessionIdentity.test.ts`

**Interfaces:**
- Consumes: Task 1 的消息 ID、Task 2 的显式 `replyBatch`/`fallbackPolicy`、Task 3 的队列。
- Produces: `onRequestReply(conversationId, messageId)`、`onRetryReply(conversationId)` 与 `replyErrorByConversationId: Record<string,string>`，以及 `isCourierReplyTargetLive(courier: CourierSystem, conversationId: string, messageIds: readonly string[]): boolean`。`App` 内局部异步函数 `commitAndRevealCourierReply(result: CourierReplyPassResult, batch: CourierReplyBatchIntent): Promise<void>` 负责沿用已有 NPC 合并、联系人同步、逐条 500 毫秒展示；每次写前都核对当前 session、会话及消息 ID。UI 只展示简短错误码/修复提示，不把模型异常原文或密钥拼进页面。

- [ ] **Step 1: 先补失败回归。** 纯检查函数用被删会话/缺失玩家 ID/仍在的会话各一例；队列用可控 Promise 测试第一批生成期间第二条消息进队。App 集成回归覆盖逐条揭示期间切档/删群后不再追加气泡或 NPC 记忆；错误时玩家原消息保留并可点“重试回信”。现有 `gameSessionIdentity` 测试增加“换档后旧结果无写回”的手机分支。

```ts
import { expect, it } from 'vitest';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { isCourierReplyTargetLive } from '@/utils/courierReplyCommit';

it('rejects a deleted conversation and a missing player message', () => {
  const empty = createEmptyCourierSystem();
  expect(isCourierReplyTargetLive(empty, 'amber', ['p1'])).toBe(false);
  const live = { ...empty, conversations: [{ id: 'amber', title: '安柏', participantIds: ['player', 'amber'], type: 'private' as const, messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '你好', turn: 1, timestamp: 1, readBy: ['player'] }], unread: 0, typingMemberIds: [], updatedAt: 1 }] };
  expect(isCourierReplyTargetLive(live, 'amber', ['p1'])).toBe(true);
  expect(isCourierReplyTargetLive(live, 'amber', ['p2'])).toBe(false);
});
```

- [ ] **Step 2: 运行回归确认先失败。** Run: `pnpm exec vitest run tests/unit/courierImmediateReply.test.ts tests/unit/gameSessionIdentity.test.ts`。Expected: 新增用例 FAIL。
- [ ] **Step 3: 替换 `App` 中的快照待处理 Map。** 队列 dispatch 时调用 `readLiveGameState(latestStateRef.current)`；校验 session、手机 enabled、会话存在且非 system、所有指定玩家消息 ID 都在。先 `beginCourierReply(conversationId)` 取得与后台任务共享的认领，`finally` 中 `endCourierReply`；认领被占用时返回 `defer`，不收取模型费用也不显示生成失败。以该活体根的手机/NPC/世界信息调用 `runCourierReplyPass({ replyBatch, fallbackPolicy: 'error', preclaimedConversationIds:[conversationId], ... })`。NPC 合并沿用 `mergeNpcWriteBack`，但必须在模型返回后再次核对 session 与会话仍存在。每条 `revealCourierMessages` 回调重新校验 session、会话和批次 ID。旧会话失效时返回 `sent` 以丢弃无效请求，模型失败返回 `retry` 以保留可重试范围。

```ts
const live = latestStateRef.current;
if (live.getGameSessionId() !== batch.sessionId) return 'sent';
const root = readLiveGameState(live);
const conversation = root.手机.conversations.find((item) => item.id === batch.conversationId);
if (!conversation || !isCourierReplyTargetLive(root.手机, batch.conversationId, batch.messageIds)) return 'sent';
if (!beginCourierReply(batch.conversationId)) return 'defer';
try {
const result = await runCourierReplyPass({ courier: root.手机, npcs: live.NPC, letterApiConfig, turn: root.turnCount, maxReplies: 1, replyBatch: batch, fallbackPolicy: 'error', preclaimedConversationIds: [batch.conversationId] });
const latest = latestStateRef.current;
if (latest.getGameSessionId() !== batch.sessionId || !isCourierReplyTargetLive(readLiveGameState(latest).手机, batch.conversationId, batch.messageIds)) return 'sent';
await commitAndRevealCourierReply(result, batch);
return result.replied > 0 ? 'sent' : 'retry';
} catch { return 'retry';
} finally { endCourierReply(batch.conversationId); }
```

- [ ] **Step 4: 呈现失败与重试。** 只在当前会话显示“回信失败，消息已保留”与 `重试回信`；关闭手机或切档后不能把旧错误显示给新档。无 API 时提示去设置手机/主模型配置。若 `CourierModal` 接口变化影响 Storybook，更新 `stories/CourierModal.stories.tsx` 的属性。
- [ ] **Step 5: 定向验证。** Run: `pnpm exec vitest run tests/unit/courierReplyBatch.test.ts tests/unit/courierReplyQueue.test.ts tests/unit/courierImmediateReply.test.ts tests/unit/courierReplyCommit.test.ts tests/unit/gameSessionIdentity.test.ts tests/unit/courierNaturalMessages.test.ts`；`pnpm test:phone-reply`；`pnpm exec tsc -b --pretty false`。Expected: 全部 PASS / exit 0。

### Task 5: 从正式批次生成回合回执

**Files:**
- Create: `utils/turnSettlementReceipt.ts`
- Create: `tests/unit/turnSettlementReceipt.test.ts`

**Interfaces:**
- Produces: `buildTurnSettlementReceipt(message: 聊天消息, batches: readonly 变量命令批次[]): TurnSettlementReceiptModel | null`。模型含 `turn`、`items: Array<{status:'success'|'warning'|'failure'; label:string; detail?:string}>` 与 `summary`；不含 `rawText`、`report`、原始 API 错误对象。
- 仅处理 `role === 'assistant'`、严格整数 `gameTime` 与 `batch.turn` 匹配的已持久化批次；无匹配批次返回 `null`，空 `results` 的匹配批次显示“本回合无变量变化”。压缩历史的 `retentionSummary` 显示“旧结算已压缩”，不臆造单条变化。

- [ ] **Step 1: 写失败测试。** 成功物品增减、警告、拒绝、同回合多批次、旧存档缺批次、重掷后旧 turn 不匹配、压缩摘要、`rawText` 包含密钥字符串；断言可见文案不含原始文本或密钥。

```ts
const receipt = buildTurnSettlementReceipt({ id: 'a', role: 'assistant', content: '正文', gameTime: '3', timestamp: 1 }, [{ id: 'b', turn: 3, timestamp: 1, source: 'main', results: [{ command: { action: 'add', key: '背包.物品[0].数量', value: 1 }, ok: true }, { command: { action: 'set', key: '(事实忽略)', value: null }, ok: false, kind: 'warning', reason: '物品归属不明' }], rawText: 'SECRET_API_KEY' }]);
expect(receipt?.items.map((item) => item.status)).toEqual(['success', 'warning']);
expect(JSON.stringify(receipt)).not.toContain('SECRET_API_KEY');
expect(buildTurnSettlementReceipt({ id: 'old', role: 'assistant', content: '', timestamp: 1 }, [])).toBeNull();
```

- [ ] **Step 2: 确认测试先失败。** Run: `pnpm exec vitest run tests/unit/turnSettlementReceipt.test.ts`。Expected: FAIL，新模块不存在。
- [ ] **Step 3: 最小实现。** 只按 `message.gameTime` 精确关联；结果以 `kind`/`ok` 分类。成功项只输出固定动作词、经过白名单映射的领域标签与有限长度数字（字符串值不回显）；失败项只显示纯中文短原因，其他原因显示“结算未生效，查看变量记录”，不展示 `rawText/report`。去重同 `batch.id`，保留结果顺序。

```ts
export interface TurnSettlementReceiptModel { turn: number; summary: string; items: Array<{ status: 'success' | 'warning' | 'failure'; label: string; detail?: string }> }
export function buildTurnSettlementReceipt(message: 聊天消息, batches: readonly 变量命令批次[]): TurnSettlementReceiptModel | null {
  const turn = Number(message.gameTime);
  if (message.role !== 'assistant' || !/^\d+$/u.test(message.gameTime ?? '') || !Number.isSafeInteger(turn)) return null;
  const seen = new Set<string>();
  const current = batches.filter((batch) => batch.turn === turn && !seen.has(batch.id) && seen.add(batch.id));
  if (!current.length) return null;
  const domainLabel: Record<string, string> = { 背包: '背包', NPC: '同伴', 任务: '任务', 世界: '世界与时间', 旅人: '旅人' };
  const actionLabel: Record<变量命令动作, string> = { set: '更新', add: '增加', sub: '减少', push: '新增', delete: '移除' };
  const items: TurnSettlementReceiptModel['items'] = current.flatMap((batch) => {
    if (batch.retentionSummary) return [{ status: 'warning' as const, label: '旧结算记录已压缩' }];
    return batch.results.map((result) => {
      const status = result.ok ? 'success' as const : result.kind === 'warning' ? 'warning' as const : 'failure' as const;
      const domain = result.command.key.match(/^(背包|NPC|任务|世界|旅人)(?:\.|\[)/u)?.[1] ?? '';
      const amount = typeof result.command.value === 'number' && Number.isFinite(result.command.value) ? ` ${result.command.value}` : '';
      const safeReason = result.reason && /^[\p{Script=Han}\s，。、：；（）0-9]{1,80}$/u.test(result.reason) ? result.reason : undefined;
      const label = result.ok ? `${domainLabel[domain] ?? '状态'}${actionLabel[result.command.action]}${amount}` : safeReason ?? '结算未生效，查看变量记录';
      return { status, label };
    });
  });
  const success = items.filter((item) => item.status === 'success').length;
  const warnings = items.filter((item) => item.status === 'warning').length;
  const failures = items.filter((item) => item.status === 'failure').length;
  return { turn, items, summary: items.length ? `${success} 项变化，${warnings} 条警告，${failures} 项失败` : '本回合无变量变化' };
}
```

- [ ] **Step 4: 运行定向测试。** Run: `pnpm exec vitest run tests/unit/turnSettlementReceipt.test.ts`。Expected: PASS。

### Task 6: 将回执接到正式正文，不显示在流式预览

**Files:**
- Create: `components/features/Chat/TurnSettlementReceipt.tsx`
- Modify: `components/features/Chat/TurnItem.tsx:17-136`
- Modify: `components/features/Chat/ChatList.tsx:11-110,300-340`
- Modify: `App.tsx:827-845`
- Create: `tests/unit/turnSettlementReceiptUi.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 `buildTurnSettlementReceipt`/`TurnSettlementReceiptModel`。
- `ChatList` 新增 `variableBatches?: readonly 变量命令批次[]`；`TurnItem` 新增 `settlementReceipt?: TurnSettlementReceiptModel | null`。由 `ChatList` 对可见历史消息计算回执；`TurnItem` 只在非流式的 assistant 正文卡下显示。

- [ ] **Step 1: 写失败 UI 测试。** `renderToStaticMarkup` 检查成功/警告回执、无批次不显示、玩家消息不显示、流式预览不显示；交互测试点击展开后才显示详细变化，键盘 Enter/Space 可操作。

```tsx
const html = renderToStaticMarkup(<TurnSettlementReceipt receipt={{ turn: 3, summary: '1 项变化，1 条警告', items: [{ status: 'success', label: '背包增加 1' }, { status: 'warning', label: '物品归属不明' }] }} />);
expect(html).toContain('本回合变化');
expect(html).toContain('1 条警告');
expect(html).not.toContain('SECRET_API_KEY');
```

- [ ] **Step 2: 确认测试先失败。** Run: `pnpm exec vitest run tests/unit/turnSettlementReceiptUi.test.tsx`。Expected: FAIL，组件不存在。
- [ ] **Step 3: 最小 UI 与布线。** 使用原生 `<details><summary>`，默认只看摘要，展开显示有序列表；失败/警告有文字标签而非仅颜色。`ChatList` 用 `useMemo` 根据当前可见消息和 `variableBatches` 建 `Map<message.id, receipt>`，传给 `TurnItem`；`App` 传 `state.variableBatches`。无回执、玩家回合、`isStreaming`、`message.isStreaming` 不渲染。

```tsx
{!isUser && !isStreaming && !message.isStreaming && settlementReceipt ? <TurnSettlementReceipt receipt={settlementReceipt} /> : null}
```

- [ ] **Step 4: 定向验证与人工检查。** Run: `pnpm exec vitest run tests/unit/turnSettlementReceipt.test.ts tests/unit/turnSettlementReceiptUi.test.tsx tests/unit/chatSingleResponse.test.ts`。Expected: PASS。窄屏检查回执不遮挡正文、可键盘展开、变量抽屉仍可访问。

### Task 7: 全量门槛与文档同步

**Files:**
- Modify: `PLAYER_EXPERIENCE_ROADMAP.md`（仅已交付的第一批状态及实测数据）
- Test: 本计划全部新增和现有回归文件。

**Interfaces:** 无新运行时接口；只确认第一批交付，第二、三批保持“待实施”。

- [ ] **Step 1: 检查所有任务的差异与工作区归属。** Run: `git diff --check`、`git status --short`。核对用户原有未提交文件，不能把其余改动误报为本批成果。
- [ ] **Step 2: 全量测试。** Run: `pnpm test:unit`；`pnpm test:phone-reply`；`pnpm test:phone-mobile`；`pnpm test:inventory-variable`；`pnpm test:save-isolation`；`pnpm exec tsc -b --pretty false`；`pnpm lint`；`pnpm build`。Expected: 全部 exit 0；既有非失败 warning 单列报告。
- [ ] **Step 3: 同步文档与交付证据。** 在 `PLAYER_EXPERIENCE_ROADMAP.md` 仅将经过测试的第一批项目标为已完成，记录实际测试命令、通过数量、手工检查条件；第二、三批仍待计划执行。
- [ ] **Step 4: 独立审查。** 审查消息不丢失/不重复、会话身份保护、所有提示词知识边界、回执与正式批次一致及密钥不可见。若发现失败，回到所属任务补失败测试再修。
- [ ] **Step 5: 安全提交。** 只暂存本批新增文件和核对过的任务 hunk；若目标文件已含无法隔离的既有改动，则不提交混合 diff，在交付时明确说明。绝不使用 `git add -A`。
