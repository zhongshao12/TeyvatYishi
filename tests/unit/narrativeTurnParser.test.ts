import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildManuallyEditedNarrativeTurn,
  getNarrativeTurnNormalizationWarnings,
  NarrativeTurnParseError,
  parseNarrativeTurn,
  revalidateFactCandidatesForBody,
} from '../../services/ai/narrativeTurnParser';
import {
  parseResponse,
  parseStoredLegacyResponse,
} from '../../services/ai/responseParser';
import { extractStreamingNarrativeBody } from '../../components/features/Chat/MessageRenderers';
import { sanitizeParsedResponse } from '../../utils/textSanitizer';

function validPayload() {
  return {
    body: [
      { kind: 'narration', id: 'scene-1', text: '风从蒙德城门吹来。' },
      { kind: 'dialogue', id: 'line-1', speaker: '安柏', text: '欢迎来到蒙德！' },
      { kind: 'system', id: 'op-1', text: '已记录地点：蒙德城。' },
    ],
    choices: [
      { id: 'knights', label: '前往西风骑士团' },
      { id: 'plaza', label: '先去广场看看' },
    ],
    factCandidates: [
      { domain: 'world', fact: '旅行者抵达蒙德城', evidence: '风从蒙德城门吹来。' },
      { domain: 'system', fact: '当前位置可记为蒙德城', evidence: '已记录地点：蒙德城。' },
    ],
    continuation: {
      summary: '旅行者刚抵达蒙德，安柏正在引路。',
      unresolved: ['是否先去骑士团', '安柏为何在城门等候'],
    },
  };
}

