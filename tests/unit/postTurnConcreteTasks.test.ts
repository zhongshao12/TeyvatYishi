import { describe, expect, it } from 'vitest';
import { normalizeTeyvatGameState } from '@/models/teyvat/state';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import type { 聊天消息, 叙事插图 } from '@/models/chat';
import { runPostTurnIrminsulArchiveTask } from '@/hooks/useGame/postTurnIrminsulTask';
import {
  runCourierDeliveryTask,
  runCourierReplyTask,
} from '@/hooks/useGame/courierBackgroundJobs';
import { runPostTurnNarrativeImageTask } from '@/hooks/useGame/postTurnNarrativeImageTask';
import { runPostTurnAutosaveTask } from '@/hooks/useGame/postTurnAutosaveTask';

describe('post-turn concrete tasks', () => {
  it('archives the public turn summary even when Irminsul recall is disabled', () => {
    const game = normalizeTeyvatGameState({ turnCount: 3 });
    const output = runPostTurnIrminsulArchiveTask({
      base: game.世界树,
      committedGame: game,
      turn: 3,
      summary: '旅行者在蒙德完成了委托。',
      body: '骑士团确认委托完成。',
      location: '蒙德城',
      worldEvents: ['城门恢复通行'],
      gameTime: '提瓦特历 1 年 1 月 1 日',
      questFactCandidates: [],
      recallEnabled: false,
      recallEligible: false,
      earliestRecallTurn: 10,
      recallHitCount: 0,
      recallUsedModel: false,
      now: 1000,
    });

    expect(output.memory.entries).toHaveLength(1);
    expect(output.memory.entries[0]?.summary).toBe('旅行者在蒙德完成了委托。');
    expect(output.recallStatus).toBe('skipped');
    expect(output.recallDetail).toContain('归档仍已执行');
  });

  it('delivers due courier seeds and returns the updated courier snapshot', async () => {
    const courier = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', name: '安柏', available: true }],
      deliverySeeds: [{
        id: 'seed-1', senderId: 'amber', reason: '巡逻结束', turn: 2,
        source: 'system' as const, triggerType: 'custom' as const, priority: 'normal' as const,
        targetType: 'private' as const, targetId: 'amber', title: '巡逻消息', context: '我已经回到蒙德城。',
        relatedNpcIds: ['amber'], status: 'pending' as const,
      }],
    };
    const output = await runCourierDeliveryTask({
      enabled: true,
      autoGenerateSeeds: false,
      courier,
      npcs: [],
      turn: 2,
      now: 2000,
      userInput: '',
      body: '',
      maxSeedsPerTurn: 1,
      contactCooldownTurns: 3,
      letterApiConfig: null,
    });

    expect(output.delivered).toBe(1);
    expect(output.status).toBe('success');
    expect(output.courier.deliverySeeds[0]?.status).toBe('generated');
    expect(output.courier.conversations[0]?.messages.length).toBeGreaterThan(0);
  });

  it('runs the real courier reply pass and returns the changed NPC snapshot', async () => {
    const events: string[] = [];
    const courier = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', name: '安柏', available: true }],
      conversations: [{
        id: 'conv-amber', title: '安柏', participantIds: ['player', 'amber'],
        messages: [{ id: 'player-1', senderId: 'player', senderName: '旅行者', role: 'user', content: '巡逻顺利吗？', turn: 2, timestamp: 2000, readBy: ['player'] }],
        unread: 0, type: 'private' as const, typingMemberIds: [], updatedAt: 2000,
      }],
    };
    const output = await runCourierReplyTask({
      enabled: true,
      courier,
      npcs: [],
      letterApiConfig: null,
      turn: 3,
      travelerName: '旅行者',
      onPending: (detail) => { events.push(detail); },
    });

    expect(output.replied).toBe(1);
    expect(output.status).toBe('success');
    expect(output.courier.conversations[0]?.messages.at(-1)?.role).toBe('contact');
    expect(output.npcs.some((npc) => npc.姓名 === '安柏')).toBe(true);
    expect(events).toEqual(['正在生成 1 个手机会话的角色回复。']);
  });

  it('attaches generated narrative images to the target assistant message', async () => {
    const history: 聊天消息[] = [{ id: 'assistant-1', role: 'assistant', content: '正文', timestamp: 1 }];
    const image: 叙事插图 = {
      id: 'image-1', dataUrl: 'asset://image-1', type: 'scene', kind: 'snapshot', prompt: '蒙德城',
      negativePrompt: '', description: '蒙德城', status: 'done',
    };
    const output = await runPostTurnNarrativeImageTask({
      enabled: true,
      mode: 'auto',
      hasImageConfig: true,
      history,
      targetMessageId: 'assistant-1',
      generate: async () => [image],
    });

    expect(output.status).toBe('success');
    expect(output.generatedCount).toBe(1);
    expect(output.history[0]?.narrativeImages).toEqual([image]);
  });

  it('performs autosave side effects in durable order', async () => {
    const order: string[] = [];
    const output = await runPostTurnAutosaveTask({
      enabled: true,
      build: () => ({ id: 'save-1' }),
      assertActive: () => { order.push('assert'); },
      persist: async (payload) => { order.push(`persist:${payload.id}`); },
      commit: (payload) => { order.push(`commit:${payload.id}`); },
      markSaved: () => { order.push('mark'); },
    });

    expect(output.status).toBe('saved');
    expect(order).toEqual(['assert', 'persist:save-1', 'assert', 'commit:save-1', 'mark']);
  });
});
