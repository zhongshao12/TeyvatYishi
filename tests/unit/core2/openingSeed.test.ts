import { expect, it } from 'vitest';
import { createCoreOpeningSeed } from '@/core/view/openingSeed';
import { validateCoreDto } from '@/core/contracts/validation';
import { assembleCore2MainPrompt } from '@/core/settlement/mainPrompt';
import { 创建默认游戏设置 } from '@/models/settings';

it('creates independent same-name journeys with complete empty gameplay baselines and only the chosen companion', () => {
  const input = { name: '云', travelerPreset: 'custom' as const, canonicalCompanion: '荧' as const, openingPresetId: 'official_mondstadt_dragon' as const };
  const first = createCoreOpeningSeed(input), second = createCoreOpeningSeed(input);
  expect(validateCoreDto('seed', first).ok).toBe(true);
  expect(first.head.scope.journeyId).not.toBe(second.head.scope.journeyId); expect(first.playerId).not.toBe(second.playerId);
  expect(first.records.filter(row => row.domain === 'npc').map(row => row.value.姓名)).toEqual(['荧']);
  expect(first.records.flatMap(row => row.domain === 'courier' && row.value.kind === 'contact' ? [row.value.npcId] : [])).toEqual([first.records.find(row => row.domain === 'npc')!.entityId]);
  expect(first.records.some(row => row.domain === 'doudizhu' && row.value.currentGame === null)).toBe(true);
  expect(first.records.some(row => row.domain === 'map' && row.value.visited)).toBe(true);
  expect(first.records.filter(row => row.domain === 'album' || row.domain === 'news')).toEqual([]);
  expect(first.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: 0, moment: { turn: 0, travelDay: 1 }, opening: { storyMode: 'normal' } } });
  expect(input).toEqual({ name: '云', travelerPreset: 'custom', canonicalCompanion: '荧', openingPresetId: 'official_mondstadt_dragon' });
});
it('keeps a canon traveler editable, forces Mondstadt, and grants only awakened elemental talents', () => {
  const seed = createCoreOpeningSeed({ name: '自定义姓名', travelerPreset: '荧', openingPresetId: 'official_natlan_war', profile: { 外貌: '玩家亲自改写的外貌', 性格: '温柔而坚定' } });
  const player = seed.records.find(row => row.domain === 'traveler'); if (player?.domain !== 'traveler') throw Error('fixture');
  expect(player.value).toMatchObject({ 姓名: '自定义姓名', 外貌: '玩家亲自改写的外貌', 性格: '温柔而坚定', 主元素: 'anemo' });
  expect(player.value.元素共鸣.filter(row => row.unlocked).map(row => row.element)).toEqual(['anemo']);
  expect(player.value.天赋.every(talent => talent.关联元素 === 'anemo')).toBe(true);
  expect(seed.records.find(row => row.domain === 'world')).toMatchObject({ value: { region: 'mondstadt' } });
  expect(() => createCoreOpeningSeed({ name: '荧', travelerPreset: '荧', canonicalCompanion: '荧', openingPresetId: 'official_mondstadt_dragon' })).toThrow('不能与本人重复');
});
it('supports a custom elemental profile and the six opening resources without inventing past rewards or special body traits', () => {
  const seed = createCoreOpeningSeed({ name: '旅人', travelerPreset: 'custom', initialElement: 'hydro', openingPresetId: 'official_sumeru_dream', storyMode: 'harem' });
  expect(seed.records.find(row => row.domain === 'world')).toMatchObject({ value: { region: 'sumeru', opening: { storyMode: 'harem' } } });
  const player = seed.records.find(row => row.domain === 'traveler'); if (player?.domain !== 'traveler') throw Error('fixture');
  expect(player.value.元素共鸣.map(row => row.element)).toEqual(['hydro']);
  expect(player.value.天赋.every(talent => talent.关联元素 === 'hydro')).toBe(true);
  expect(seed.records.filter(row => row.domain === 'inventory').map(row => row.value)).toEqual([{ kind: 'wallet', mora: 0 }]);
  expect(JSON.stringify(seed)).not.toMatch(/天相隐魅体|Hidden Allure/u);
  expect(() => createCoreOpeningSeed({ name: '', travelerPreset: 'custom', openingPresetId: 'official_mondstadt_dragon' })).toThrow();
});
it('delivers edited traveler background and personality to the actual author prompt, without treating them as NPC memories', () => {
  const seed = createCoreOpeningSeed({ name: '旅人', travelerPreset: '荧', openingPresetId: 'official_mondstadt_dragon', profile: { 背景: '玩家校正的异乡经历', 性格: '玩家校正的沉稳性格', 性别: '女', 年龄: 25 } });
  const prompt = assembleCore2MainPrompt({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, userInput: '开始', history: [], commitments: [] }, 创建默认游戏设置());
  expect(prompt.systemPrompt).toContain('玩家校正的异乡经历'); expect(prompt.systemPrompt).toContain('玩家校正的沉稳性格');
});
