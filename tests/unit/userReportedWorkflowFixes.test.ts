import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import type { NPC记录 } from '@/models/npc';
import {
  addNpcToCourierContacts,
  updateCourierGroupConversation,
} from '@/services/ai/courierService';
import { filterNpcRoster } from '@/components/features/GameSystems/CompanionPanel';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { discardInventoryItem } from '@/utils/inventoryActions';
import {
  deriveNarrativeClockFact,
  factsToTeyvatDomainCommands,
} from '@/utils/variableFacts';
import { collectQuestUpdatePayloads, deriveQuestSettlementPlan } from '@/hooks/useGame/questWorkflow';
import { getMissingPartyMembers } from '@/hooks/useGame/npcPresence';
import { buildCanonicalTravelerPreset } from '@/data/canonicalTravelerPresets';
import { parseSTPresetV2 } from '@/utils/stPresetParser';
import { LUMINE_COMPANION_OPENING_TEXT } from '@/data/openingCompanionScenes';
import { HIDDEN_ALLURE_SYSTEM_NOTE } from '@/data/storyModeWorldbooks';
import { 构建关系图 } from '@/utils/relationshipGraph';
import { buildNewGameOpeningPayload } from '@/components/features/NewGame/NewGameWizard';

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

describe('user reported workflow regressions', () => {
  it('lets a player rename a group and freely add or remove contact members', () => {
    const base = createEmptyCourierSystem();
    const system = {
      ...base,
      contacts: [
        { id: 'amber', name: '安柏', available: true },
        { id: 'kaeya', name: '凯亚', available: true },
        { id: 'lisa', name: '丽莎', available: true },
      ],
      conversations: [{
        id: 'group-1', title: '旧群名', participantIds: ['player', 'amber', 'kaeya'],
        messages: [], unread: 0, type: 'group' as const, typingMemberIds: [], updatedAt: 1,
      }],
    };

    const updated = updateCourierGroupConversation(system, 'group-1', {
      title: '风花节筹备组', memberIds: ['kaeya', 'lisa'],
    });
    expect(updated.conversations[0].title).toBe('风花节筹备组');
    expect(updated.conversations[0].participantIds).toEqual(['player', 'kaeya', 'lisa']);
  });

  it('adds an archived companion to phone contacts once and links the NPC id', () => {
    const amber = npc('npc_amber', '安柏', { 阶位: 'companion', 原著角色: true });
    const first = addNpcToCourierContacts(createEmptyCourierSystem(), amber);
    const second = addNpcToCourierContacts(first, amber);
    expect(second.contacts).toHaveLength(1);
    expect(second.contacts[0]).toMatchObject({ name: '安柏', npcId: 'npc_amber', available: true });
  });

  it('keeps original NPCs as extras while enriching canonical characters only', () => {
    const records = [npc('npc-original', '晨曦酒庄临时搬运工'), npc('npc_amber', '安柏')];
    const result = enrichNpcArchives(records, { nsfwEnabled: false, maleNsfwArchiveEnabled: false });
    expect(result.records[0]).toMatchObject({ 阶位: 'extra', 原著角色: false });
    expect(result.records[1]).toMatchObject({ 阶位: 'companion', 原著角色: true });
  });

  it('filters the companion roster by name, alias, identity, and notes', () => {
    const records = [
      npc('one', '安柏', { 别名: '侦察骑士', 介绍: '西风骑士团成员' }),
      npc('two', '陈老伯', { 备注: ['风车修理匠'] }),
    ];
    expect(filterNpcRoster(records, '侦察')).toEqual([records[0]]);
    expect(filterNpcRoster(records, '修理匠')).toEqual([records[1]]);
  });

  it('records discarded item ids and blocks accidental variable-model resurrection', () => {
    const state = createEmptyTeyvatGameState();
    state.背包 = {
      items: [{ id: 'item-apple', category: 'food', name: '苹果', description: '', quantity: 1, rarity: 1, obtainedAtTurn: 1 }],
      mora: 0,
    };
    const discarded = discardInventoryItem(state.背包, 'item-apple', 1);
    state.背包 = discarded;
    const translated = factsToTeyvatDomainCommands([{
      type: 'item', action: 'gain', category: 'food', name: '苹果', quantity: 1, rarity: 1,
      evidence: '旅行者查看空背包，没有重新获得苹果。',
    }], state, 3);
    expect(discarded.items).toHaveLength(0);
    expect(discarded.discardedItemIds).toContain('item-apple');
    expect(translated.commands).toHaveLength(0);
  });

  it('rejects phantom phone senders that are neither contacts, NPCs, nor canonical characters', () => {
    const state = createEmptyTeyvatGameState();
    const translated = factsToTeyvatDomainCommands([{
      type: 'courier_seed', targetType: 'private', targetId: '单独', targetName: '图书馆',
      title: '图书馆的单独邀约', context: '一条没有人物发送者的邀约。', relatedNpcIds: [],
    }], state, 2, { courierSeedsEnabled: true, maxCourierSeedsPerTurn: 2 });
    expect(translated.commands).toHaveLength(0);
    expect(translated.warnings.join('\n')).toContain('不是有效联系人');
  });

  it('preserves tagged quest updates and derives an explicit narrative clock', () => {
    expect(collectQuestUpdatePayloads({
      factCandidates: [{ domain: 'quest', fact: '目标: 城外侦察|交谈|向安柏汇报|1|安柏', evidence: '向安柏汇报' }],
      questUpdates: ['接取: 城外侦察|调查丘丘人踪迹|支线'],
    })).toEqual([
      '接取: 城外侦察|调查丘丘人踪迹|支线',
      '目标: 城外侦察|交谈|向安柏汇报|1|安柏',
    ]);
    expect(deriveNarrativeClockFact('此时已经是晚上八点，酒馆的灯火亮了起来。', '10:00')).toMatchObject({
      type: 'time', mode: 'set_time', targetTime: '20:00',
    });
  });

  it('creates an active quest when the model reports an objective before an explicit accept event', () => {
    const state = createEmptyTeyvatGameState();
    const plan = deriveQuestSettlementPlan({
      state,
      enabled: true,
      questUpdates: ['目标: 城外侦察|交谈|向安柏汇报|1|安柏'],
      body: '安柏请旅行者调查后回来汇报。',
      variableFacts: [],
      factCandidates: [],
      turn: 7,
    });
    expect(plan.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'push', root: '任务', path: 'active' }),
    ]));
    expect(plan.updates).toContain('接取任务：城外侦察');
  });

  it('maps female NSFW archive facts into the native mature archive', () => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{
      id: 'npc_adult', 姓名: '成年原创角色', roleTier: 'companion', gender: '女',
      matureArchive: { enabled: true, ageConfirmation: 'adult' },
    }]);
    const translated = factsToTeyvatDomainCommands([{
      type: 'nsfw_archive', npcName: '成年原创角色', enabled: true, ageConfirm: 'adult',
      femaleBodyArchive: { 体态: '对话后确认的当前身体状态' },
      experiences: ['本回合已经发生的成人亲密互动'], evidence: '正文明确记录了相关变化。',
    }], state, 4);
    const command = translated.commands.find((item) => item.root === 'NPC' && item.path.includes('matureArchive'));
    expect(command?.value).toMatchObject({
      femaleBodyProfile: { build: '对话后确认的当前身体状态' },
      experiences: ['本回合已经发生的成人亲密互动'],
    });
  });

  it('requires every traveling companion to be represented in the generated body', () => {
    const party = [
      npc('amber', '安柏', { 阶位: 'companion', 同行: true }),
      npc('kaeya', '凯亚', { 阶位: 'companion', 同行: true }),
    ];
    expect(getMissingPartyMembers('安柏举起弓，示意继续前进。', party)).toEqual(['凯亚']);
    expect(getMissingPartyMembers('安柏举起弓，凯亚随后关上营地木门。', party)).toEqual([]);
  });

  it('contains group management and mandatory latest-message scrolling hooks in both chat surfaces', () => {
    const courier = readFileSync(resolve(process.cwd(), 'components/features/Courier/CourierModal.tsx'), 'utf8');
    const companion = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/CompanionPanel.tsx'), 'utf8');
    const chat = readFileSync(resolve(process.cwd(), 'components/features/Chat/ChatList.tsx'), 'utf8');
    expect(courier).toContain('aria-label="群聊设置"');
    expect(courier).toContain('data-testid="phone-message-bottom"');
    expect(companion).toContain('aria-label="搜索同伴"');
    expect(companion).toContain('添加到手机联系人');
    expect(chat).toContain('data-testid="main-chat-bottom"');
    expect(chat).toContain('forceLatestMessage');
  });

  it('unwraps common Tavern export envelopes and keeps the imported preset active at runtime', () => {
    const nestedPreset = {
      prompts: [{ identifier: 'main', role: 'system', content: '只用这套酒馆文风。' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    };
    for (const wrapped of [{ preset: nestedPreset }, { data: nestedPreset }, { settings: nestedPreset }, { data: { settings: { preset: nestedPreset } } }]) {
      const result = parseSTPresetV2(JSON.stringify(wrapped));
      expect(result.preset?.prompts[0].content).toBe('只用这套酒馆文风。');
    }
  });

  it('builds editable canon Traveler presets with seven resonance records but only Mondstadt Anemo unlocked', () => {
    for (const choice of ['空', '荧'] as const) {
      const preset = buildCanonicalTravelerPreset(choice);
      expect(preset.元素共鸣.map((item) => item.element)).toEqual([
        'anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo',
      ]);
      expect(preset.元素共鸣.filter((item) => item.unlocked).map((item) => item.element)).toEqual(['anemo']);
      expect(preset.天赋).toHaveLength(3);
      expect(preset.天赋.map((item) => item.名称)).toEqual(expect.arrayContaining(['异邦铁风', '风涡剑', '风息激荡']));
    }
  });

  it('ships the requested harem constitution note and Lumine companion opening scene', () => {
    expect(HIDDEN_ALLURE_SYSTEM_NOTE).toContain('天相隐魅体 (Hidden Allure)');
    expect(HIDDEN_ALLURE_SYSTEM_NOTE).toContain('性格绝对留存（核心原则）');
    expect(HIDDEN_ALLURE_SYSTEM_NOTE).toContain('情感与行为的递进（拒绝一步到位）');
    expect(LUMINE_COMPANION_OPENING_TEXT).toContain('后脑勺传来阵阵撕裂般的剧痛');
    expect(LUMINE_COMPANION_OPENING_TEXT).toContain('旅行者——荧');
    expect(LUMINE_COMPANION_OPENING_TEXT).toContain('天相隐魅体的微妙磁场');
    const opening = buildNewGameOpeningPayload({
      presetId: 'official_mondstadt_dragon',
      name: '自定义旅者',
      element: 'anemo',
      canonicalTraveler: '荧',
      storyMode: 'harem',
      talents: [],
    });
    expect(opening.world.开局档案?.玩家介入原文).toBe(LUMINE_COMPANION_OPENING_TEXT);
    expect(opening.world.原著主角).toBe('荧');
    expect(opening.world.剧情模式).toBe('harem');
  });

  it('renders explicit protagonist relationship labels and safe text layers in map and album', () => {
    const graph = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/RelationshipGraphPanel.tsx'), 'utf8');
    const phone = readFileSync(resolve(process.cwd(), 'components/features/Courier/CourierModal.tsx'), 'utf8');
    const map = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/MapPanel.tsx'), 'utf8');
    const album = readFileSync(resolve(process.cwd(), 'components/features/GameSystems/AlbumPanel.tsx'), 'utf8');
    expect(graph).toContain('node.relationLabel');
    expect(graph).toContain('node.affinity');
    expect(graph).toContain('主角关系');
    expect(phone).toContain('event.nativeEvent.isComposing');
    expect(phone).toContain('Enter 发送');
    expect(map).toContain('data-testid="map-card-content"');
    expect(album).toContain('data-testid="album-content-layer"');
    expect(构建关系图([npc('amber', '安柏', { 好感度: 35, 关系: 'acquaintance' })]).nodes[0].relationLabel).toBe('熟识');
  });
});
