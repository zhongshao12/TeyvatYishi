import { describe, expect, it } from 'vitest';
import { 创建默认游戏设置, type 游戏设置 } from '@/models/settings';
import { buildTavernMessageChain } from '@/hooks/useGame/tavernMessageChainBuilder';
import {
  buildPresentationForPreset,
  buildPresetPresentationCard,
  buildPresetPrecedenceHeader,
  collectBracketSegments,
  formatPresetPresentationSummary,
  PRESET_FORMAT_COT_ALLOWANCE,
  resolveEffectiveWordCountTarget,
  resolveNarrativeMaxTokens,
  resolvePresetPresentation,
  rewordBuiltinFormatModule,
  BUILTIN_FORMAT_COT_BAN,
  NARRATIVE_MAX_TOKENS_CEILING,
  type PresetPresentation,
} from '@/utils/presetPresentation';
import {
  countVisibleBodyCharacters,
  decideMainNarrativeValidation,
  shouldEnforceWordCount,
  WORD_COUNT_ENFORCEMENT_MIN_TARGET,
} from '@/services/ai/mainNarrativeValidation';
import { buildWordCountRetryGuard } from '@/hooks/useGame/mainNarrativeRequestStage';
import type { STPreset } from '@/models/stTypes';
import type { 提示词模块 } from '@/models/prompts';

/**
 * 「预设还是没有起到作用：1.字数没有达标，2.文风没有启动」（2026-10-03 第二轮实测反馈）。
 *
 * 排查到的三处**结构性**冲突（本文件的用例就是这三条的回归门禁）：
 *   A 字数：内置《回复格式》用 `{wordCountTarget}`（默认 500）声明下限，且在消息链里从未被替换过；
 *     预设自己的「至少 3000 字」写在更早的消息里 —— 生成点附近更具体的那个默认值会赢。
 *   B 文风：内置《文风参考·日记体见闻录》被塞进**预设自己的链内部**（World Info 槽位）当文风权威。
 *   C 外壳：预设用「变量 + 标签外壳」表达思维链/正文/摘要/角色表，应用却说「禁止 thinking」。
 *
 * 夹具按真实预设（MoM 系，211 槽位 / 74 启用）的架构搭：定义型条目只放 `{{setvar}}`，
 * 「开始/结束」是**纯标签条目**，正文里只会**提及**标签（`确保<content>中正文字数达到至少3000字`）。
 */

function module_(overrides: Partial<提示词模块> & { id: string; title: string }): 提示词模块 {
  return {
    kind: 'custom',
    category: 'custom',
    scope: ['main'],
    role: 'system',
    enabled: true,
    order: 1,
    content: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as 提示词模块;
}

/** 真实预设结构的最小复刻（含空〈文风〉段 + 提及式标签）。 */
function 构造预设(options: { 文风填充?: boolean } = {}): STPreset {
  const prompts = [
    {
      identifier: 'vars', name: '📌变量（必开）', role: 'system',
      content: [
        '{{setvar::字数要求::至少3000}}',
        '{{setvar::cot头::<thinking>}}',
        '{{setvar::cot尾::</thinking>}}',
        '{{setvar::正文标签::<content>\n正文内容\n</content>}}',
        '{{setvar::摘要标签::<meow_FM>\n</meow_FM>}}',
        '{{setvar::角色表::<char_date>\n</char_date>}}',
      ].join('\n'),
    },
    { identifier: 'role', name: '⚠️工作职责⚠️', role: 'system', content: '你是砂糖，公司副总。' },
    // 提及式标签：整段不是纯标签，因此不得参与括号配对（否则所有段都会变成「有内容」）。
    { identifier: 'lang', name: '⚠️使用语言⚠️', role: 'system', content: '- 确保<content>中正文字数达到至少3000字' },
    { identifier: 'pov-open', name: '——视角选择开始——', role: 'system', content: '<POV>' },
    { identifier: 'pov-3rd', name: '第三人称', role: 'system', content: '- 全程采用第三人称叙述。' },
    { identifier: 'pov-close', name: '——视角选择结束——', role: 'system', content: '</POV>' },
    { identifier: 'tone-open', name: '——故事基调↓——', role: 'system', content: '<故事基调>' },
    { identifier: 'style-open', name: '——文风开始——', role: 'system', content: '</故事基调>\n<文风>' },
    ...(options.文风填充
      ? [{ identifier: 'style-fill', name: '🍩文风缝合自定义', role: 'system', content: '文风：白描为主，短句，克制，不抒情。' }]
      : []),
    { identifier: 'style-close', name: '——文风结束——', role: 'system', content: '</文风>' },
    { identifier: 'len', name: '📚字数要求(固定字数)', role: 'system', content: '- 正文<content>内容需`{{getvar::字数要求}}`字' },
    { identifier: 'cot', name: '💭简化 COT分析💭', role: 'system', content: '判断故事背景：确认该故事属于（现代/古风/西幻/日式……），接下来的输出中，语言风格和用词都要严格注意现代/古风/西幻/日式化……\n# 确保<content>中正文字数达到至少{{getvar::字数要求}}字\n{{getvar::cot头}}里用砂糖口吻自言自语。\n## Ⅱ.参考<文风>' },
  ];
  const order = prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: true }));
  return { prompts, prompt_order: [{ character_id: 100001, order }] } as unknown as STPreset;
}

