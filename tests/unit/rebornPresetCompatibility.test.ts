import { describe, expect, it } from 'vitest';
import reborn from '../fixtures/tavern/reborn2.4-shape.json';
import { parseSTPresetV2 } from '@/utils/stPresetParser';
import { normalizeSTPreset, extractSTPresetSamplingParams, describeSTPresetSamplingBounds } from '@/utils/stSettingsNormalizer';
import { resolveSTPresetOrder, countEnabledSTOrderSlots } from '@/utils/stPresetOrder';
import { getSTPresetOrder, buildTavernMessageChain } from '@/hooks/useGame/tavernMessageChainBuilder';
import { selectPresetOrderSlots } from '@/utils/presetPresentation';
import { createMacroContext, processMacros } from '@/utils/macroEngine';
import { 创建默认游戏设置 } from '@/models/settings';
import type { STPreset } from '@/models/stTypes';

const parseReborn = (): STPreset => {
  const parsed = parseSTPresetV2(JSON.stringify(reborn));
  if (!parsed.preset) throw new Error(parsed.error ?? 'parse failed');
  return parsed.preset;
};

describe('ST prompt_order 空壳槽位兼容（Reborn 2.4 形态）', () => {
  it('skips an empty character slot and falls back to the usable 100001 order', () => {
    const preset = parseReborn();
    expect(preset.prompt_order.map((order) => `${order.character_id}:${order.order.length}`)).toEqual(['100000:0', '100001:6']);
    expect(resolveSTPresetOrder(preset, 100000)?.character_id).toBe(100001);
    expect(getSTPresetOrder(preset, 100000)?.character_id).toBe(100001);
    expect(selectPresetOrderSlots(preset, 100000)).toHaveLength(6);
    expect(countEnabledSTOrderSlots(preset, null)).toBe(6);
  });

  it('still honours an explicitly requested usable slot instead of the default', () => {
    const preset = parseReborn();
    const withCustom: STPreset = {
      ...preset,
      prompt_order: [
        ...preset.prompt_order,
        { character_id: 200000, order: [{ identifier: 'tail', enabled: true }] },
      ],
    };
    expect(resolveSTPresetOrder(withCustom, 200000)?.character_id).toBe(200000);
    expect(resolveSTPresetOrder(withCustom, 100001)?.character_id).toBe(100001);
    expect(resolveSTPresetOrder(withCustom, 300000)?.character_id).toBe(100001);
  });

  it('returns the empty slot only when every slot is empty', () => {
    const preset: STPreset = { prompts: [{ identifier: 'x', role: 'system', content: 'x' }],
      prompt_order: [{ character_id: 100000, order: [] }, { character_id: 100001, order: [] }] };
    expect(resolveSTPresetOrder(preset, null)?.character_id).toBe(100000);
    expect(resolveSTPresetOrder({ prompts: [], prompt_order: [] }, null)).toBeNull();
  });

  it('builds a real message chain even when the stored character id points at the empty slot', () => {
    const preset = parseReborn();
    const settings = 创建默认游戏设置();
    settings.enableStPreset = true;
    const chain = buildTavernMessageChain({
      settings, preset, characterId: 100000,
      chatHistory: [{ role: 'user', content: '你好' } as never],
      latestUserInput: '我们去风起地吧', playerName: '云', playerRole: null,
      includeNativeNarrative: false, includeNativeContextInWorldbook: false,
    });
    const joined = chain.map((message) => message.content).join('\n');
    expect(chain.length).toBeGreaterThan(3);
    expect(joined).toContain('这是预设正文');
    expect(joined).toContain('结尾规则');
    expect(joined).toContain('玩家是 云');
    expect(joined).not.toContain('{{trim}}');
  });
});

describe('Reborn 2.4 导入的其它兼容点', () => {
  it('strips third-party plugin payloads instead of persisting them', () => {
    const preset = normalizeSTPreset(JSON.parse(JSON.stringify(reborn)))!;
    const serialized = JSON.stringify(preset);
    expect(serialized).not.toContain('xiaobai_ext');
    expect(serialized).not.toContain('must not run');
    expect(serialized).not.toContain('SPreset');
    expect(preset.regex_scripts).toHaveLength(2);
  });

  it('drops ST slider extremes but keeps usable sampling values', () => {
    const preset = parseReborn();
    const params = extractSTPresetSamplingParams(preset)!;
    expect(params.temperature).toBe(1.08);
    expect(params.topP).toBe(0.98);
    expect(params.maxTokens).toBeUndefined();
    expect(params.maxContext).toBeUndefined();
    expect(describeSTPresetSamplingBounds(preset)).toEqual([
      '输出上限 65535（超过 32768）',
      '上下文上限 2000000（超过 1048576）',
    ]);
    const bounded = extractSTPresetSamplingParams({ openai_max_tokens: 32768, openai_max_context: 1048576 })!;
    expect(bounded.maxTokens).toBe(32768);
    expect(bounded.maxContext).toBe(1048576);
  });

  it('expands the standalone {{trim}} macro and keeps {{trim::…}} behaviour', () => {
    const ctx = createMacroContext();
    expect(processMacros('{{trim}}  正文', ctx)).toBe('  正文');
    expect(processMacros('{{trim::  正文  }}', ctx)).toBe('正文');
    expect(processMacros('{{// 注释}}正文', ctx)).toBe('正文');
  });
});
