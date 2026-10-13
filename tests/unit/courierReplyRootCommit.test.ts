import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import { mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { runCourierDeliveryTask, runCourierReplyPass, revealCourierMessages } from '@/hooks/useGame/courierBackgroundJobs';
import { applyCourierReplyMessageIfLive } from '@/utils/courierReplyCommit';
import { updateCourierGroupConversation } from '@/services/ai/courierService';

async function fixture() {
  const game = createEmptyTeyvatGameState();
  game.NPC = normalizeTeyvatNpcRecords(['a', 'b'].map(id => ({ id: `npc_${id}`, 姓名: '同名向导', affinity: 20, firstSeenTurn: 1, lastSeenTurn: 1 })));
  game.手机 = { ...createEmptyCourierSystem(), contacts: ['a', 'b'].map(id => ({ id, npcId: `npc_${id}`, name: '同名向导', available: true })),
    conversations: [{ id: 'thread', title: '茶会', type: 'group', participantIds: ['player', 'a', 'b'], messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '谢谢', turn: 2, timestamp: 1, readBy: ['player'] }], unread: 0, typingMemberIds: [], updatedAt: 1 }] };
  const baseNpcs = mapTeyvatNpcsToLegacy(game);
  const result = await runCourierReplyPass({ courier: game.手机, npcs: baseNpcs, turn: 2, letterApiConfig: null });
  return { game, result, input: { baseCourier: game.手机, resultCourier: result.courier, baseNpcs, expectedSessionId: 1, currentSessionId: 1 } };
}

async function commit(game: TeyvatGameState, input: { baseCourier: CourierSystem; resultCourier: CourierSystem; baseNpcs: ReturnType<typeof mapTeyvatNpcsToLegacy>; expectedSessionId: number; currentSessionId: number; messagesAlreadyRevealed?: boolean }): Promise<TeyvatGameState> {
  const path = '../../hooks/useGame/courierReplyCommitWorkflow';
  const module = await import(path).catch(() => null);
  expect(module?.applyCourierReplyTaskResult).toBeTypeOf('function');
  return module!.applyCourierReplyTaskResult(game, input);
}

