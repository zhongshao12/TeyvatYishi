import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import { createBuiltinWorldbooks } from '@/data/worldbookPresets';
import { buildOpeningSystemPrompt, buildSystemPrompt } from '@/hooks/useGame/systemPromptBuilder';
import { migratePromptModules } from '@/hooks/useGameState';
import { 创建空角色 } from '@/models/character';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认游戏设置, 归一化提示词模块ID } from '@/models/settings';
import { 创建空世界状态, type 世界状态 } from '@/models/world';
import type { FilterContext } from '@/utils/worldbook';

const RETIRED_OR_HSR_TERMS = /崩铁|崩坏：星穹铁道|\bHSR\b|星穹列车|黑塔空间站|空间站|星轨|舰队|跃迁|星海|星际旅程|星际文明|舱内|舱门|命途|光锥|旅程天数|无名开拓者|非旅行者|玩家不是旅行者|玩家是自由人|纳努克|克里珀|浮黎|博识尊|阿哈|希佩|万界之癌|水晶棺|<\/?thinking>|prompts\/cot/iu;
const RETIRED_OUTPUT_TAGS = /<\/?(?:正文|短期记忆|动态世界|变量草稿|剧情规划|行动选项|任务更新)>/iu;

const NATIVE_IDS = [
  'builtin_narrative_main',
  'builtin_narrative_opening',
  'builtin_narrative_opening_preset',
  'builtin_narrative_opening_free',
  'builtin_narrative_elemental_echo',
] as const;

const LEGACY_TO_NATIVE_IDS = {
  builtin_main_plot_cot: 'builtin_narrative_main',
  builtin_opening_cot: 'builtin_narrative_opening',
  builtin_preset_opening_cot: 'builtin_narrative_opening_preset',
  builtin_free_opening_cot: 'builtin_narrative_opening_free',
  builtin_path_awakening_cot: 'builtin_narrative_elemental_echo',
  builtin_quest_cot: 'builtin_quest_narrative_rules',
  builtin_quest_output_format: 'builtin_quest_fact_format',
} as const;

function makeWorld(): 世界状态 {
  return {
    ...创建空世界状态(),
    纪年法: '新历',
    旅程天数: 3,
    当前日期: '新历 3 年 04 月 16 日',
    当前时间: '16:20',
    当前地点: '枫丹廷 · 白露巷',
    当前地区: 'fontaine',
    当前天气: '小雨',
    剧情模式: 'normal',
    原著主角: '空荧双主角',
    自定义开局: '洛葵受钟表匠委托，寻找一张被雨水打湿的旧航海图。',
    开局档案: {
      来源: 'free',
      主线启用: true,
      地点来源: 'existing',
      地区ID: 'fontaine',
      地区名称: '枫丹',
      章节锚点ID: 'fontaine_side_clockmaker',
      章节锚点名称: '白露巷的旧航海图',
      章节参考说明: '枫丹廷午后的小雨与钟表匠委托只提供开场背景。',
      参考性质: '背景参考',
      玩家介入原文: '洛葵受钟表匠委托，寻找一张被雨水打湿的旧航海图。',
      整理档案: {
        玩家身份: '来自璃月的民间绘图师',
        初始地点参考: '枫丹廷 · 白露巷',
        起始情境: '小雨让旧航海图上的墨迹开始晕开。',
        当前目标: '在墨迹消失前找到航海图的失主',
        特别要求: ['不要替洛葵补写出身秘密。'],
      },
      防回退规则: ['已成立事实优先，不得无理由回到蒙德默认开场。'],
    },
  };
}

function makeContext(
  scope: FilterContext['currentScope'],
  turnCount: number,
  overrides: Partial<FilterContext> = {},
): FilterContext {
  return {
    recentUserInput: '洛葵请安柏帮忙辨认航海图上的风向记号。',
    recentAIResponse: '',
    worldName: '提瓦特',
    travelerName: '洛葵',
    turnCount,
    currentLocation: '枫丹廷 · 白露巷',
    openingRegionName: '枫丹',
    openingChapterName: '白露巷的旧航海图',
    openingEntryText: '来自璃月的民间绘图师正在寻找航海图失主。',
    openingSource: 'free',
    originalProtagonist: '空荧双主角',
    currentScope: scope,
    storyMode: 'normal',
    ...overrides,
  };
}