const 未勾选文风候选 = { identifier: 'style-candidate', name: '🍩白描淫荡文风(原创)', role: 'system', content: '白描。' };

function 构造含关候选的预设(): STPreset {
  const preset = 构造预设();
  (preset.prompts as Array<{ identifier: string }>).push(未勾选文风候选 as never);
  (preset.prompt_order[0]!.order as Array<{ identifier: string; enabled: boolean }>).push({
    identifier: 'style-candidate',
    enabled: false,
  });
  return preset;
}

const 内置模块: 提示词模块[] = [
  module_({
    id: 'builtin_response_format',
    title: 'NarrativeTurn JSON 回复格式',
    category: 'format',
    content: '只输出一个合法 JSON 对象。禁止输出 thinking、analysis、推理过程或隐藏状态。\n正文字数不少于 {wordCountTarget} 字；用{personLabel}称呼主角。',
  }),
  module_({ id: 'builtin_writing_style', title: '文风参考·日记体见闻录', category: 'style', content: '日记体：像翻看某天的日记，比喻来自猫狗食物。' }),
  module_({ id: 'builtin_action_options', title: '行动选项', category: 'format', content: 'choices 给出 3-4 条行动。' }),
  module_({ id: 'builtin_narrator_persona', title: '叙述者人格', category: 'persona', content: '你是固定叙事主持者。' }),
];

function 构造设置(preset: STPreset, overrides: Partial<游戏设置> = {}): 游戏设置 {
  return {
    ...创建默认游戏设置(),
    enableStPreset: true,
    currentStPresetIdV2: 'st_v2_1',
    currentStCharacterId: 100001,
    stPresetsV2: [{ id: 'st_v2_1', name: '糖糖公司 V3.8', preset, importedAt: 1, updatedAt: 1 }],
    wordCountTarget: 500,
    promptModules: 内置模块,
    ...overrides,
  };
}

function 取表现(preset: STPreset): PresetPresentation {
  const presentation = buildPresentationForPreset(preset, { presetId: 'st_v2_1', presetName: '糖糖公司 V3.8', characterId: 100001 });
  expect(presentation).not.toBeNull();
  return presentation!;
}

describe('A 括号段解析：纯标签条目才是分隔符，正文提及不算', () => {
  it('提及式标签不会污染段落，空〈文风〉段能被识别出来', () => {
    const segments = collectBracketSegments([
      { name: 'lang', text: '- 确保<content>中正文字数达到至少3000字' },
      { name: 'style-open', text: '</故事基调>\n<文风>' },
      { name: 'style-close', text: '</文风>' },
    ]);
    expect(segments.get('文风')).toBe('');
    expect(segments.has('content')).toBe(false);
  });

  it('段内有填充模块时收集到正文', () => {
    const segments = collectBracketSegments([
      { name: 'style-open', text: '<文风>' },
      { name: 'fill', text: '白描为主，短句。' },
      { name: 'style-close', text: '</文风>' },
    ]);
    expect(segments.get('文风')).toBe('白描为主，短句。');
  });
});