describe('parseNarrativeTurn', () => {
  it('round-trips the formal visible turn contract', () => {
    expect(parseNarrativeTurn(JSON.stringify(validPayload()))).toEqual(validPayload());
  });

  it('rebuilds every nested value, drops unknown keys, and does not mutate input', () => {
    const payload = validPayload() as ReturnType<typeof validPayload> & Record<string, unknown>;
    Object.assign(payload, {
      thinking: 'private chain of thought',
      analysis: 'private analysis',
      toolPayload: { call: 'write_state' },
      extraState: { mora: 999999 },
    });
    Object.assign(payload.body[0]!, { hidden: true, prototype: { polluted: true } });
    Object.assign(payload.choices[0]!, { html: '<button>hidden</button>' });
    Object.assign(payload.factCandidates[0]!, { command: { set: 'world' } });
    Object.assign(payload.continuation, { reasoning: 'secret' });
    const before = structuredClone(payload);

    const turn = parseNarrativeTurn(JSON.stringify(payload));

    expect(payload).toEqual(before);
    expect(turn).toEqual(validPayload());
    expect(turn.body).not.toBe(payload.body);
    expect(turn.body[0]).not.toBe(payload.body[0]);
    expect(JSON.stringify(turn)).not.toMatch(/thinking|analysis|reasoning|toolPayload|extraState|hidden|command/);
  });

  it('drops empty and duplicate choice ids deterministically', () => {
    const payload = validPayload();
    payload.choices = [
      { id: '', label: '空 ID' },
      { id: 'route', label: '保留第一个' },
      { id: 'route', label: '丢弃重复项' },
      { id: 'blank-label', label: '   ' },
      { id: 'camp', label: '去营地' },
    ];

    expect(parseNarrativeTurn(JSON.stringify(payload)).choices).toEqual([
      { id: 'route', label: '保留第一个' },
      { id: 'camp', label: '去营地' },
    ]);
  });

  it('preserves non-standard body kinds as narration instead of silently swallowing dialogue', () => {
    const payload = validPayload();
    payload.body = [
      { kind: 'monologue', speaker: '安柏', text: '我得先确认风向。' },
      { kind: '心声', speaker: '丽莎', text: '小可爱今天似乎有心事。' },
      { kind: 'action', text: '她轻轻合上书页。' },
    ] as typeof payload.body;

    expect(parseNarrativeTurn(JSON.stringify(payload)).body).toEqual([
      { kind: 'narration', speaker: '安柏', text: '我得先确认风向。' },
      { kind: 'narration', speaker: '丽莎', text: '小可爱今天似乎有心事。' },
      { kind: 'narration', text: '她轻轻合上书页。' },
    ]);
    expect(getNarrativeTurnNormalizationWarnings(parseNarrativeTurn(JSON.stringify(payload))))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('monologue'),
        expect.stringContaining('心声'),
        expect.stringContaining('action'),
      ]));
  });

  it('drops invalid domains and facts without evidence tied to a visible block', () => {
    const payload = validPayload();
    payload.factCandidates = [
      { domain: 'world', fact: '可验证', evidence: '风从蒙德城门吹来。' },
      { domain: 'admin', fact: '越权状态', evidence: '风从蒙德城门吹来。' },
      { domain: 'quest', fact: '无可见证据', evidence: '正文中不存在的句子' },
      { domain: 'character', fact: '空证据', evidence: '' },
    ];

    expect(parseNarrativeTurn(JSON.stringify(payload)).factCandidates).toEqual([
      { domain: 'world', fact: '可验证', evidence: '风从蒙德城门吹来。' },
    ]);
  });

  it('revalidates facts against the final visible body without mutating inputs', () => {
    const factCandidates = [
      { domain: 'world' as const, fact: '仍有风声', evidence: '风声' },
      { domain: 'quest' as const, fact: '旧任务线索', evidence: '旧线索' },
    ];
    const finalBody = [{ kind: 'narration' as const, text: '后处理后的正文只保留风声。' }];
    const factsBefore = structuredClone(factCandidates);
    const bodyBefore = structuredClone(finalBody);

    const revalidated = revalidateFactCandidatesForBody(factCandidates, finalBody);

    expect(revalidated).toEqual([
      { domain: 'world', fact: '仍有风声', evidence: '风声' },
    ]);
    expect(revalidated[0]).not.toBe(factCandidates[0]);
    expect(factCandidates).toEqual(factsBefore);
    expect(finalBody).toEqual(bodyBefore);
  });

  it('matches fact evidence after whitespace and punctuation normalization', () => {
    const body = [{ kind: 'narration' as const, text: '旅行者抵达蒙德城，时间是晚上八点。' }];
    const facts = revalidateFactCandidatesForBody([
      { domain: 'world', fact: '抵达蒙德城', evidence: '旅行者 抵达蒙德城；时间是晚上八点' },
    ], body);

    expect(facts).toEqual([
      { domain: 'world', fact: '抵达蒙德城', evidence: '旅行者 抵达蒙德城；时间是晚上八点' },
    ]);
  });

  it('keeps an originally grounded fact when display sanitizing changes its literal evidence', () => {
    const turn = parseNarrativeTurn(JSON.stringify({
      ...validPayload(),
      body: [{ kind: 'narration', text: '旅行者抵达污染词蒙德城。' }],
      factCandidates: [{ domain: 'world', fact: '抵达蒙德城', evidence: '抵达污染词蒙德城' }],
    }));

    const sanitized = sanitizeParsedResponse(turn, {
      污染词清理: { enabled: true, words: ['污染词'] },
      标签块隐藏: { enabled: true },
    });

    expect(sanitized.body[0]?.text).toBe('旅行者抵达蒙德城。');
    expect(sanitized.factCandidates).toEqual([
      { domain: 'world', fact: '抵达蒙德城', evidence: '抵达蒙德城' },
    ]);
  });

  it('builds only valid trimmed manual body edits and clears stale facts immutably', () => {
    const turn = parseNarrativeTurn(JSON.stringify(validPayload()));
    const before = structuredClone(turn);

    expect(buildManuallyEditedNarrativeTurn(turn, '  重写后的正文。\n  ')).toEqual({
      body: [{ kind: 'narration', text: '重写后的正文。' }],
      choices: validPayload().choices,
      factCandidates: [],
      continuation: validPayload().continuation,
    });
    expect(buildManuallyEditedNarrativeTurn(turn, '  \n\t  ')).toBeNull();
    expect(turn).toEqual(before);
  });

  it('allows exactly one surrounding JSON markdown fence repair', () => {
    const raw = JSON.stringify(validPayload(), null, 2);
    expect(parseNarrativeTurn(`\`\`\`json\n${raw}\n\`\`\``)).toEqual(validPayload());

    // 2026-09-02 容错提取升级：思考型模型常输出多段围栏/带前缀文本，
    // 解析器应尽力提取有效 JSON 而不是直接抛 INVALID_JSON。
    expect(parseNarrativeTurn(`\`\`\`json\n\`\`\`json\n${raw}\n\`\`\`\n\`\`\``)).toEqual(validPayload());
    expect(parseNarrativeTurn(`prefix ${raw}`)).toEqual(validPayload());
    expect(() => parseNarrativeTurn(raw.replace('"body"', "'body'")))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
  });

  it.each([
    ['not json', 'INVALID_JSON'],
    ['[]', 'INVALID_ROOT'],
    [JSON.stringify({ body: [], choices: [], factCandidates: [] }), 'INVALID_REQUIRED_FIELD'],
  ])('uses a stable typed error for %s', (raw, code) => {
    try {
      parseNarrativeTurn(raw);
      throw new Error('expected parse to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(NarrativeTurnParseError);
      expect(error).toMatchObject({ name: 'NarrativeTurnParseError', code });
    }
  });

  it('keeps the live parser isolated from the explicit stored-history compatibility parser', () => {
    const tagged = '<thinking>old private text</thinking><正文>旧存档正文</正文><行动选项>1. 继续前进\n2. 留在原地</行动选项><短期记忆>旧小结</短期记忆>';

    expect(() => parseResponse(tagged)).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }));
    expect(parseStoredLegacyResponse(tagged)).toEqual({
      body: [{ kind: 'narration', text: '旧存档正文' }],
      choices: [
        { id: 'legacy-choice-1', label: '继续前进' },
        { id: 'legacy-choice-2', label: '留在原地' },
      ],
      factCandidates: [],
      continuation: { summary: '旧小结', unresolved: [] },
    });
    expect(JSON.stringify(parseStoredLegacyResponse(tagged))).not.toContain('old private text');
  });
});

