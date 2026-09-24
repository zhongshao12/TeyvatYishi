# Chat Single Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A completed player turn displays exactly one formal narrative reply, without a stale streaming duplicate.

**Architecture:** Characterize whether duplicates exist in the render-only preview or durable history before changing behavior. Make the preview visible only during an active main narrative request and before its formal assistant reply exists; preserve distinct historical turns and recovery semantics.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-23-phone-moments-and-turn-consistency-design.md`

## Global Constraints

- Keep the current game's dirty `main` worktree and existing save data intact; do not reset, delete, or stage unrelated changes.
- A player send produces at most one formal assistant reply; retry, recovery, and re-roll must not hide legitimate distinct replies.
- Diagnose raw response, preview, and persisted history separately before choosing the production fix.
- Existing streaming settings and keyboard/scroll behavior remain unchanged.

## Review Focus

1. A stale preview after `loading=false` must not render beside the formal reply (Task 1 test).
2. A stream still in progress with the latest user message must remain visible (Task 1 test).
3. A formal assistant appended while background settlement runs must hide preview even if `loading` has not reset (Task 1 test).
4. Two distinct assistant messages from separate turns must both remain in history (Task 2 test).
5. Same assistant ID in a recovery replay must not create two durable entries (Task 2 test).

---

### Task 1: Prove and repair preview/formal handoff

**Files:**
- Modify: `components/features/Chat/ChatList.tsx`
- Test: `tests/unit/chatSingleResponse.test.tsx` (create)

**Interfaces:**
- Consumes: `ChatListProps.messages`, `ChatListProps.loading`, `useStreamingMessage()`.
- Produces: UI guarantee that `data-testid="chat-streaming-preview"` exists only while the current request has no formal reply.

- [ ] **Step 1: Write a failing UI test using the real `ChatList` and stream store**

```tsx
// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChatList } from '@/components/features/Chat/ChatList';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import type { 聊天消息 } from '@/models/chat';

it('hands preview to the formal reply once, including while settlement is loading', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const user: 聊天消息 = { id: 'u-2', role: 'user', content: '继续', timestamp: 1, gameTime: '2' };
  const assistant: 聊天消息 = { id: 'a-2', role: 'assistant', content: '正式正文', timestamp: 2, gameTime: '2' };
  const scrollRef = createRef<HTMLDivElement>();
  await act(async () => {
    setStreamingMessage('正在生成');
    root.render(createElement(ChatList, { messages: [user], loading: true, scrollRef }));
  });
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).not.toBeNull();
  await act(async () => {
    setStreamingMessage('旧的流式正文');
    root.render(createElement(ChatList, { messages: [user, assistant], loading: true, scrollRef }));
  });
  expect(host.textContent).toContain('正式正文');
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).toBeNull();
  await act(async () => root.render(createElement(ChatList, { messages: [user, assistant], loading: false, scrollRef })));
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).toBeNull();
  await act(async () => { root.unmount(); setStreamingMessage(''); }); host.remove();
});
```

- [ ] **Step 2: Run the test and observe the intended failure**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chatSingleResponse.test.tsx`

Expected: the completed-turn case finds `chat-streaming-preview` before the fix.

- [ ] **Step 3: Implement the smallest render guard**

```tsx
const showStreamingPreview = Boolean(
  loading && streamingMessage && messages.at(-1)?.role !== 'assistant',
);
// Use showStreamingPreview for the preview JSX and the loading announcement.
```

Do not de-duplicate narrative text by string equality: different turns may legitimately share words.

- [ ] **Step 4: Run the focused tests**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chatSingleResponse.test.tsx tests/unit/chatListScrollBehavior.test.ts`

Expected: all pass. Verify the preview is visible during generation and gone after handoff.

### Task 2: Inspect and protect durable history without erasing distinct turns

**Files:**
- Inspect: `hooks/useGame/aiMessageStage.ts`, `hooks/useGame/variableCalibrationStage.ts`, `hooks/useGame/recoveryResume.ts`
- Modify: `utils/settlementRebase.ts`
- Test: `tests/unit/chatSingleResponse.test.tsx`

**Interfaces:**
- Consumes: formal `聊天消息.id`, current history, and recovery journal assistant ID.
- Produces: history with unique message IDs while retaining distinct assistant IDs from different turns.

- [ ] **Step 1: Add a real rebase-history test**

```ts
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { rebaseSettlementState } from '@/utils/settlementRebase';
const ancestor = createEmptyTeyvatGameState();
const a2 = { id: 'a-2', role: 'assistant' as const, content: '相同文字', timestamp: 2, gameTime: '2' };
const a3 = { id: 'a-3', role: 'assistant' as const, content: '相同文字', timestamp: 3, gameTime: '3' };
const current = { ...ancestor, 对话: { ...ancestor.对话, entries: [a2] } };
const next = { ...ancestor, 对话: { ...ancestor.对话, entries: [a2, a2, a3] } };
const result = rebaseSettlementState({ ancestor, current, next });
expect(result.state.对话.entries.map((message) => message.id)).toEqual(['a-2', 'a-3']);
```

This pins the actual recovery/settlement merge rather than a standalone array fixture. Inspect the three callers to verify they pass stable assistant IDs and record any different duplicate origin before expanding the change.

- [ ] **Step 2: Run the replay test before changing the writer**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chatSingleResponse.test.tsx tests/unit/workflowRecoveryModel.test.ts`

Expected: duplicate `a-2` is present before the fix, so the test fails; `a-3` remains a distinct legal turn.

- [ ] **Step 3: Make the settlement merge idempotent by message ID**

```ts
const seen = new Set<string>();
const uniqueNextEntries = nextEntries.filter((entry) => {
  const id = (entry as { id?: unknown } | null | undefined)?.id;
  if (typeof id !== 'string' || !id) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});
// In mergeConversation, map uniqueNextEntries instead of nextEntries;
// keep the existing liveById replacement so edits to old entries survive.
```

Do not dedupe by content: `a-2` and `a-3` must both remain. If inspection shows a second, different writer appending duplicate IDs, add a regression to that writer before touching it.

- [ ] **Step 4: Run recovery and render regressions**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chatSingleResponse.test.tsx tests/unit/workflowRecoveryModel.test.ts tests/unit/postSettlementRecoveryIdentity.test.ts`

Expected: no duplicate ID, two distinct turn IDs visible, no recovery replay. Run full project verification during final integration.

### Task 3: Verify this independent fix

**Files:** none beyond Task 1–2.

**Interfaces:** Produces a separately testable chat repair for integration with the other plans.

- [ ] Run `node node_modules/typescript/bin/tsc --noEmit` and the focused Vitest command from Step 4; require exit code 0.
- [ ] Run `git diff --check` and review only files touched by this plan. Do not commit on the shared dirty `main` branch without the user's instruction; if execution moves to an isolated authorized branch, stage only this plan's paths before a commit.