describe('B 表现层契约解析（字数 / 外壳 / 文风段）', () => {
  it('字数下限取预设变量与正文声明里的最大值，并记录来源', () => {
    const presentation = 取表现(构造预设());
    expect(presentation.wordCountTarget).toBe(3000);
    expect(presentation.wordCountRaw).toBe('至少3000');
    expect(presentation.wordCountSource).toBe('变量 字数要求');
  });

  it('外壳标签按变量解析成 JSON 字段映射', () => {
    const presentation = 取表现(构造预设());
    const map = new Map(presentation.shell.map((item) => [item.tag, item.kind]));
    expect(map.get('content')).toBe('body');
    expect(map.get('meow_FM')).toBe('summary');
    expect(map.get('char_date')).toBe('table');
    expect(map.get('thinking')).toBe('thinking');
    expect(presentation.cotRequested).toBe(true);
  });

  it('文风段为空时报告空段，并列出可勾选的填充模块（名字带「文风」的排前面）', () => {
    const presentation = 取表现(构造含关候选的预设());
    expect(presentation.styleText).toBe('');
    expect(presentation.styleSegmentsEmpty).toContain('文风');
    expect(presentation.disabledStyleCandidates[0]).toBe('🍩白描淫荡文风(原创)');
    expect(formatPresetPresentationSummary(presentation)).toContain('段是空的');
  });

  it('文风段有填充模块时取到预设原文，且不再报告空段', () => {
    const presentation = 取表现(构造预设({ 文风填充: true }));
    expect(presentation.styleText).toBe('文风：白描为主，短句，克制，不抒情。');
    expect(presentation.styleSegmentsFilled).toContain('文风');
    expect(presentation.styleSegmentsEmpty).not.toContain('文风');
  });

  it('表现段为空时仍从其余条目抽出人称/语言要求（预设真实要求，不编造）', () => {
    const presentation = 取表现(构造预设());
    expect(presentation.styleDirectives).toContain('全程采用第三人称叙述');
    expect(presentation.styleDirectives).toContain('语言风格和用词都要严格注意现代/古风/西幻/日式化');
    // 纯标签条目（括号条目）本身不进补充要求
    expect(presentation.styleDirectives).not.toContain('【——文风开始——】');
  });

  it('settings 路径解析 + 总开关关闭时不解析', () => {
    const preset = 构造预设();
    expect(resolvePresetPresentation(构造设置(preset))?.wordCountTarget).toBe(3000);
    expect(resolvePresetPresentation(构造设置(preset, { enableStPreset: false }))).toBeNull();
    expect(resolvePresetPresentation(构造设置(preset, { currentStPresetIdV2: null }))).toBeNull();
  });

  it('生效字数下限：预设更大时用预设，预设小于设置时用设置，无预设时用设置', () => {
    const preset = 构造预设();
    expect(resolveEffectiveWordCountTarget(构造设置(preset), 500)).toBe(3000);
    expect(resolveEffectiveWordCountTarget(构造设置(preset), 5000)).toBe(5000);
    expect(resolveEffectiveWordCountTarget({ enableStPreset: false }, 500)).toBe(500);
  });
});

