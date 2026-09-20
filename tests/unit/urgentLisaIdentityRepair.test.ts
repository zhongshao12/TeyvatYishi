import { describe, expect, it } from 'vitest';
import { normalizeTeyvatGameState, createEmptyTeyvatGameState } from '@/models/teyvat/state';
import * as variableFacts from '@/utils/variableFacts';

describe('urgent Lisa identity repair', () => {
  it('trusts Lisa stable identity over a model-generated descriptive label', () => {
    const state = createEmptyTeyvatGameState();
    const result = variableFacts.factsToTeyvatDomainCommands([{
      type: 'npc',
      id: 'npc:lisa',
      name: '关于你那“神奇能力”这个人',
      recentInteraction: '丽莎在图书馆与你正式见面并进行了交谈。',
      evidence: '丽莎在图书馆与你正式见面并进行了交谈。',
    }], state, 2);

    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'push',
      root: 'NPC',
      path: 'records',
      value: expect.objectContaining({ id: 'npc:lisa', 姓名: '丽莎', canonical: true, roleTier: 'companion' }),
    }));
  });

  it('recovers Lisa registration from an explicit face-to-face narrative when the variable model omits her', () => {
    const derive = variableFacts.deriveNarrativeCanonicalNpcFacts;
    expect(derive('丽莎合上手里的魔法书，抬眼看向你：“终于见面了，小可爱。”')).toContainEqual(
      expect.objectContaining({ type: 'npc', id: 'npc:lisa', name: '丽莎' }),
    );
    expect(derive('图书馆的馆藏目录里提到了丽莎整理过的书籍。')).toEqual([]);
  });

  it('repairs the companion name and synchronizes one Lisa phone contact', () => {
    const state = normalizeTeyvatGameState({
      universe: 'teyvat',
      turnCount: 2,
      NPC: [{
        id: 'npc:lisa',
        姓名: '关于你那“神奇能力”这个人',
        roleTier: 'extra',
        lastSeenTurn: 2,
        relationshipLedger: { recentInteraction: '丽莎刚刚与旅行者见面。' },
      }],
      手机: {
        contacts: [{ id: 'npc:lisa', name: '关于你那“神奇能力”这个人', available: true }],
        conversations: [{
          id: 'courier_conv_npc:lisa',
          title: '关于你那“神奇能力”这个人',
          participantIds: ['player', 'npc:lisa'],
          messages: [],
          unread: 0,
          type: 'private',
          typingMemberIds: [],
          updatedAt: 1,
        }],
      },
    });

    expect(state.NPC).toHaveLength(1);
    expect(state.NPC[0]).toMatchObject({ id: 'npc:lisa', 姓名: '丽莎', canonical: true, roleTier: 'companion' });
    expect(state.手机.contacts).toHaveLength(1);
    expect(state.手机.contacts[0]).toMatchObject({ name: '丽莎', npcId: 'npc:lisa', available: true });
    expect(state.手机.conversations[0]!.title).toBe('丽莎');
  });

  it('adds a phone contact as soon as an encountered canonical companion is registered', () => {
    const state = normalizeTeyvatGameState({
      universe: 'teyvat',
      turnCount: 2,
      NPC: [{ id: 'npc:lisa', 姓名: '丽莎', roleTier: 'companion', canonical: true, firstSeenTurn: 2, lastSeenTurn: 2 }],
      手机: { contacts: [], letters: [], conversations: [], deliverySeeds: [], unreadTotal: 0, wallpapers: {} },
    });
    expect(state.手机.contacts).toContainEqual(expect.objectContaining({ name: '丽莎', npcId: 'npc:lisa' }));
  });
});