function makeFixture() {
  const traveler = {
    ...创建空角色(),
    id: 'traveler-luokui',
    姓名: '洛葵',
    身份: '来自璃月的民间绘图师',
    背景: '靠替商旅绘制沿途地图维生。',
    主元素: 'hydro' as const,
    元素共鸣: [{
      element: 'hydro' as const,
      source: 'traveler_resonance' as const,
      mastery: 72,
      unlocked: true,
      unlockedAt: '枫丹廷 · 白露巷',
      notes: '雨声会唤起她第一次独自远行的记忆。',
    }],
  };
  const settings = 创建默认游戏设置();
  settings.enableInnerVoice = false;
  return { traveler, settings, worldbooks: createBuiltinWorldbooks() };
}

function expectNativeNarrativeContract(prompt: string) {
  expect(prompt).toContain('NarrativeTurn');
  expect(prompt).toContain('自定义旅行者');
  expect(prompt).toMatch(/空.*荧|荧.*空/u);
  expect(prompt).toContain('CanonDeviation');
  expect(prompt).toContain('"body"');
  expect(prompt).toContain('"choices"');
  expect(prompt).toContain('"factCandidates"');
  expect(prompt).toContain('"continuation"');
  expect(prompt).not.toMatch(RETIRED_OR_HSR_TERMS);
  expect(prompt).not.toMatch(RETIRED_OUTPUT_TAGS);
}

