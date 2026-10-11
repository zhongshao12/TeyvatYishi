// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CourierPhotoAction } from '@/components/features/Courier/CourierPhotoAction';
import { createCourierReplyQueue, type CourierReplyDispatchResult } from '@/hooks/useGame/courierReplyQueue';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { normalizeCourierSystem } from '@/models/teyvat/courier';
import { 创建NPC记录 } from '@/models/npc';
import { runCourierReplyPass, revealCourierMessages } from '@/hooks/useGame/courierBackgroundJobs';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = () => {
  const npcs = ['amber', 'lisa', 'silent'].map(id => ({ ...创建NPC记录({ 姓名: id, 初见回合: 1 }), id }));
  const courier = createEmptyCourierSystem();
  courier.contacts = npcs.map(npc => ({ id: npc.id, npcId: npc.id, name: npc.姓名, available: true }));
  courier.conversations = [{ id: 'group', title: 'group', type: 'group', participantIds: ['player', ...npcs.map(npc => npc.id)], unread: 0, typingMemberIds: [], updatedAt: 1, messages: [
    { id: 'ask', senderId: 'player', senderName: 'player', role: 'user', content: '拍照', turn: 1, timestamp: 1, readBy: [] },
    ...['amber', 'lisa'].map(id => ({ id: `courier_group_reply_ask_${id}`, senderId: id, senderName: id, role: 'contact', content: '可以', turn: 1, timestamp: 2, readBy: [] })),
  ] }];
  return { courier, npcs };
};
describe('unified phone photo action', () => {
  it('unlocks a completed new exchange despite an older failed reply and preserves retry of the old message', async () => {
    vi.useFakeTimers();
    const { courier, npcs } = fixture();
    const chat = courier.conversations[0]!;
    chat.type = 'private'; chat.participantIds = ['player', 'amber'];
    const player = chat.messages[0]!;
    chat.messages = [{ ...player, id: 'old', content: '你好' }];
    const dispatched: string[][] = [];
    let finishNew!: (result: CourierReplyDispatchResult) => void;
    let finishOldRetry!: (result: CourierReplyDispatchResult) => void;
    const queue = createCourierReplyQueue({ getSessionId: () => 7, dispatch: async batch => {
      dispatched.push(batch.messageIds);
      if (dispatched.length === 1) return 'retry';
      if (batch.messageIds.includes('new')) return new Promise(resolve => { finishNew = resolve; });
      return new Promise(resolve => { finishOldRetry = resolve; });
    } });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onRequest = vi.fn();
    // The conversation-level banner may still describe an earlier failed batch.
    const render = () => act(async () => root.render(createElement(CourierPhotoAction, { courier, npcRecords: npcs, conversationId: 'group', replyQueue: queue, failed: true, onRequest })));
    try {
      await render();
      await act(async () => { queue.enqueue({ conversationId: 'group', messageId: 'old', sessionId: 7 }); await vi.advanceTimersByTimeAsync(500); });
      chat.messages.push({ ...player, id: 'new', turn: 2, timestamp: 3 });
      await render();
      await act(async () => { queue.enqueue({ conversationId: 'group', messageId: 'new', sessionId: 7 }); await vi.advanceTimersByTimeAsync(500); });
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      chat.messages.push({ ...player, id: 'courier_reply_new_0', senderId: 'amber', senderName: 'amber', role: 'contact', content: '可以', turn: 2, timestamp: 4,
        replyToMessageIds: ['new'], expectedReplyIds: ['courier_reply_new_0'] });
      await render();
      // Even with the final bubble present, delivery still owns this request.
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      await act(async () => { finishNew('sent'); await vi.advanceTimersByTimeAsync(0); });
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
      expect(onRequest).toHaveBeenCalledWith('courier_reply_new_0');
      await act(async () => { queue.retry('group', ['old']); await vi.advanceTimersByTimeAsync(0); });
      expect(dispatched).toEqual([['old'], ['new'], ['old']]);
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
      await act(async () => { finishOldRetry('sent'); await vi.advanceTimersByTimeAsync(0); });
    } finally { await act(async () => root.unmount()); queue.dispose(); host.remove(); vi.useRealTimers(); }
  });
  it.each(['unavailable-contact', 'missing-npc', 'already-attached', 'still-typing'] as const)('keeps %s disabled and exposes a visible explanation', async kind => {
    const { courier, npcs } = fixture();
    if (kind === 'unavailable-contact') courier.contacts.forEach(contact => { contact.available = false; });
    if (kind === 'missing-npc') npcs.length = 0;
    if (kind === 'already-attached') courier.conversations[0]!.messages.slice(1).forEach(message => { message.photo = { assetId: 'asset', entryId: 'entry', npcId: message.senderId }; });
    if (kind === 'still-typing') courier.conversations[0]!.typingMemberIds = ['amber'];
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onRequest = vi.fn();
    try {
      await act(async () => root.render(createElement(CourierPhotoAction, { courier, npcRecords: npcs, conversationId: 'group', failed: false, onRequest })));
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBeTruthy();
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
      expect(onRequest).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('retains the conservative failure guard when no exchange-aware queue is supplied', async () => {
    const { courier, npcs } = fixture();
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CourierPhotoAction, { courier, npcRecords: npcs, conversationId: 'group', failed: true, onRequest: vi.fn() })));
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      expect(host.querySelector('[role="status"]')?.textContent).toContain('当前这轮回信尚未完成');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('keeps real partial group replies blocked after reload with an empty queue, then unlocks only after missing members retry', async () => {
    const { courier, npcs } = fixture();
    courier.conversations[0]!.participantIds = ['player', 'amber', 'lisa'];
    courier.conversations[0]!.messages = courier.conversations[0]!.messages.slice(0, 1);
    const input = { npcs, turn: 1, fallbackPolicy: 'error' as const, replyBatch: { conversationId: 'group', messageIds: ['ask'] },
      letterApiConfig: { id: 'test', name: 'test', provider: 'openai_compatible' as const, baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1 } };
    const partial = await runCourierReplyPass({ ...input, courier, groupReplyGenerator: async (_config, context) => {
      if (context.sender?.name === 'lisa') throw new Error('MODEL_DOWN'); return '可以。';
    } });
    expect(partial.failedMemberNames).toEqual(['lisa']);
    let loaded = normalizeCourierSystem(JSON.parse(JSON.stringify(partial.courier)));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const emptyQueue = createCourierReplyQueue({ getSessionId: () => 7, dispatch: async () => 'sent' });
    const render = () => act(async () => root.render(createElement(CourierPhotoAction, { courier: loaded, npcRecords: npcs, conversationId: 'group', replyQueue: emptyQueue, failed: false, onRequest: vi.fn() })));
    try {
      await render();
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      const partialRetry = await runCourierReplyPass({ ...input, courier: loaded, groupReplyGenerator: async () => { throw new Error('STILL_DOWN'); } });
      loaded = normalizeCourierSystem(JSON.parse(JSON.stringify(partialRetry.courier)));
      await render();
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      expect(loaded.conversations[0]!.messages.filter(message => message.expectedReplyIds)).toHaveLength(1);
      const retryCalls: string[] = [];
      const retried = await runCourierReplyPass({ ...input, courier: loaded, groupReplyGenerator: async (_config, context) => { retryCalls.push(context.sender?.name ?? ''); return '补上了。'; } });
      expect(retryCalls).toEqual(['lisa']);
      loaded = normalizeCourierSystem(JSON.parse(JSON.stringify(retried.courier)));
      await render();
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
      const proofs = loaded.conversations[0]!.messages.filter(message => message.expectedReplyIds);
      expect(proofs).toHaveLength(1);
      expect(proofs[0]?.expectedReplyIds?.sort()).toEqual(['courier_group_reply_ask_amber', 'courier_group_reply_ask_lisa']);
    } finally { await act(async () => root.unmount()); emptyQueue.dispose(); host.remove(); }
  });
  it('keeps a real private reply saved midway through 500ms reveals blocked until every segment is loaded', async () => {
    const { courier, npcs } = fixture();
    npcs[0]!.好感度 = 100;
    const conversation = courier.conversations[0]!;
    conversation.type = 'private'; conversation.participantIds = ['player', 'amber']; conversation.messages = conversation.messages.slice(0, 1);
    const result = await runCourierReplyPass({ courier, npcs, turn: 1, letterApiConfig: null, replyBatch: { conversationId: 'group', messageIds: ['ask'] } });
    const replies = result.courier.conversations[0]!.messages.slice(1);
    expect(replies.length).toBeGreaterThan(1);
    let saved = courier;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const delays: number[] = [];
    try {
      await revealCourierMessages(replies, async (message, index) => {
        saved = normalizeCourierSystem(JSON.parse(JSON.stringify({ ...saved, conversations: [{ ...saved.conversations[0]!, typingMemberIds: [], messages: [...saved.conversations[0]!.messages, message] }] })));
        await act(async () => root.render(createElement(CourierPhotoAction, { courier: saved, npcRecords: npcs, conversationId: 'group', failed: false, onRequest: vi.fn() })));
        expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(index < replies.length - 1);
      }, 500, async ms => { delays.push(ms); });
      expect(delays.every(ms => ms === 500)).toBe(true);
      expect(saved.conversations[0]!.messages.filter(message => message.expectedReplyIds)).toHaveLength(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('selects only actual valid group responders and has exactly one photo entry', async () => {
    const { courier, npcs } = fixture();
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onRequest = vi.fn();
    try {
      await act(async () => root.render(createElement(CourierPhotoAction, { courier, npcRecords: npcs, conversationId: 'group', failed: false, onRequest })));
      expect(host.querySelectorAll('button')).toHaveLength(1);
      const select = host.querySelector<HTMLSelectElement>('select')!;
      expect([...select.options].map(item => item.textContent)).toEqual(['amber', 'lisa']);
      select.value = 'courier_group_reply_ask_lisa';
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
      expect(onRequest).toHaveBeenCalledWith('courier_group_reply_ask_lisa');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it('stays blocked through enqueue, active reveal and partial failure until retry succeeds', async () => {
    vi.useFakeTimers();
    const { courier, npcs } = fixture();
    let finish!: (result: CourierReplyDispatchResult) => void;
    const queue = createCourierReplyQueue({ getSessionId: () => 7, dispatch: () => new Promise(resolve => { finish = resolve; }) });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CourierPhotoAction, { courier, npcRecords: npcs, conversationId: 'group', replyQueue: queue, failed: false, onRequest: vi.fn() })));
      const button = () => host.querySelector<HTMLButtonElement>('button')!;
      expect(button().disabled).toBe(false);
      await act(async () => queue.enqueue({ conversationId: 'group', messageId: 'ask', sessionId: 7 }));
      expect(button().disabled).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(button().disabled).toBe(true);
      await act(async () => { finish('retry'); await vi.advanceTimersByTimeAsync(0); });
      expect(button().disabled).toBe(true);
      await act(async () => { queue.retry('group'); await vi.advanceTimersByTimeAsync(0); });
      expect(button().disabled).toBe(true);
      await act(async () => { finish('sent'); await vi.advanceTimersByTimeAsync(0); });
      expect(button().disabled).toBe(false);
    } finally { await act(async () => root.unmount()); queue.dispose(); host.remove(); vi.useRealTimers(); }
  });
});
