import { describe, expect, it } from 'vitest';
import { 创建默认游戏设置, type 游戏设置 } from '@/models/settings';
import { 创建空角色 } from '@/models/character';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建空世界状态 } from '@/models/world';
import { buildSystemPrompt, selectMainPromptModules } from '@/hooks/useGame/systemPromptBuilder';
import { buildTavernMessageChain } from '@/hooks/useGame/tavernMessageChainBuilder';
import { collectMacroAssignments, createMacroContext, processMacros } from '@/utils/macroEngine';
import type { 提示词模块 } from '@/models/prompts';
import type { STPreset } from '@/models/stTypes';

/**
 * 「让玩家的酒馆预设真正生效，并且不被别的强消息压过」（2026-10-03 用户要求）。
 *
 * 本轮定位到的三处：
 *   A 非标准宏 `{{getver::}}`（部分中文预设的写法）不展开，字面量直接进请求；
 *   B 「只定义变量」的模块展开为空、不产生消息（与 ST 一致），但消费方若排在定义之前会读到空值；
 *   C 预设激活时，应用内置的**表现类**模块（文风/思维链/格式/人格/越狱/开发模式）仍在主请求里
 *     与预设争抢同一件事 —— 玩家感受到的就是「预设被别的强消息压过」。
 */

function 模块(overrides: Partial<提示词模块> & { id: string; title: string }): 提示词模块 {
  return {
    kind: 'custom',
    category: 'custom',
    scope: ['main'],
    role: 'system',
    enabled: true,
    order: 1,
    content: '内容-占位',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as 提示词模块;
}

describe('A 非标准宏 getver', () => {
  it('{{getver::name}} 与 {{getvar::name}} 同义展开，不再留字面量', () => {
    const ctx = createMacroContext();
    const out = processMacros('{{setvar::人格::砂糖}}正文：{{getver::人格}}/{{getvar::人格}}', ctx);
    expect(out).toBe('正文：砂糖/砂糖');
    expect(out.includes('{{')).toBe(false);
  });
});

describe('B 变量定义与消费顺序解耦', () => {
  it('消费方排在定义之前时也能读到值（预扫描赋值）', () => {
    const ctx = createMacroContext();
    // 先模拟链构建前的预扫描：把所有模块的赋值按顺序跑一遍
    collectMacroAssignments(['{{setvar::字数要求::至少3000}}', ''], ctx);
    // 再渲染「排在前面」的消费方
    const consumer = processMacros('字数要求是 {{getvar::字数要求}}。', ctx);
    expect(consumer).toBe('字数要求是 至少3000。');
  });

  it('消息链：定义型模块不产生消息，但它的变量对后续模块可见', () => {
    const preset = {
      prompts: [
        { identifier: '定义', name: '定义', content: '{{setvar::人格::砂糖}}', role: 'system' },
        { identifier: '消费', name: '消费', content: '你是{{getvar::人格}}。', role: 'system' },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: '定义', enabled: true }, { identifier: '消费', enabled: true }] }],
    } as unknown as STPreset;
    const chain = buildTavernMessageChain({
      settings: { ...创建默认游戏设置(), enableStPreset: true } as 游戏设置,
      preset,
      characterId: 100001,
      chatHistory: [],
      latestUserInput: '开始。',
      playerName: '旅行者',
      playerRole: {} as never,
      triggerType: 'normal',
    } as never);
    const joined = chain.map((message) => message.content ?? '').join('\n');
    expect(joined).toContain('你是砂糖。');
    expect(joined).not.toContain('setvar');
  });

  it('定义排在消费之后时同样生效（顺序无关）', () => {
    const preset = {
      prompts: [
        { identifier: '消费', name: '消费', content: '你是{{getver::人格}}。', role: 'system' },
        { identifier: '定义', name: '定义', content: '{{setvar::人格::砂糖}}', role: 'system' },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: '消费', enabled: true }, { identifier: '定义', enabled: true }] }],
    } as unknown as STPreset;
    const chain = buildTavernMessageChain({
      settings: { ...创建默认游戏设置(), enableStPreset: true } as 游戏设置,
      preset,
      characterId: 100001,
      chatHistory: [],
      latestUserInput: '开始。',
      playerName: '旅行者',
      playerRole: {} as never,
      triggerType: 'normal',
    } as never);
    const joined = chain.map((message) => message.content ?? '').join('\n');
    expect(joined).toContain('你是砂糖。');
  });
});

describe('C 预设优先：表现类模块让位', () => {
  const modules: 提示词模块[] = [
    模块({ id: 'custom_style_a', title: '文风A', category: 'style' }),
    模块({ id: 'custom_cot_b', title: '思维链B', category: 'cot' }),
    模块({ id: 'custom_format_c', title: '格式C', category: 'format' }),
    模块({ id: 'custom_persona_d', title: '人格D', category: 'persona' }),
    模块({ id: 'custom_jailbreak_e', title: '越狱E', category: 'jailbreak' }),
    模块({ id: 'custom_devmode_f', title: '开发模式F', category: 'devmode' }),
    模块({ id: 'custom_game_g', title: '游戏契约G', category: 'custom' }),
    模块({ id: 'builtin_variable_h', title: '变量契约H', category: 'format', scope: ['calibration'] }),
    模块({ id: 'st_import_legacy_i', title: 'V1 残留I', category: 'custom' }),
  ];

  it('预设激活时表现类模块与 V1 残留被排除，机器契约与独立系统模块保留', () => {
    expect(selectMainPromptModules(modules, true).map((m) => m.id))
      .toEqual(['custom_game_g', 'builtin_variable_h']);
  });

  it('没有激活预设时表现类模块照常参与（不误伤），V1 残留仍被隔离', () => {
    expect(selectMainPromptModules(modules, false).map((m) => m.id)).toEqual([
      'custom_style_a', 'custom_cot_b', 'custom_format_c', 'custom_persona_d',
      'custom_jailbreak_e', 'custom_devmode_f', 'custom_game_g', 'builtin_variable_h',
    ]);
  });

  it('预设激活时 system prompt 里确实不再出现被排除模块的内容', () => {
    const settings: 游戏设置 = {
      ...创建默认游戏设置(),
      enableStPreset: true,
      currentStPresetIdV2: 'stpreset_1',
      promptModules: [
        模块({ id: 'custom_style_a', title: '文风A', category: 'style', content: '文风A的正文内容' }),
      ],
    };
    const prompt = buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), settings, 4).systemPrompt;
    expect(prompt).not.toContain('文风A的正文内容');
  });

  it('关掉酒馆预设总开关时，玩家自己的文风模块照常参与（不误伤）', () => {
    const settings: 游戏设置 = {
      ...创建默认游戏设置(),
      enableStPreset: false,
      currentStPresetIdV2: null,
      promptModules: [
        模块({ id: 'custom_style_a', title: '文风A', category: 'style', content: '文风A的正文内容' }),
      ],
    };
    const prompt = buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), settings, 4).systemPrompt;
    expect(prompt).toContain('文风A的正文内容');
  });
});