describe('C 生成点执行卡', () => {
  it('执行卡写明字数、逐块预算、外壳映射与可见思维链', () => {
    const card = buildPresetPresentationCard(取表现(构造预设()));
    expect(card).toContain('不少于 3000 字');
    expect(card).toContain('建议 5-8 个块');
    expect(card).toContain('<meow_FM> → continuation.summary 字段');
    expect(card).toContain('<thinking> → body 里 kind:"system" 的块');
    expect(card).toContain('可见思维链');
    expect(card).toContain('【不可协商】');
    expect(card).toContain('NarrativeTurn JSON');
    // 说明内置默认值让位，避免模型在两个字数之间摇摆
    expect(card).toContain('本回合以预设要求为准');
  });

  it('文风段为空时，执行卡直说「没有文风正文」并给出可勾选条目', () => {
    const card = buildPresetPresentationCard(取表现(构造含关候选的预设()));
    expect(card).toContain('预设本次没有文风正文');
    expect(card).toContain('🍩白描淫荡文风(原创)');
    expect(card).toContain('【预设其余条目里的表现要求】');
    expect(card).toContain('全程采用第三人称叙述');
  });

  it('文风段有内容时执行卡原文附上，并声明优先于内置文风', () => {
    const card = buildPresetPresentationCard(取表现(构造预设({ 文风填充: true })));
    expect(card).toContain('文风：白描为主，短句，克制，不抒情。');
    expect(card).toContain('优先于应用内置《文风参考·日记体见闻录》');
  });

  it('system prompt 顶部的优先级声明带上预设的实际要求', () => {
    const header = buildPresetPrecedenceHeader(取表现(构造预设()));
    expect(header).toContain('酒馆预设优先');
    expect(header).toContain('3000 字');
    expect(header).toContain('kind:"system"');
    expect(header).toContain('<content>');
  });
});

describe('D 内置格式守卫按预设改写', () => {
  it('替换字数占位符，并把「禁止 thinking」改写为「写进 system 块」', () => {
    const presentation = 取表现(构造预设());
    const base = '禁止输出 thinking、analysis、推理过程或隐藏状态。\n正文字数不少于 {wordCountTarget} 字。';
    const next = rewordBuiltinFormatModule(base, presentation, 3000);
    expect(next).not.toContain('{wordCountTarget}');
    expect(next).toContain('不少于 3000 字');
    expect(next).not.toContain(BUILTIN_FORMAT_COT_BAN);
    expect(next).toContain(PRESET_FORMAT_COT_ALLOWANCE);
  });

  it('没有 {wordCountTarget} 占位符时补一行生效字数；无预设时不动文本', () => {
    const presentation = 取表现(构造预设());
    expect(rewordBuiltinFormatModule('只有这句。', presentation, 3000)).toContain('本回合正文合计不少于 3000 字');
    expect(rewordBuiltinFormatModule('只有这句。', null, 500)).toBe('只有这句。');
  });
});

describe('E 消息链：预设要求进入生成点，内置默认值让位', () => {
  it('链尾执行要求带 3000 字 + 外壳映射 + 可见思维链', () => {
    const preset = 构造预设();
    const chain = buildTavernMessageChain({
      settings: 构造设置(preset) as never,
      preset,
      characterId: 100001,
      chatHistory: [],
      latestUserInput: '开始。',
      playerName: '旅行者',
      playerRole: {} as never,
      triggerType: 'normal',
    } as never);
    const joined = chain.map((message) => message.content ?? '').join('\n');
    expect(joined).toContain('已激活酒馆预设·表现层执行卡');
    expect(joined).toContain('不少于 3000 字');
    expect(joined).toContain('<meow_FM> → continuation.summary 字段');
    expect(joined).toContain('唯一不可协商的是');
    // 链内不再出现「禁止 thinking」这条与预设对撞的禁令
    expect(joined).not.toContain(BUILTIN_FORMAT_COT_BAN);
    // 内置格式守卫里的占位符必须已被替换（此前它以字面量进请求）
    expect(joined).not.toContain('{wordCountTarget}');
    expect(joined).not.toContain('{personLabel}');
    expect(joined).toContain('人称"');
  });

  it('文风段为空时内置文风兜底仍参与；文风段有内容时内置文风被排除', () => {
    const 空文风 = 构造预设();
    const chainEmpty = buildTavernMessageChain({
      settings: 构造设置(空文风) as never,
      preset: 空文风, characterId: 100001, chatHistory: [], latestUserInput: '开始。',
      playerName: '旅行者', playerRole: {} as never, triggerType: 'normal',
    } as never);
    expect(chainEmpty.map((m) => m.content ?? '').join('\n')).toContain('日记体：像翻看某天的日记');

    const 有文风 = 构造预设({ 文风填充: true });
    const chainFilled = buildTavernMessageChain({
      settings: 构造设置(有文风) as never,
      preset: 有文风, characterId: 100001, chatHistory: [], latestUserInput: '开始。',
      playerName: '旅行者', playerRole: {} as never, triggerType: 'normal',
    } as never);
    const joinedFilled = chainFilled.map((m) => m.content ?? '').join('\n');
    expect(joinedFilled).not.toContain('日记体：像翻看某天的日记');
    expect(joinedFilled).toContain('文风：白描为主，短句，克制，不抒情。');
  });
});

