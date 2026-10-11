import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchCanonical } from '@/data/canonicalCharacters';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { 归一化NPC记录列表, 读取NPC头像 } from '@/models/npc';
import { normalizeTeyvatGameState } from '@/models/teyvat/state';
import { reconcileNabuMalikataSaveIdentity } from '@/utils/nabuMalikataIdentity';

const avatar = '/assets/teyvat-avatars/characters/%E8%8A%B1%E7%A5%9E.webp';

describe('花神 is the alias of 娜布·玛莉卡塔', () => {
  it.each(['娜布·玛莉卡塔', '花神', '娜布玛莉卡塔', 'Nabu Malikata', 'Goddess of Flowers'])('resolves %s to one canon identity and existing portrait', (name) => {
    expect(matchCanonical(name)?.name).toBe('娜布·玛莉卡塔');
    expect(getDefaultBuiltinAvatar(name)).toBe(avatar);
  });

  it('merges legacy records without dropping either shared memory', () => {
    const records = 归一化NPC记录列表([
      { id: 'npc_nabu', 姓名: '娜布·玛莉卡塔', 好感度: 90, 最近回合: 5, 同行记忆: [{ id: 'a', 回合: 2, 摘要: '一起走过花园', 关联NPCID: [] }] },
      { id: 'npc_flowers', 姓名: '花神', 好感度: 100, 最近回合: 6, 同行记忆: [{ id: 'b', 回合: 3, 摘要: '谈论绿洲', 关联NPCID: [] }] },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]?.姓名).toBe('娜布·玛莉卡塔');
    expect(records[0]?.别名).toContain('花神');
    expect(records[0]?.同行记忆?.map(memory => memory.摘要)).toEqual(expect.arrayContaining(['一起走过花园', '谈论绿洲']));
    expect(读取NPC头像(records[0], '手机')).toBe(avatar);
  });

  it('repairs a native save roster, phone contacts and cross-NPC references idempotently', () => {
    const state = normalizeTeyvatGameState({ universe: 'teyvat', turnCount: 6,
      NPC: [
        { id: 'npc_nabu', 姓名: '娜布·玛莉卡塔', affinity: 90, lastSeenTurn: 5, notes: ['花园'], sharedMemories: [{ id: 'a', turn: 2, summary: '一起走过花园' }] },
        { id: 'npc_flowers', 姓名: '花神', affinity: 100, lastSeenTurn: 6, notes: ['绿洲'], sharedMemories: [{ id: 'b', turn: 3, summary: '谈论绿洲' }] },
        { id: 'npc_other', 姓名: '原创旅人', sharedMemories: [{ id: 'c', summary: '收到花神的问候', relatedNpcIds: ['npc_flowers'] }] },
      ],
      手机: { contacts: [
        { id: 'contact_nabu', npcId: 'npc_nabu', name: '娜布·玛莉卡塔', available: true },
        { id: 'contact_flowers', npcId: 'npc_flowers', name: '花神', available: true },
      ], conversations: [{ id: 'flowers_chat', type: 'private', title: '花神', participantIds: ['player', 'contact_flowers'], messages: [
        { id: 'message1', senderId: 'contact_flowers', senderName: '花神', content: '你好', turn: 5, timestamp: 1 },
      ] }] },
    });
    const nabu = state.NPC.filter(npc => npc.姓名 === '娜布·玛莉卡塔');
    expect(nabu).toHaveLength(1);
    expect(nabu[0]?.id).toBe('npc_nabu');
    expect(nabu[0]?.affinity).toBe(100);
    expect(nabu[0]?.sharedMemories.map(memory => memory.summary)).toEqual(['一起走过花园', '谈论绿洲']);
    expect(nabu[0]?.notes).toEqual(['花园', '绿洲']);
    expect(state.NPC.find(npc => npc.id === 'npc_other')?.sharedMemories[0]?.relatedNpcIds).toEqual(['npc_nabu']);
    expect(state.手机.contacts).toHaveLength(1);
    expect(state.手机.contacts[0]).toMatchObject({ name: '娜布·玛莉卡塔', npcId: 'npc_nabu', avatar });
    expect(state.手机.conversations[0]?.messages[0]).toMatchObject({ content: '你好', senderId: 'contact_nabu', senderName: '娜布·玛莉卡塔', avatar });
    expect(normalizeTeyvatGameState(state)).toEqual(state);
  });

  it('never treats a festival title or an unrelated name as the goddess', () => {
    expect(matchCanonical('花神诞祭')).toBeNull();
    expect(matchCanonical('花神信徒')).toBeNull();
    expect(matchCanonical('玛莉')).toBeNull();
  });

  it('repairs snapshot rosters, album references and phone mentions without rewriting message text', () => {
    const input = {
      NPC: [{ id: 'npc_nabu', 姓名: '娜布·玛莉卡塔' }, { id: 'npc_flowers', 姓名: '花神' }],
      相册: { images: [{ referenceTargets: ['npc_flowers', 'traveler'], prompt: 'npc_flowers' }] },
      对话: { messages: [{ content: '花神与 npc_flowers', preTurnState: {
        npc: [{ id: 'npc_flowers', 姓名: '花神', affinity: 20 }, { id: 'npc_nabu', 姓名: '娜布·玛莉卡塔', affinity: 30 }],
        courier: { contacts: [{ npcId: 'npc_flowers' }] },
      } }] },
      手机: { moments: [{ mentionIds: ['npc_flowers'] }], conversations: [{ participantIds: ['player', 'npc_flowers'] }] },
    };
    const repaired = reconcileNabuMalikataSaveIdentity(input) as typeof input;
    expect(repaired.相册.images[0]?.referenceTargets).toEqual(['npc_nabu', 'traveler']);
    expect(repaired.相册.images[0]?.prompt).toBe('npc_flowers');
    expect(repaired.对话.messages[0]?.content).toBe('花神与 npc_flowers');
    expect(repaired.对话.messages[0]?.preTurnState.npc).toHaveLength(1);
    expect(repaired.对话.messages[0]?.preTurnState.npc[0]?.id).toBe('npc_nabu');
    expect(repaired.对话.messages[0]?.preTurnState.courier.contacts[0]?.npcId).toBe('npc_nabu');
    expect(repaired.手机.moments[0]?.mentionIds).toEqual(['npc_nabu']);
    expect(repaired.手机.conversations[0]?.participantIds).toEqual(['player', 'npc_nabu']);
    expect(input.NPC).toHaveLength(2);
  });

  it('reuses the valid small WebP asset instead of creating duplicate image files', () => {
    const path = `public${decodeURIComponent(avatar)}`;
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    expect(bytes.length).toBeLessThan(20 * 1024);
  });

  it('keeps phone contact IDs distinct from NPC IDs even when their strings coincide', () => {
    const state = normalizeTeyvatGameState({ NPC: [{ id: 'npc_nabu', 姓名: '娜布·玛莉卡塔' }, { id: 'npc_flowers', 姓名: '花神' }],
      手机: { contacts: [{ id: 'npc_flowers', npcId: 'npc_flowers', name: '花神' }], conversations: [{ id: 'chat', type: 'private',
        participantIds: ['player', 'npc_flowers'], messages: [{ id: 'm', senderId: 'npc_flowers', senderName: '花神', content: '你好' }] }] },
    });
    expect(state.手机.contacts[0]).toMatchObject({ id: 'npc_flowers', npcId: 'npc_nabu' });
    expect(state.手机.conversations[0]?.messages[0]).toMatchObject({ senderId: 'npc_flowers', senderName: '娜布·玛莉卡塔', avatar });
    expect(state.手机.conversations[0]?.participantIds).toContain('npc_flowers');
  });

  it('repairs alias-only historical checkpoints after the live roster has already merged', () => {
    const input = { NPC: [{ id: 'npc_nabu', 姓名: '娜布·玛莉卡塔', affinity: 100 }],
      checkpoint: { npc: [{ id: 'npc_flowers', 姓名: '花神', affinity: 20 },
        { id: 'npc_other', 姓名: '路人', sharedMemories: [{ relatedNpcIds: ['npc_flowers'] }] }] },
    };
    const repaired = reconcileNabuMalikataSaveIdentity(input) as typeof input;
    expect(repaired.checkpoint.npc[0]).toMatchObject({ id: 'npc_nabu', affinity: 20 });
    expect(repaired.checkpoint.npc[1]?.sharedMemories?.[0]?.relatedNpcIds).toEqual(['npc_nabu']);
    expect(reconcileNabuMalikataSaveIdentity(repaired)).toEqual(repaired);
  });

  it('does not absorb an explicitly original same-name character into the goddess', () => {
    const original = { id: 'custom_baker', 姓名: '花神', canonical: false, 身份: '原创面包师' };
    const repaired = reconcileNabuMalikataSaveIdentity({ NPC: [{ id: 'npc_nabu', 姓名: '娜布·玛莉卡塔' },
      { id: 'npc_flowers', 姓名: '花神' }, original] }) as { NPC: unknown[] };
    expect(repaired.NPC).toHaveLength(2);
    expect(repaired.NPC[1]).toEqual(original);
    const state = normalizeTeyvatGameState({ NPC: [{ id: 'npc_nabu', 姓名: '娜布·玛莉卡塔' },
      { id: 'npc_flowers', 姓名: '花神' }, original] });
    expect(state.NPC.map(npc => npc.id)).toEqual(['npc_nabu', 'custom_baker']);
    expect(normalizeTeyvatGameState(state).NPC).toEqual(state.NPC);
  });
});
