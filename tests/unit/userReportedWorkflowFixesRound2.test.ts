import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCanonicalTravelerPreset } from '@/data/canonicalTravelerPresets';
import { buildNewGameOpeningPayload } from '@/components/features/NewGame/NewGameWizard';
import { resolveCourierMessageTurn } from '@/components/features/Courier/CourierModal';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import type { NPC记录 } from '@/models/npc';
import {
  addNpcToCourierContacts,
  appendPhoneExchangeMemory,
  canAddNpcToCourierContacts,
  selectGroupReplyMembers,
} from '@/services/ai/courierService';
import { runSteambirdGenerationStep } from '@/hooks/useGame/steambirdWorkflow';
import {
  deriveNarrativeClockFact,
  derivePartyPresenceFacts,
  factsToTeyvatDomainCommands,
} from '@/utils/variableFacts';

const npc = (id: string, name: string, patch: Partial<NPC记录> = {}): NPC记录 => ({
  id,
  姓名: name,
  阶位: 'extra',
  好感度: 0,
  关系: 'stranger',
  同行: false,
  初见回合: 1,
  最近回合: 1,
  备注: [],
  ...patch,
});

describe('second user-reported UX regression batch', () => {
  it('rewards each current party companion by ten affinity when a new day begins', () => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([
      { id: 'npc_amber', 姓名: '安柏', travelingTogether: true, affinity: 10 },
      { id: 'npc_lisa', 姓名: '丽莎', travelingTogether: false, affinity: 10 },
    ]);
    const result = factsToTeyvatDomainCommands([
      { type: 'time', mode: 'next_day', targetTime: '08:00', evidence: '第二天早晨，众人再次出发。' },
    ], state, 3);
    expect(result.commands).toContainEqual(expect.objectContaining({ root: 'NPC', path: '[id=npc_amber].affinity', action: 'add', value: 10 }));
    expect(result.commands).not.toContainEqual(expect.objectContaining({ path: '[id=npc_lisa].affinity' }));
  });

  it('derives explicit party departure facts from the settled narrative', () => {
    const party = [npc('npc_amber', '安柏', { 同行: true })];
    expect(derivePartyPresenceFacts('安柏在城门前挥手告别，正式离开了队伍。', party)).toContainEqual(
      expect.objectContaining({ type: 'npc', name: '安柏', following: false }),
    );
  });

  it('records phone exchanges in both memory and affinity', () => {
    const before = [npc('npc_amber', '安柏', { 好感度: 8 })];
    const after = appendPhoneExchangeMemory(before, {
      npcId: 'npc_amber', conversationId: 'private_amber', exchangeId: 'exchange_4', playerText: '谢谢你一直关心我。',
      replyTexts: ['不用客气！我们明天也一起巡逻吧。'], turn: 4,
    });
    expect(after[0]!.好感度).toBeGreaterThan(8);
    expect(after[0]!.同行记忆?.length).toBeGreaterThan(0);
  });

  it('only lets genuinely connected NPCs become manual contacts', () => {
    const stranger = npc('stranger', '陌生路人');
    const companion = npc('amber', '安柏', { 阶位: 'companion', 同行: true });
    expect(canAddNpcToCourierContacts(stranger)).toBe(false);
    expect(canAddNpcToCourierContacts(companion)).toBe(true);
    expect(addNpcToCourierContacts(createEmptyCourierSystem(), stranger).contacts).toHaveLength(0);
  });

  it('deduplicates same-name contacts and remaps conversation participants', () => {
    const normalized = normalizeCourierSystem({
      contacts: [
        { id: 'amber-a', npcId: 'npc_amber', name: ' 安柏 ', available: true },
        { id: 'amber-b', name: '安柏', avatar: '/amber.webp', available: true },
      ],
      conversations: [{ id: 'g', title: '群聊', type: 'group', participantIds: ['player', 'amber-a', 'amber-b'], messages: [], unread: 0, typingMemberIds: [], updatedAt: 1 }],
    });
    expect(normalized.contacts).toHaveLength(1);
    expect(normalized.contacts[0]!.avatar).toBe('/amber.webp');
    expect(normalized.conversations[0]!.participantIds).toEqual(['player', normalized.contacts[0]!.id]);
  });

  it('keeps every explicit group @mention and adds two unmentioned participants', () => {
    const conversation = { id: 'g', participantIds: ['player', 'amber', 'lisa', 'kaeya', 'barbara'] };
    const contacts = [
      { id: 'amber', name: '安柏', available: true },
      { id: 'lisa', name: '丽莎', available: true },
      { id: 'kaeya', name: '凯亚', available: true },
      { id: 'barbara', name: '芭芭拉', available: true },
    ];
    const result = selectGroupReplyMembers(conversation, { id: 'm', senderId: 'player', senderName: '旅行者', role: 'user', content: '@安柏 ＠丽莎 你们怎么看？', turn: 2, timestamp: 2, readBy: [] }, 2, contacts);
    expect(result.slice(0, 2)).toEqual(['amber', 'lisa']);
    expect(new Set(result.slice(2))).toEqual(new Set(['kaeya', 'barbara']));
  });

  it('treats @全体成员 as an explicit all-member reply even when names are also mentioned', () => {
    const conversation = { id: 'g', participantIds: ['player', 'amber', 'lisa', 'kaeya', 'barbara'] };
    const contacts = [
      { id: 'amber', name: '安柏', available: true },
      { id: 'lisa', name: '丽莎', available: true },
      { id: 'kaeya', name: '凯亚', available: true },
      { id: 'barbara', name: '芭芭拉', available: true },
    ];
    const result = selectGroupReplyMembers(conversation, {
      id: 'm-all', senderId: 'player', senderName: '旅行者', role: 'user',
      content: '@全体成员 @安柏 今晚一起开会。', turn: 2, timestamp: 2, readBy: [],
    }, 2, contacts);

    expect(new Set(result)).toEqual(new Set(['amber', 'lisa', 'kaeya', 'barbara']));
  });

  it('starts a phone message in the current main-story turn', () => {
    expect(resolveCourierMessageTurn(7, [{ turn: 2 }, { turn: 4 }])).toBe(7);
    expect(resolveCourierMessageTurn(3, [{ turn: 5 }])).toBe(5);
  });

  it('starts canon Traveler presets in Mondstadt with Anemo talents only', () => {
    const preset = buildCanonicalTravelerPreset('荧');
    expect(preset.元素共鸣.filter((item) => item.unlocked).map((item) => item.element)).toEqual(['anemo']);
    expect(preset.天赋).toHaveLength(3);
    const payload = buildNewGameOpeningPayload({
      presetId: 'official_liyue_ritual', name: '荧', element: 'anemo', elements: ['anemo'],
      canonicalPresetChoice: '荧', canonicalTraveler: '无主角', storyMode: 'harem', talents: preset.天赋,
    });
    expect(payload.world.起航之地ID).toBe('official_mondstadt_dragon');
    expect(payload.traveler.能力.join('\n')).not.toContain('天相隐魅体');
    expect(payload.traveler.能力.join('\n')).not.toContain('Hidden Allure');
  });

  it('summarizes rather than republishes the raw Steambird source text', () => {
    const raw = '骑士团在清泉镇发布了很长的公告。'.repeat(30);
    const result = runSteambirdGenerationStep({ current: { articles: [] }, publicFacts: [{ title: '骑士团公告', detail: raw }], turnCount: 2, now: 2 });
    expect(result?.steambird.articles[0]!.body.length).toBeLessThanOrEqual(180);
    expect(result?.steambird.articles[0]!.body).not.toBe(raw);
  });

  it('understands next-day and numeric narrative clocks', () => {
    expect(deriveNarrativeClockFact('第二天清晨六点，众人重新上路。', '20:00')).toMatchObject({ mode: 'next_day', targetTime: '06:00' });
    expect(deriveNarrativeClockFact('钟楼显示现在是 21:35。', '10:00')).toMatchObject({ mode: 'set_time', targetTime: '21:35' });
  });

  it('auto-registers a named NPC before writing a mature archive', () => {
    const state = createEmptyTeyvatGameState();
    const result = factsToTeyvatDomainCommands([{
      type: 'nsfw_archive', npcName: '丽莎', enabled: true, ageConfirm: 'adult',
      femaleBodyArchive: { 体态: '已记录的成年身体状态' }, evidence: '正文明确发生并记录了变化。',
    }], state, 2);
    expect(result.warnings.join('\n')).not.toContain('找不到 NPC 丽莎');
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'push', root: 'NPC', path: 'records' }),
      expect.objectContaining({ action: 'set', root: 'NPC', path: expect.stringContaining('matureArchive') }),
    ]));
  });

  it('contains the required visual alignment and legibility hooks', () => {
    const message = readFileSync(resolve(process.cwd(), 'components/features/Chat/MessageRenderers.tsx'), 'utf8');
    const courier = [
      'components/features/Courier/CourierModal.tsx',
      'components/features/Courier/CourierMessageTimeline.tsx',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');
    const inventory = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/InventoryPanel.tsx'), 'utf8');
    const album = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/album/workspaces.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');
    expect(message).toContain('data-testid="dialogue-speaker-name"');
    expect(courier).toContain('data-testid="phone-turn-divider"');
    expect(courier).toContain("data-testid={isPlayer ? 'phone-player-message-row'");
    expect(inventory).toContain('data-testid="inventory-item-cell"');
    expect(inventory).not.toContain('rgba(20, 16, 22, 0.62)');
    expect(album).toContain('data-testid="album-studio-status"');
    expect(app).toContain('currentTurn={state.game.turnCount}');
  });

  it('places an execution bridge after imported Tavern preset content', () => {
    const source = readFileSync(resolve(process.cwd(), 'hooks/useGame/tavernMessageChainBuilder.ts'), 'utf8');
    expect(source).toContain('# 酒馆预设执行要求');
  });

  it('talent generation uses a raw completion instead of NarrativeTurn parsing', () => {
    const source = readFileSync(resolve(process.cwd(), 'services/ai/skillGenerator.ts'), 'utf8');
    expect(source).not.toContain("from './text'");
    expect(source).toContain('chatCompletionNonStream');
  });
});
