import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { createEmptyCourierSystem, type CourierDeliverySeed } from '@/models/teyvat/courier';
import { buildFallbackCourierSeed, runCourierDeliveryTask } from '@/hooks/useGame/courierBackgroundJobs';
import { planProactiveContacts } from '@/services/proactiveContacts';
import { mergeCourierSystemUpdates } from '@/services/ai/courierService';

const npc = { ...创建NPC记录({ 姓名: '阿林', 初见回合: 1 }), id: 'guide', 好感度: 120, 阶位: 'companion' as const, 最近回合: 30, 同行: false };
const courier = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_guide', npcId: npc.id, name: npc.姓名, available: true }] };
const input = { courier, npcs: [npc], turn: 30, userInput: '我背着阿林去行动。', body: '背着阿林，把秘密钥匙藏在钟楼。', maxSeedsPerTurn: 1, contactCooldownTurns: 3 };

describe('courier delivery knowledge and cleanup', () => {
  it('does not treat mentioning an absent NPC as proof that they know the narration', () => {
    expect(buildFallbackCourierSeed(input)).toBeNull();
  });
  it('uses only the sender\'s own recorded experience, never a raw narration excerpt', () => {
    const seed = buildFallbackCourierSeed({ ...input, npcs: [{ ...npc, 同行记忆: [{ id: 'known', 回合: 29, 来源: '正文', 摘要: '一起在城门喝茶', 原文: '一起在城门喝茶' }] }] });
    expect(seed).not.toBeNull();
    expect(seed?.context).toContain('城门喝茶');
    expect(JSON.stringify(seed)).not.toMatch(/秘密钥匙|钟楼|背着阿林/);
  });
  it('even a following character does not receive private narrator information without a recorded fact', () => {
    const seed = buildFallbackCourierSeed({ ...input, npcs: [{ ...npc, 同行: true }] });
    expect(JSON.stringify(seed)).not.toMatch(/秘密钥匙|钟楼|背着阿林/);
  });
  it('an explicitly empty proactive plan cannot be bypassed by the fallback channel', async () => {
    const result = await runCourierDeliveryTask({ ...input, enabled: true, autoGenerateSeeds: true, now: 1, letterApiConfig: null, proactiveSeeds: [] });
    expect(result.delivered).toBe(0);
    expect(result.courier.deliverySeeds).toEqual([]);
  });
  it('retains dismissed seeds even when there is no due delivery', async () => {
    const seed: CourierDeliverySeed = { id: 'blocked', senderId: npc.id, turn: 30, source: 'memory', triggerType: 'quest', priority: 'low', targetType: 'private', targetId: npc.id, title: '集合', reason: '集合', context: '城门见', relatedNpcIds: [npc.id], status: 'pending' };
    const base = { ...courier, deletedNpcIds: [npc.id], deliverySeeds: [seed], unreadTotal: 1 };
    const result = await runCourierDeliveryTask({ ...input, courier: base, enabled: true, autoGenerateSeeds: false, now: 1, letterApiConfig: null });
    expect(result.status).toBe('skipped');
    expect(result.courier.deliverySeeds[0]?.status).toBe('dismissed');
    expect(result.courier.unreadTotal).toBe(0);
    expect(mergeCourierSystemUpdates(base, base, result.courier).deliverySeeds.some(item => item.status === 'pending')).toBe(false);
  });
  it('keeps an explicitly locked sender out of scheduled delivery and memory', async () => {
    const seed: CourierDeliverySeed = { id: 'locked', senderId: npc.id, turn: 30, source: 'memory', triggerType: 'quest', priority: 'low', targetType: 'private', targetId: npc.id, title: '集合', reason: '集合', context: '城门见', relatedNpcIds: [npc.id], status: 'pending' };
    const result = await runCourierDeliveryTask({ ...input, courier: { ...courier, contacts: [{ ...courier.contacts[0]!, available: false, status: 'story_locked' }], deliverySeeds: [seed] }, enabled: true, autoGenerateSeeds: false, now: 1, letterApiConfig: null });
    expect(result.delivered).toBe(0);
    expect(result.courier.deliverySeeds[0]?.status).toBe('dismissed');
    expect(result.npcs[0]?.同行记忆 ?? []).toHaveLength(0);
  });
  it('preserves the agreed initial 15-turn cadence', () => {
    expect(planProactiveContacts({ courier, npcs: [npc], turn: 14, travelDay: 1 }).seeds).toEqual([]);
  });
  it('does not proactively contact from a locked contact', () => {
    expect(planProactiveContacts({ courier: { ...courier, contacts: [{ ...courier.contacts[0]!, available: false, status: 'story_locked' }] }, npcs: [npc], turn: 30, travelDay: 1 }).seeds).toEqual([]);
  });
  it('an explicit different NPC ID cannot be rebound by its display name', () => {
    expect(planProactiveContacts({ courier: { ...courier, contacts: [{ ...courier.contacts[0]!, npcId: 'different' }] }, npcs: [npc], turn: 30, travelDay: 1 }).seeds).toEqual([]);
  });
});
