import { describe, expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import * as courierService from '@/services/ai/courierService';
import { processScheduledCourierSeeds } from '@/hooks/useGame/courierWorkflow';

describe('courier group lifecycle and routing', () => {
  it('preserves untouched conversation references when delivering a due seed', () => {
    const system = normalizeCourierSystem({
      contacts: [
        { id: 'amber', name: '安柏', available: true },
        { id: 'lisa', name: '丽莎', available: true },
      ],
      conversations: [
        { id: 'amber-private', title: '安柏', participantIds: ['player', 'amber'], messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 },
        { id: 'lisa-private', title: '丽莎', participantIds: ['player', 'lisa'], messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 },
      ],
      deliverySeeds: [{
        id: 'amber-seed', senderId: 'amber', reason: '巡逻结束', turn: 2,
        source: 'main_story', triggerType: 'relationship', priority: 'normal',
        targetType: 'private', targetId: 'amber-private', title: '安柏的来信',
        context: '安柏结束了今天的巡逻。', relatedNpcIds: ['amber'], status: 'pending',
      }],
    });
    const untouchedConversation = system.conversations[1];

    const delivered = processScheduledCourierSeeds(system, 2, 2000).next;

    expect(delivered.conversations[1]).toBe(untouchedConversation);
    expect(delivered.conversations[0]?.messages.length).toBeGreaterThan(0);
  });

  it('routes a private delivery seed to the private chat instead of a group containing that sender', () => {
    const system = {
      ...createEmptyCourierSystem(),
      contacts: [
        { id: 'amber', name: '安柏', available: true },
        { id: 'lisa', name: '丽莎', available: true },
      ],
      conversations: [
        { id: 'mondstadt-group', title: '蒙德伙伴', participantIds: ['player', 'amber', 'lisa'], messages: [], unread: 0, type: 'group' as const, typingMemberIds: [], updatedAt: 1 },
        { id: 'amber-private', title: '安柏', participantIds: ['player', 'amber'], messages: [], unread: 0, type: 'private' as const, typingMemberIds: [], updatedAt: 2 },
      ],
      deliverySeeds: [{
        id: 'private-seed', senderId: 'amber', reason: '巡逻结束', turn: 2,
        source: 'main_story' as const, triggerType: 'relationship' as const, priority: 'normal' as const,
        targetType: 'private' as const, targetId: 'amber-private', title: '安柏的来信',
        context: '安柏想私下确认旅行者是否平安。', relatedNpcIds: ['amber'], status: 'pending' as const,
      }],
    };

    const delivered = processScheduledCourierSeeds(system, 2, 2000).next;
    expect(delivered.conversations.find((item) => item.id === 'mondstadt-group')?.messages).toHaveLength(0);
    expect(delivered.conversations.find((item) => item.id === 'amber-private')?.messages.length).toBeGreaterThan(0);
  });

  it('dissolves a player-owned group without deleting its contacts or private chats', () => {
    const dissolve = Reflect.get(courierService, 'dissolveCourierGroupConversation') as undefined | ((system: ReturnType<typeof createEmptyCourierSystem>, id: string) => ReturnType<typeof createEmptyCourierSystem>);
    expect(dissolve).toBeTypeOf('function');
    const system = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', name: '安柏', available: true }],
      conversations: [
        { id: 'group', title: '群聊', participantIds: ['player', 'amber'], messages: [], unread: 3, type: 'group' as const, typingMemberIds: [], creatorId: 'player', updatedAt: 1 },
        { id: 'private', title: '安柏', participantIds: ['player', 'amber'], messages: [], unread: 1, type: 'private' as const, typingMemberIds: [], updatedAt: 2 },
      ],
    };

    const next = dissolve?.(system, 'group');
    expect(next?.conversations.map((item) => item.id)).toEqual(['private']);
    expect(next?.contacts).toEqual(system.contacts);
    expect(next?.unreadTotal).toBe(1);
  });

  it('keeps only the selected canon traveler in companion and phone state', () => {
    const base = createEmptyTeyvatGameState();
    const npcs = normalizeTeyvatNpcRecords([
      { id: 'npc_aether', 姓名: '空', roleTier: 'companion', canonical: true, firstSeenTurn: 1, lastSeenTurn: 1 },
      { id: 'npc_lumine', 姓名: '荧', roleTier: 'companion', canonical: true, firstSeenTurn: 1, lastSeenTurn: 1 },
    ]);
    const normalized = normalizeTeyvatGameState({
      ...base,
      世界: { ...base.世界, 原著旅行者: '荧' },
      NPC: npcs,
      手机: {
        ...base.手机,
        contacts: [
          { id: 'contact_npc_aether', npcId: 'npc_aether', name: '空', available: true },
          { id: 'contact_npc_lumine', npcId: 'npc_lumine', name: '荧', available: true },
        ],
        conversations: [
          { id: 'aether-private', title: '空', participantIds: ['player', 'contact_npc_aether'], messages: [], unread: 1, type: 'private', typingMemberIds: [], updatedAt: 1 },
          { id: 'lumine-private', title: '荧', participantIds: ['player', 'contact_npc_lumine'], messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 2 },
        ],
      },
    });

    expect(normalized.NPC.map((npc) => npc.姓名)).toEqual(['荧']);
    expect(normalized.手机.contacts.map((contact) => contact.name)).toEqual(['荧']);
    expect(normalized.手机.conversations.map((conversation) => conversation.id)).toEqual(['lumine-private']);
  });
});
