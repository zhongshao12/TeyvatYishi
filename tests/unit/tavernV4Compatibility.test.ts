import { describe, expect, it } from 'vitest';
import { parseSTPresetV2 } from '@/utils/stPresetParser';
import { normalizeSTPresetList } from '@/utils/stSettingsNormalizer';
import { extractTavernRegexScripts, applyTavernScopedRegexScripts, applyTavernOutputRegexScripts, dryRunTavernRegexScript, mergeTavernRegexImport } from '@/hooks/useGame/tavernRegexProcessor';
import { buildTavernMessageChain, type TavernChainReport } from '@/hooks/useGame/tavernMessageChainBuilder';
import { 创建默认游戏设置 } from '@/models/settings';
import type { STPreset } from '@/models/stTypes';
import type { 聊天消息 } from '@/models/chat';
import { buildPresentationForPreset, buildPresetPresentationCard, rewordBuiltinFormatModule } from '@/utils/presetPresentation';
import { createMacroContext, processMacros } from '@/utils/macroEngine';

const rule = { id: 'embedded', scriptName: '措辞', findRegex: '/旧词/g', replaceString: '新词', placement: [2], markdownOnly: true, promptOnly: true, disabled: false, minDepth: 1, maxDepth: 3 };
const base: STPreset = {
  prompts: [{ identifier: 'main', role: 'system', content: '保持清晰叙事。' }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }],
};
const message = (id: string, role: 'user' | 'assistant', content: string) => ({ id, role, content } as 聊天消息);
const chain = (preset: STPreset, history: 聊天消息[] = []) => buildTavernMessageChain({ settings: 创建默认游戏设置(), preset, characterId: 100001, chatHistory: history, latestUserInput: '本次输入', playerName: '云', playerRole: null, includeNativeNarrative: false, includeNativeContextInWorldbook: false });

describe('V4 preset compatibility', () => {
  it('keeps extension regexes through import and settings reload without retaining helper code', () => {
    const parsed = parseSTPresetV2(JSON.stringify({ ...base, extensions: { regex_scripts: [rule], tavern_helper: { scripts: [{ content: 'throw new Error("must not run")' }] } } }));
    const restored = normalizeSTPresetList(JSON.parse(JSON.stringify([{ id: 'p', name: '测试', preset: parsed.preset }])));
    expect(extractTavernRegexScripts(restored[0]?.preset)).toEqual([rule]);
    expect(restored[0]?.preset).not.toHaveProperty('extensions');
  });

  it('does not execute the same rule twice merely because the export changed its ID', () => {
    expect(extractTavernRegexScripts({ regex_scripts: [rule], extensions: { regex_scripts: [{ ...rule, id: 'standalone' }] } })).toHaveLength(1);
  });

  it('filters outgoing historical text at its message depth without mutating the saved messages', () => {
    const history = [message('a', 'assistant', '旧词一'), message('u', 'user', '旧词二'), message('b', 'assistant', '旧词三')];
    const before = JSON.stringify(history);
    const sent = chain({ ...base, regex_scripts: [{ ...rule, minDepth: 2 }] }, history);
    expect(sent.filter(item => item.role === 'assistant').map(item => item.content)).toEqual(['新词一', '旧词三']);
    expect(sent.find(item => item.content === '旧词二')).toBeDefined();
    expect(JSON.stringify(history)).toBe(before);
  });

  it('places in-chat prompts at their declared depth and preserves native guards after them', () => {
    const preset: STPreset = { ...base, prompts: [...base.prompts, { identifier: 'depth', role: 'system', content: '深度规则', injection_position: 1, injection_depth: 1 }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'depth', enabled: true }, ...base.prompt_order[0]!.order] }] };
    const sent = chain(preset, [message('a', 'assistant', '历史回应')]);
    expect(sent.findIndex(item => item.content === '深度规则')).toBeGreaterThan(sent.findIndex(item => item.content === '历史回应'));
    expect(sent.findIndex(item => item.content === '深度规则')).toBeLessThan(sent.findIndex(item => item.content === '本次输入'));
    expect(sent.at(-1)?.content).toContain('NarrativeTurn');
  });

  it('delivers repeated current input even if an older turn contains the same text and reports a built chain', () => {
    const report = { current: null as TavernChainReport | null };
    const sent = buildTavernMessageChain({ settings: 创建默认游戏设置(), preset: base, characterId: 100001, chatHistory: [message('u', 'user', '本次输入'), message('a', 'assistant', '回应')], latestUserInput: '本次输入', playerName: '云', playerRole: null }, report);
    expect(sent.filter(item => item.role === 'user' && item.content === '本次输入')).toHaveLength(2);
    expect(report.current?.built).toBe(true);
  });

  it('maps structured historical body and summary into the preset shells before history-only filters', () => {
    const history = [message('a', 'assistant', 'raw')];
    history[0]!.parsedResponse = { body: [{ kind: 'narration', text: '旧正文' }], choices: [], factCandidates: [], continuation: { summary: '记录摘要', unresolved: [] } };
    const before = JSON.stringify(history);
    const sent = chain({ ...base, regex_scripts: [{ scriptName: '历史摘要', findRegex: '/^[\\s\\S]*(<meow_FM>[\\s\\S]*$)/i', replaceString: '$1', placement: [2], promptOnly: true, minDepth: 1 }] }, history);
    expect(sent.find(item => item.role === 'assistant')?.content).toContain('<meow_FM>记录摘要</meow_FM>');
    expect(sent.find(item => item.role === 'assistant')?.content).not.toContain('旧正文');
    expect(JSON.stringify(history)).toBe(before);
  });

  it('merges array/single-script imports without re-enabling a user-disabled duplicate', () => {
    const result = mergeTavernRegexImport({ ...base, regex_scripts: [{ ...rule, disabled: true }] }, JSON.stringify([{ ...rule, id: 'other' }]));
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(extractTavernRegexScripts(result.preset)[0]?.disabled).toBe(true);
    expect(mergeTavernRegexImport(base, JSON.stringify(rule)).added).toBe(1);
    expect(() => mergeTavernRegexImport(base, '{"prompts":[]}')).toThrow();
  });

  it('deduplicates scope permutations and repeated placements without re-enabling rules', () => {
    const result = mergeTavernRegexImport({ ...base, regex_scripts: [{ ...rule, placement: [1, 2], disabled: true }] }, JSON.stringify([{ ...rule, placement: [2, 1, 2] }]));
    expect(result.added).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(applyTavernScopedRegexScripts('旧词', result.preset, { destination: 'prompt', placement: 2, depth: 1 }).text).toBe('旧词');
  });

  it('never cleans raw JSON responses with absent or empty placement rules', () => {
    const raw = JSON.stringify({ body: [{ kind: 'narration', text: 'before<!-- KEEP -->after' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } });
    for (const placement of [undefined, []]) {
      const imported = mergeTavernRegexImport(base, JSON.stringify({ findRegex: '/<!--[\\s\\S]*?-->/g', replaceString: '', promptOnly: true, placement }));
      expect(applyTavernOutputRegexScripts(raw, imported.preset).text).toBe(raw);
      expect(applyTavernOutputRegexScripts('```json\n' + raw + '\n```', imported.preset).text).toBe('```json\n' + raw + '\n```');
    }
  });

  it('does not invert a selected maximum-length module into a minimum-length requirement', () => {
    const preset: STPreset = { prompts: [{ identifier: 'small', role: 'system', content: '{{setvar::字数要求::最多仅输出2000字 }}' }, { identifier: 'rule', role: 'system', content: '正文内容需{{getvar::字数要求}}' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'small', enabled: true }, { identifier: 'rule', enabled: true }] }] };
    const presentation = buildPresentationForPreset(preset)!;
    expect(presentation.wordCountTarget).toBeNull();
    expect(buildPresetPresentationCard(presentation)).toContain('不超过 2000 字');
    expect(buildPresetPresentationCard(presentation)).not.toContain('不少于 2000 字');
    expect(rewordBuiltinFormatModule('正文字数不少于 {wordCountTarget} 字；载体为 JSON。', presentation, 5000)).toContain('正文字数不超过 2000 字');
  });
});