describe('native Teyvat narrative prompt contract', () => {
  it('builds a main prompt for the custom traveler with strict NarrativeTurn JSON and canon-deviation precedence', () => {
    const { traveler, settings, worldbooks } = makeFixture();
    const prompt = buildSystemPrompt(
      traveler,
      makeWorld(),
      创建空记忆系统(),
      settings,
      4,
      worldbooks,
      makeContext('main', 4),
    ).systemPrompt;

    expectNativeNarrativeContract(prompt);
    expect(prompt).toMatch(/手写|旅途札记|旅行笔记/u);
    expect(prompt).toMatch(/日式.*西式|和风.*西式|日式西方奇幻/u);
    expect(prompt).toMatch(/具体行动.*后果|行动与后果/u);
    expect(prompt).toContain('安柏');
  });

  it('builds an opening prompt from the selected seed without forcing Mondstadt or inventing identity', () => {
    const { traveler, settings, worldbooks } = makeFixture();
    const prompt = buildOpeningSystemPrompt(
      traveler,
      makeWorld(),
      settings,
      1,
      worldbooks,
      makeContext('opening', 1),
    ).systemPrompt;

    expectNativeNarrativeContract(prompt);
    expect(prompt).toContain('枫丹廷 · 白露巷');
    expect(prompt).toContain('来自璃月的民间绘图师');
    expect(prompt).toContain('在墨迹消失前找到航海图的失主');
    expect(prompt).toMatch(/具体.*行动.*钩子|可立即行动的钩子/u);
    expect(prompt).toMatch(/choices.*(?:有用|有效|后果不同)/u);
  });

  it('builds elemental echo as introspective attunement deepening, never as a direct divine award or audience', () => {
    const { traveler, settings, worldbooks } = makeFixture();
    const world = { ...makeWorld(), 进行中元素回响: 'hydro' as const };
    const prompt = buildSystemPrompt(
      traveler,
      world,
      创建空记忆系统(),
      settings,
      5,
      worldbooks,
      makeContext('elementalEcho', 5),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'judgement',
    ).systemPrompt;

    expectNativeNarrativeContract(prompt);
    expect(prompt).toMatch(/内省|自我理解/u);
    expect(prompt).toContain('共鸣深化');
    expect(prompt).toMatch(/记忆.*感受.*选择.*代价|感受.*记忆.*选择.*代价/u);
    expect(prompt).toMatch(/不得出现.*神明|外部权威.*(?:不|不得).*赐予|不由外部权威.*赐予/u);
    expect(prompt).not.toMatch(/神授|瞥视|注意到|照见|神选者/u);
    expect(prompt).toContain('风、岩、雷、草、水、火、冰');
  });

  it('registers only native narrative IDs and normalizes each historical persisted ID one way', () => {
    const modules = createBuiltinPromptModules();

    for (const [legacyId, nativeId] of Object.entries(LEGACY_TO_NATIVE_IDS)) {
      expect(归一化提示词模块ID(legacyId)).toBe(nativeId);
      expect(modules.filter((module) => module.id === nativeId)).toHaveLength(1);
      expect(modules.some((module) => module.id === legacyId)).toBe(false);
      const nativeModule = modules.find((module) => module.id === nativeId);
      expect(`${nativeModule?.title}\n${nativeModule?.description}`).not.toMatch(/cot|思维链/iu);
    }
    expect(NATIVE_IDS.every((id) => modules.filter((module) => module.id === id).length === 1)).toBe(true);
  });

  it('collapses simultaneous historical and native saved modules to one native module and never re-emits old IDs', () => {
    const defaults = 创建默认游戏设置();
    const nativeIds = new Set<string>(Object.values(LEGACY_TO_NATIVE_IDS));
    const historicalDuplicates = Object.entries(LEGACY_TO_NATIVE_IDS).map(([legacyId, nativeId], index) => ({
      ...defaults.promptModules.find((module) => module.id === nativeId)!,
      id: legacyId,
      enabled: index % 2 === 0,
    }));
    const migrated = migratePromptModules({
      ...defaults,
      promptModules: [...historicalDuplicates, ...defaults.promptModules],
    });

    for (const [legacyId, nativeId] of Object.entries(LEGACY_TO_NATIVE_IDS)) {
      expect(migrated.filter((module) => module.id === nativeId)).toHaveLength(1);
      expect(migrated.some((module) => module.id === legacyId)).toBe(false);
    }
    expect(migrated.filter((module) => nativeIds.has(module.id))).toHaveLength(nativeIds.size);
  });

  it('injects every selectable story mode without HSR semantics or active legacy keyword aliases', () => {
    const { traveler, settings, worldbooks } = makeFixture();
    const storyModes = ['normal', 'harem', 'romance_alt', 'deep_single'] as const;
    const forbiddenAliases = new Set([
      '纳努克', '克里珀', '岚', '药师', '浮黎', '博识尊', '阿哈', 'IX', '希佩',
      '万界之癌', '水晶棺', '登车',
    ]);

    for (const mode of storyModes) {
      const prompt = buildSystemPrompt(
        traveler,
        { ...makeWorld(), 剧情模式: mode },
        创建空记忆系统(),
        settings,
        3,
        worldbooks,
        makeContext('main', 3, { storyMode: mode }),
      ).systemPrompt;
      expect(prompt).toContain('剧情模式·');
      expect(prompt).not.toMatch(RETIRED_OR_HSR_TERMS);
    }

    for (const book of worldbooks) {
      for (const entry of book.entries) {
        expect(entry.content, `${book.id}/${entry.id}`).not.toMatch(RETIRED_OR_HSR_TERMS);
        for (const keyword of entry.keywords) {
          expect(forbiddenAliases.has(keyword), `${book.id}/${entry.id}: ${keyword}`).toBe(false);
        }
      }
    }
  });

  it('has no retired main, opening, or elemental prompt entry files', () => {
    for (const path of [
      'prompts/cot/mainCot.ts',
      'prompts/cot/openingCot.ts',
      'prompts/cot/pathAwakeningCot.ts',
      'prompts/cot/questCot.ts',
      'prompts/cot/questOutputFormat.ts',
    ]) {
      expect(existsSync(resolve(path)), path).toBe(false);
    }
  });
});