describe('F 字数校验：不达标自动重写一次', () => {
  it('可见正文按去空白后的码点计数', () => {
    expect(countVisibleBodyCharacters('砂糖 说：\n“你好。”')).toBe(9);
    expect(countVisibleBodyCharacters('')).toBe(0);
    expect(countVisibleBodyCharacters(null)).toBe(0);
  });

  it('明显不达标才触发：允许 10% 浮动，且只对长文要求生效', () => {
    expect(shouldEnforceWordCount(3000, 800)).toBe(true);
    expect(shouldEnforceWordCount(3000, 2800)).toBe(false);
    expect(shouldEnforceWordCount(3000, 2700)).toBe(false); // 恰好 90%：算达标
    expect(shouldEnforceWordCount(3000, 2699)).toBe(true);
    expect(shouldEnforceWordCount(WORD_COUNT_ENFORCEMENT_MIN_TARGET - 1, 10)).toBe(false);
    expect(shouldEnforceWordCount(null, 10)).toBe(false);
  });

  it('校验决策：字数不足排在协议校验之后、接受之前', () => {
    const decision = decideMainNarrativeValidation({
      blank: false, missingPartyMembers: [], rerollSimilarity: 0, protocolIssues: [],
      canRetry: true, wordCountTarget: 3000, bodyCharacterCount: 900,
    });
    expect(decision).toEqual({ action: 'retry', kind: 'word_count_short', wordCountTarget: 3000, bodyCharacterCount: 900 });

    expect(decideMainNarrativeValidation({
      blank: false, missingPartyMembers: [], rerollSimilarity: 0, protocolIssues: [],
      canRetry: false, wordCountTarget: 3000, bodyCharacterCount: 900,
    }).action).toBe('accept');

    expect(decideMainNarrativeValidation({
      blank: false, missingPartyMembers: [], rerollSimilarity: 0, protocolIssues: [],
      canRetry: true, wordCountTarget: 500, bodyCharacterCount: 100,
    }).action).toBe('accept');
  });

  it('重写指令写清差距、扩写方向与禁止凑数的手段', () => {
    const guard = buildWordCountRetryGuard(3000, 820);
    expect(guard).toContain('实测 820 字');
    expect(guard).toContain('不少于 3000 字');
    expect(guard).toContain('禁止用重复句');
    expect(guard).toContain('NarrativeTurn JSON');
  });
});

describe('G 输出预算下限：别让 max_tokens 把长正文截断', () => {
  it('预设要求长文时抬起预算，够用则原样返回', () => {
    expect(resolveNarrativeMaxTokens(2048, 3000)).toBe(4800);
    expect(resolveNarrativeMaxTokens(4096, 3000)).toBe(4800);
    expect(resolveNarrativeMaxTokens(30000, 3000)).toBe(30000);
    expect(resolveNarrativeMaxTokens(undefined, 3000)).toBe(4800);
  });

  it('短要求或无要求时不动预算', () => {
    expect(resolveNarrativeMaxTokens(2048, null)).toBe(2048);
    expect(resolveNarrativeMaxTokens(2048, undefined)).toBe(2048);
    expect(resolveNarrativeMaxTokens(2048, 500)).toBe(2048);
    // 上限保护：不因为预设写了极大字数就发出超限请求
    expect(resolveNarrativeMaxTokens(1024, 20000)).toBe(NARRATIVE_MAX_TOKENS_CEILING);
  });
});
