import { describe, expect, it } from 'vitest';
import { normalizeSTPreset, normalizeSTPrompt } from '@/utils/stSettingsNormalizer';

function buildPresetInput(): Record<string, unknown> {
  return {
    temperature: 0.7,
    top_p: 0.93,
    top_a: 0.5,
    min_p: 0.05,
    openai_max_tokens: 512,
    openai_max_context: 8192,
    frequency_penalty: -0.2,
    prompts: [
      {
        identifier: 'main',
        name: '主提示',
        role: 'system',
        content: '保持角色连贯。',
        marker: false,
        system_prompt: true,
        injection_position: 1,
        injection_depth: 2,
        injection_order: 3,
        forbid_overrides: true,
        未知提示字段: '任意内容',
        附加对象: { a: 1 },
      },
      { identifier: 'chatHistory', role: 'system', content: '', marker: true },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    world_info: [{ key: ['璃月'], content: '契约之国' }],
    regex_scripts: [{ scriptName: '显示层替换' }],
    未知顶层字段: { huge: '任意内容' },
    extensions: { arbitrary: '任意内容' },
  };
}

describe('ST preset import whitelist', () => {
  it('keeps every field the runtime consumes and drops arbitrary imported keys', () => {
    const preset = normalizeSTPreset(buildPresetInput());
    expect(preset).not.toBeNull();
    if (!preset) return;

    // 已被运行时消费的字段必须原样保留。
    expect(preset.prompts).toHaveLength(2);
    expect(preset.prompt_order[0]?.order).toHaveLength(1);
    expect(preset.temperature).toBe(0.7);
    expect(preset.top_p).toBe(0.93);
    expect(preset.top_a).toBe(0.5);
    expect(preset.min_p).toBe(0.05);
    expect(preset.openai_max_tokens).toBe(512);
    expect(preset.openai_max_context).toBe(8192);
    expect(preset.frequency_penalty).toBe(-0.2);
    expect(preset.world_info).toHaveLength(1);
    expect(preset.regex_scripts).toHaveLength(1);

    const main = preset.prompts[0];
    expect(main).toMatchObject({
      identifier: 'main',
      name: '主提示',
      role: 'system',
      content: '保持角色连贯。',
      marker: false,
      system_prompt: true,
      injection_position: 1,
      injection_depth: 2,
      injection_order: 3,
      forbid_overrides: true,
    });
    expect(preset.prompts[1]?.marker).toBe(true);
  });

  it('does not carry unknown top-level keys from the imported JSON into the stored preset', () => {
    const preset = normalizeSTPreset(buildPresetInput());
    expect(preset).not.toBeNull();
    expect(preset).not.toHaveProperty('未知顶层字段');
    expect(preset).not.toHaveProperty('extensions');
  });

  it('does not carry unknown prompt keys from the imported JSON into the stored preset', () => {
    const preset = normalizeSTPreset(buildPresetInput());
    const main = preset?.prompts[0];
    expect(main).toBeDefined();
    expect(main).not.toHaveProperty('未知提示字段');
    expect(main).not.toHaveProperty('附加对象');
  });

  it('keeps prompt-level hard requirements unchanged', () => {
    expect(normalizeSTPrompt({ identifier: 'x', prompt: '正文' })?.content).toBe('正文');
    expect(normalizeSTPrompt({ identifier: 'x', role: 'user', content: '你好' })).toMatchObject({
      identifier: 'x',
      role: 'user',
      content: '你好',
      marker: false,
    });
    // 空正文且非 marker 的条目仍然被拒绝（结构校验不得被弱化）。
    expect(normalizeSTPrompt({ identifier: 'x', content: '' })).toBeNull();
    expect(normalizeSTPrompt({ content: '缺少 identifier' })).toBeNull();
    // 空 prompts / 空 prompt_order 的预设仍然被拒绝。
    expect(normalizeSTPreset({ prompts: [], prompt_order: [] })).toBeNull();
  });
});