describe('one live root owns reply messages and NPC settlement', () => {
  it('background commit accepts only live members and settles only their actual messages', async () => {
    const state = await fixture();
    const live = { ...state.game, 手机: updateCourierGroupConversation(state.game.手机, 'thread', { title: '已改名', memberIds: ['b'] }) };
    const next = await commit(live, state.input);
    expect(next.手机.conversations[0]?.messages.filter(message => message.senderId !== 'player').map(message => message.senderId)).toEqual(['b']);
    expect(next.NPC[0]?.sharedMemories).toHaveLength(0);
    expect(next.NPC[0]?.affinity).toBe(20);
    expect(next.NPC[1]?.sharedMemories).toHaveLength(1);
    expect(next.NPC[1]?.affinity).toBe(22);
    expect(next.手机.conversations[0]?.title).toBe('已改名');
  });
  it('immediate reveal can remove a member between 0.5-second bubbles without leaking their memory', async () => {
    const state = await fixture(); let live = state.game;
    const waits: number[] = [];
    const messages = state.result.courier.conversations[0]!.messages.slice(1);
    await revealCourierMessages(messages, (message, index) => {
      if (index === 0) live = { ...live, 手机: updateCourierGroupConversation(live.手机, 'thread', { title: '茶会', memberIds: ['b'] }) };
      live = { ...live, 手机: applyCourierReplyMessageIfLive({ current: live.手机, expectedSessionId: 1, currentSessionId: 1, conversationId: 'thread', messageIds: ['p1'], message }) };
    }, 500, async delay => { waits.push(delay); });
    const next = await commit(live, { ...state.input, messagesAlreadyRevealed: true });
    expect(waits).toEqual([500, 500]);
    expect(next.NPC[0]?.sharedMemories).toHaveLength(0);
    expect(next.NPC[1]?.sharedMemories).toHaveLength(1);
  });
  it('late root updater uses current session and cannot modify a new save', async () => {
    const state = await fixture();
    const fresh = createEmptyTeyvatGameState(); fresh.旅行者.姓名 = '另一个存档';
    expect(await commit(fresh, { ...state.input, currentSessionId: 2 })).toBe(fresh);
  });
  it('retry is idempotent and retains concurrent live NPC edits', async () => {
    const state = await fixture();
    const live = { ...state.game, NPC: state.game.NPC.map(npc => ({ ...npc, appearance: '新外貌资料', affinity: 50 })) };
    const next = await commit(live, state.input);
    expect(next.NPC[0]).toMatchObject({ appearance: '新外貌资料', affinity: 52 });
    const replay = await commit(next, state.input);
    expect(replay.NPC[0]?.affinity).toBe(52);
    expect(replay.NPC[0]?.sharedMemories).toHaveLength(1);
  });

  it('commits skipped delivery cleanup to the real root without a new conversation', async () => {
    const game = createEmptyTeyvatGameState(); game.turnCount = 30;
    game.手机 = { ...game.手机, deletedNpcIds: ['npc_a'], deliverySeeds: [{ id: 'blocked', senderId: 'npc_a', turn: 30, source: 'memory', triggerType: 'quest', priority: 'low', targetType: 'private', targetId: 'npc_a', reason: '问候', title: '问候', context: '在城门见', relatedNpcIds: ['npc_a'], status: 'pending' }], unreadTotal: 1 };
    const baseNpcs = mapTeyvatNpcsToLegacy(game);
    const result = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: false, courier: game.手机, npcs: baseNpcs, turn: 30, now: 1, userInput: '', body: '', maxSeedsPerTurn: 1, contactCooldownTurns: 3, letterApiConfig: null });
    expect(result.status).toBe('skipped');
    const path = '../../hooks/useGame/courierReplyCommitWorkflow'; const module = await import(path);
    expect(module.applyCourierDeliveryTaskResult).toBeTypeOf('function');
    const next = module.applyCourierDeliveryTaskResult(game, { baseCourier: game.手机, resultCourier: result.courier, baseNpcs, currentSessionId: 1, expectedSessionId: 1 });
    expect(next.手机.deliverySeeds.some((seed: { status: string }) => seed.status === 'pending')).toBe(false);
    expect(next.手机.unreadTotal).toBe(0);
    expect(next.手机.conversations).toHaveLength(0);
  });

  it('late delivery cannot add visible messages or NPC memory after the sender is locked', async () => {
    const state = await fixture();
    const base = { ...state.game.手机, conversations: [{ ...state.game.手机.conversations[0]!, type: 'private' as const, participantIds: ['player', 'a'], messages: [] }], deliverySeeds: [{ id: 'letter', senderId: 'npc_a', turn: 2, source: 'memory' as const, triggerType: 'quest' as const, priority: 'low' as const, targetType: 'private' as const, targetId: 'thread', reason: '问候', title: '问候', context: '在城门见', relatedNpcIds: ['npc_a'], status: 'pending' as const }] };
    const baseNpcs = mapTeyvatNpcsToLegacy(state.game);
    const result = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: false, courier: base, npcs: baseNpcs, turn: 2, now: 1, userInput: '', body: '', maxSeedsPerTurn: 1, contactCooldownTurns: 3, letterApiConfig: null });
    expect(result.delivered).toBe(1);
    const live = { ...state.game, 手机: { ...base, contacts: base.contacts.map(contact => contact.id === 'a' ? { ...contact, available: false } : contact) } };
    const path = '../../hooks/useGame/courierReplyCommitWorkflow'; const module = await import(path);
    expect(module.applyCourierDeliveryTaskResult).toBeTypeOf('function');
    const next = module.applyCourierDeliveryTaskResult(live, { baseCourier: base, resultCourier: result.courier, baseNpcs, currentSessionId: 1, expectedSessionId: 1 });
    expect(next.手机.conversations[0]?.messages).toHaveLength(0);
    expect(next.NPC[0]?.sharedMemories).toHaveLength(0);
    expect(next.手机.contacts[0]?.available).toBe(false);
  });
  it('received delivery memory keeps the message turn rather than a later live counter', async () => {
    const state = await fixture();
    const base = { ...state.game.手机, deliverySeeds: [{ id: 'letter', senderId: 'npc_a', turn: 2, source: 'memory' as const, triggerType: 'quest' as const, priority: 'low' as const, targetType: 'private' as const, targetId: 'npc_a', reason: '问候', title: '问候', context: '在城门见', relatedNpcIds: ['npc_a'], status: 'pending' as const }] };
    const baseNpcs = mapTeyvatNpcsToLegacy(state.game);
    const result = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: false, courier: base, npcs: baseNpcs, turn: 2, now: 1, userInput: '', body: '', maxSeedsPerTurn: 1, contactCooldownTurns: 3, letterApiConfig: null });
    const path = '../../hooks/useGame/courierReplyCommitWorkflow'; const module = await import(path);
    const next = module.applyCourierDeliveryTaskResult({ ...state.game, turnCount: 40, 手机: base }, { baseCourier: base, resultCourier: result.courier, baseNpcs, currentSessionId: 1, expectedSessionId: 1 });
    expect(next.NPC[0]?.sharedMemories[0]?.turn).toBe(2);
  });
});