describe('structured turn source boundary', () => {
  it('previews only complete formal body blocks from a partial JSON stream', () => {
    const partial = '{"body":[{"kind":"narration","text":"风起。","hidden":"不可见"},{"kind":"dialogue","speaker":"安柏","text":"跟我来。"},{"kind":"system","text":"未闭合';

    expect(extractStreamingNarrativeBody(partial)).toBe('风起。\n\n【安柏】跟我来。');
    expect(extractStreamingNarrativeBody('{"body":[{"kind":"narration","text":123}],"factCandidates":[{"evidence":"不可见"}]}')).toBe('');
    expect(extractStreamingNarrativeBody('{"choices":[],"body":[{"kind":"narration","text":"不猜测乱序根字段"}]}')).toBe('');
  });

  it('renders formal choices without depending on legacy action-option cleanup tags', () => {
    const turnItem = fs.readFileSync('components/features/Chat/TurnItem.tsx', 'utf8');
    const inputArea = fs.readFileSync('components/features/Chat/InputArea.tsx', 'utf8');
    const cleanupRegression = fs.readFileSync('scripts/action-options-cleanup-regression.mjs', 'utf8');
    const messageRenderers = fs.readFileSync('components/features/Chat/MessageRenderers.tsx', 'utf8');

    expect(turnItem).toContain('parsed.choices');
    expect(turnItem).not.toContain('parsed.actionOptions');
    expect(inputArea).not.toContain('parseActionOptionsBlock');
    expect(cleanupRegression).not.toContain('<行动选项>');
    expect(messageRenderers).not.toContain('STREAM_BODY_START_RE');
  });
});


describe('思考模型容错提取（INVALID_JSON 修复）', () => {
  it('JSON 前后带推理文本时仍可提取', () => {
    const raw = [
      '好的，让我根据用户输入生成剧情。',
      '',
      JSON.stringify(validPayload()),
      '',
      '以上是我的输出。',
    ].join('\n');
    const turn = parseNarrativeTurn(raw);
    expect(turn.body.length).toBeGreaterThan(0);
  });

  it('多段围栏时取最后一个可解析的 JSON', () => {
    const payload = JSON.stringify(validPayload());
    const raw = [
      '```json',
      '{"thought":"先分析一下"}',
      '```',
      '```json',
      payload,
      '```',
    ].join('\n');
    const turn = parseNarrativeTurn(raw);
    expect(turn.body.length).toBeGreaterThan(0);
  });

  it('JSON 内嵌字符串中的花括号不会破坏平衡扫描', () => {
    const payload = JSON.stringify(validPayload());
    const payloadWithBrace = payload.replace('风从蒙德城门吹来。', '风带来{意外}与[线索]。');
    const raw = [
      '推理过程引用了 {伪造的JSON 片段} 但不算数。',
      '',
      payloadWithBrace,
    ].join('\n');
    const turn = parseNarrativeTurn(raw);
    expect(turn.body.length).toBeGreaterThan(0);
  });
});