describe('scoped regex text copies', () => {
  const apply = (text: string, scripts: unknown[], destination: 'prompt' | 'display' = 'prompt', depth = 1, placement = 2) => applyTavernScopedRegexScripts(text, { regex_scripts: scripts }, { destination, depth, placement });
  it('honors display-only/prompt-only, placement, disabled, and inclusive depth bounds', () => {
    expect(apply('旧词', [rule], 'prompt', 0).text).toBe('旧词');
    expect(apply('旧词', [rule], 'prompt', 1).text).toBe('新词');
    expect(apply('旧词', [rule], 'prompt', 3).text).toBe('新词');
    expect(apply('旧词', [rule], 'prompt', 4).text).toBe('旧词');
    expect(apply('旧词', [rule], 'prompt', 1, 1).text).toBe('旧词');
    expect(apply('旧词', [{ ...rule, disabled: true }]).text).toBe('旧词');
    expect(apply('旧词', [{ ...rule, markdownOnly: true, promptOnly: false }]).text).toBe('旧词');
    expect(apply('旧词', [{ ...rule, markdownOnly: false }], 'display').text).toBe('旧词');
  });
  it('uses explicit regex flags rather than silently forcing global replacement', () => {
    expect(apply('旧词旧词', [{ ...rule, findRegex: '/旧词/' }]).text).toBe('新词旧词');
  });
  it('expands match/capture replacements and trims capture text', () => {
    expect(apply(' [旧词] ', [{ ...rule, findRegex: '/\\[(旧词)\\]/', replaceString: '{{match}}/$1/$$', trimStrings: ['旧'] }]).text).toBe(' [词]/词/$ ');
  });
  it('does not evaluate macros or replacement tokens captured from message text', () => {
    const ctx = createMacroContext();
    ctx.local.safe = 'original';
    const text = '{{setvar::safe::changed}}$1';
    const result = applyTavernScopedRegexScripts(text, { regex_scripts: [{ ...rule, findRegex: '/(.+)/', replaceString: '{{match}}' }] }, { destination: 'prompt', placement: 2, depth: 1, resolveMacros: value => processMacros(value, ctx) });
    expect(result.text).toBe(text);
    expect(ctx.local.safe).toBe('original');
  });
  it('blocks imported markup, invalid patterns and suspicious nested repetitions with reasons', () => {
    for (const script of [{ ...rule, replaceString: '<script>alert(1)</script>' }, { ...rule, findRegex: '[' }, { ...rule, findRegex: '/(a+)+$/' }]) {
      const result = apply('旧词', [script]);
      expect(result.text).toBe('旧词');
      expect(result.skipped.length).toBeGreaterThan(0);
    }
  });

  it('rejects nested-wrapper repetition before execution in both runtime and preview', () => {
    const script = { ...rule, findRegex: '/^((a+))+$/' };
    const result = apply('aaaa!', [script]);
    expect(result.skipped).toEqual([expect.stringContaining('复杂重复正则')]);
    expect(dryRunTavernRegexScript(script, 'aaaa!').ok).toBe(false);
    expect(dryRunTavernRegexScript({ ...script, placement: undefined }, 'aaaa!').ok).toBe(false);
  });
});
