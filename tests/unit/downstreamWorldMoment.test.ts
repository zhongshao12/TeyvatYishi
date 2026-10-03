import { describe, expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
import { normalizeSteambirdNews } from '@/models/teyvat/steambird';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { captureWorldMoment } from '@/services/worldMoment';
import { processScheduledCourierSeeds } from '@/hooks/useGame/courierWorkflow';
import { runSteambirdGenerationStep } from '@/hooks/useGame/steambirdWorkflow';
import { runCourierDeliveryTask, runCourierReplyTask } from '@/hooks/useGame/courierBackgroundJobs';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { stampCommittedEventProvenance } from '@/services/committedEventProvenance';
import { createMoment } from '@/services/courierMoments';
import { 创建NPC记录 } from '@/models/npc';

describe('downstream consumers of committed world time', () => {
  it('keeps a delayed turn-two news article and delivered phone message at turn two', () => {
    const world = createEmptyTeyvatWorld();
    world.当前日期 = '旅行历 1000.03.07';
    world.当前时间 = '14:00';
    world.当前地点 = '蒙德城';
    const turnTwo = captureWorldMoment(world, 2, 'settlement-2');
    world.当前时间 = '18:00';
    const technicalTime = 1_800_000_000_000;

    const article = runSteambirdGenerationStep({
      current: normalizeSteambirdNews({}),
      publicFacts: [{ title: '城中见闻', detail: '侦察骑士报告了风魔龙的踪迹。' }],
      turnCount: 2,
      now: technicalTime,
      worldMoment: turnTwo,
    })?.steambird.articles[0];
    expect(article?.worldMoment?.clock).toBe('14:00');
    expect(article?.timestamp).toBe(technicalTime);

    const courier = createEmptyCourierSystem();
    courier.deliverySeeds.push({
      id: 'seed-2', senderId: 'amber', reason: '见闻', turn: 2, source: 'main_story',
      triggerType: 'custom', priority: 'normal', targetType: 'private', targetId: 'amber',
      title: '安柏的来信', context: '记得留意城门附近。', relatedNpcIds: [], status: 'pending',
    });
    const delivered = processScheduledCourierSeeds(courier, 2, technicalTime, { worldMoment: turnTwo });
    const message = delivered.next.conversations[0]?.messages[0];
    expect(message?.worldMoment?.clock).toBe('14:00');
    expect(message?.timestamp).toBe(technicalTime);
  });

  it('does not infer old record times from the current clock', () => {
    const news = normalizeSteambirdNews({ articles: [{ id: 'old', title: '旧闻', timestamp: 123 }] });
    const phone = normalizeCourierSystem({ conversations: [{ id: 'old', messages: [{ id: 'msg', timestamp: 123 }] }] });
    expect(news.articles[0]?.worldMoment).toBeUndefined();
    expect(phone.conversations[0]?.messages[0]?.worldMoment).toBeUndefined();
  });

  it('retains the committed time through asynchronous delivery and a later private reply', async () => {
    const world = createEmptyTeyvatWorld();
    world.当前时间 = '14:00';
    const origin = captureWorldMoment(world, 2, 'settlement-2');
    world.当前时间 = '18:00';
    const courier = createEmptyCourierSystem();
    courier.contacts.push({ id: 'amber', name: '安柏', available: true });
    courier.deliverySeeds.push({
      id: 'seed-2', senderId: 'amber', reason: '见闻', turn: 2, source: 'main_story',
      triggerType: 'custom', priority: 'normal', targetType: 'private', targetId: 'amber',
      title: '安柏的来信', context: '记得留意城门附近。', relatedNpcIds: [], status: 'pending',
    });
    const delivery = await runCourierDeliveryTask({
      enabled: true, autoGenerateSeeds: false, courier,
      npcs: [{ ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber' }], turn: 2,
      now: 1_800_000_000_000, userInput: '', body: '', maxSeedsPerTurn: 1,
      contactCooldownTurns: 3, letterApiConfig: null, worldMoment: origin,
    });
    expect(delivery.courier.conversations[0]?.messages[0]?.worldMoment?.clock).toBe('14:00');
    expect(delivery.npcs.find((npc) => npc.姓名 === '安柏')?.同行记忆?.at(-1)?.worldMoment?.clock).toBe('14:00');

    const conversation = delivery.courier.conversations[0]!;
    const withPlayerMessage = {
      ...delivery.courier,
      conversations: [{
        ...conversation,
        messages: [...conversation.messages, {
          id: 'player-after-delivery', senderId: 'player', senderName: '旅人', role: 'user',
          content: '谢谢提醒', turn: 2, timestamp: 1_800_000_000_100, readBy: ['player'],
          worldMoment: origin,
        }],
      }],
    };
    const reply = await runCourierReplyTask({
      enabled: true, courier: withPlayerMessage, npcs: delivery.npcs, letterApiConfig: null,
      turn: 2, worldMoment: origin,
    });
    expect(reply.courier.conversations[0]?.messages.at(-1)?.worldMoment?.clock).toBe('14:00');
    expect(reply.npcs.find((npc) => npc.姓名 === '安柏')?.同行记忆?.at(-1)?.worldMoment?.clock).toBe('14:00');
  });

  it('stamps only new quest, NPC and world events, keeping stable IDs across replay and reload', () => {
    const before = createEmptyTeyvatGameState();
    before.世界.世界事件 = ['旧事件'];
    before.任务.active.push({
      id: 'quest-1', title: '旧任务', description: '', source: 'side', status: 'active',
      objectives: [], rewards: [], createdAtTurn: 1, updatedAt: 1,
    });
    const after = normalizeTeyvatGameState(JSON.parse(JSON.stringify(before)));
    after.世界.世界事件.push('风魔龙的踪迹出现');
    after.任务.active[0] = { ...after.任务.active[0]!, status: 'completed', updatedAt: 2 };
    after.NPC.push({
      ...normalizeTeyvatGameState({ NPC: [{ id: 'amber', 姓名: '安柏' }] }).NPC[0]!,
      sharedMemories: [{ id: 'npc-memory-2', turn: 2, summary: '一同发现踪迹', relatedNpcIds: [] }],
    });
    const world = after.世界;
    world.当前时间 = '14:00';
    const moment = captureWorldMoment(world, 2, 'settlement-2');
    world.当前时间 = '18:00';

    const stamped = stampCommittedEventProvenance(before, after, moment);
    expect(stamped.世界.世界事件记录).toEqual([{
      id: 'world_event_settlement-2_1', text: '风魔龙的踪迹出现', worldMoment: moment,
    }]);
    expect(stamped.任务.active[0]?.worldMoment?.clock).toBe('14:00');
    expect(stamped.NPC[0]?.sharedMemories[0]?.worldMoment?.clock).toBe('14:00');
    expect(stampCommittedEventProvenance(before, stamped, moment).世界.世界事件记录).toHaveLength(1);
    const loaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(stamped)));
    expect(loaded.世界.世界事件记录[0]?.worldMoment?.clock).toBe('14:00');
    expect(loaded.任务.active[0]?.worldMoment?.clock).toBe('14:00');
    expect(loaded.NPC[0]?.sharedMemories[0]?.worldMoment?.clock).toBe('14:00');
    expect(normalizeTeyvatGameState(JSON.parse(JSON.stringify(before))).任务.active[0]?.worldMoment).toBeUndefined();
  });

  it('keeps a player moment and its later comment at the post time rather than the reply wall clock', () => {
    const world = createEmptyTeyvatWorld();
    world.当前时间 = '14:00';
    const postMoment = captureWorldMoment(world, 2, 'settlement-2');
    const posted = createMoment(createEmptyCourierSystem(), {
      id: 'post-2', content: '今天见到了风魔龙', turn: 2, now: 1000, worldMoment: postMoment,
    });
    world.当前时间 = '18:00';
    const normalized = normalizeCourierSystem(JSON.parse(JSON.stringify(posted)));
    expect(normalized.moments?.[0]?.worldMoment?.clock).toBe('14:00');
    expect(normalized.moments?.[0]?.createdAt).toBe(1000);
    const withComment = normalizeCourierSystem({
      ...posted,
      moments: [{ ...posted.moments![0], comments: [{
        id: 'comment-1', npcId: 'amber', npcName: '安柏', content: '我也看到了！',
        createdAt: 2000, worldMoment: postMoment,
      }] }],
    });
    expect(withComment.moments?.[0]?.comments[0]?.worldMoment?.clock).toBe('14:00');
    expect(withComment.moments?.[0]?.comments[0]?.createdAt).toBe(2000);
  });
});
