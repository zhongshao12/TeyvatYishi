import { describe, expect, it } from 'vitest';
import { filterStoryTextShell, filterNarrativeTurnShell } from '@/utils/presetShellFilter';
import { getNarrativeTurnPresetCot, getNarrativeTurnNormalizationWarnings, parseNarrativeTurn } from '@/services/ai/narrativeTurnParser';
import { parseResponse } from '@/services/ai/responseParser';
import { extractStreamingNarrativeBody } from '@/components/features/Chat/MessageRenderers';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';

/**
 * 「请你过滤掉正文里面的 <thinking>…」（2026-10-03 用户实测反馈）。
 *
 * 现场：MoM 系预设要求「先思考再写正文」，于是模型把整段 ECoT（自言自语、mermaid 流程图、
 * 「# 开始大思考」、角色表）都写进了 body —— 故事中间夹着幕后分析，读起来不再是小说。
 * 本文件锁定过滤契约：思维链摘出正文但保留在诊断里、`<content>` 只拆壳、摘要并入续写摘要、
 * 面板变成独立 system 块、任何情况下故事文本都不被吞掉。
 */

/** 用户实测贴回来的那段内容的结构（截取，保留全部外壳特征）。 */
const THINKING_SAMPLE = `<thinking>

接下来砂糖要认真思考，不许偷懒！

# Boss对你的工作内容提出了要求和疑问，进入会议讨论环节，认真回答Boss的提问

Boss大人这次的要求非常火辣而且具体呢！而且字数要求非常硬核，正文可见字数必须达到6000字以上。

# 开始前置小思考

判断故事背景：提瓦特大陆·蒙德城，炼金工坊内侧私人休息室。

mermaid流程图判定：

\`\`\`mermaid
graph TD
Start((抱入休息室)) --> Mod4[4. 环境与前戏检定: 私密安全]
\`\`\`

# 开始大思考

一. 精确承接：刚才在工坊前台，云帮助完成了第七十三号甜甜花萃取并强吻夺得初吻。

二. 篇幅保障：必须将正文拉长到6000字以上的极度详实水准。

</thinking>`;

const STORY = '工坊后台的走廊很窄，糖渍的甜味还挂在空气里。云把门闩落下，回头看见砂糖已经蹲在长凳边。';

const PANEL = `| 角色名 | 阵营/身份 | 外貌特征 | 衣着状态 |
| :--- | :--- | :--- | :--- |
| 宇智波云 | 旅行者 | 金发琥珀瞳 | 猎装长裤褪半 |
| 砂糖 | 西风骑士团生物炼金助手 | 浅绿短发 | 白绿研究服尽褪 |`;

describe('A 单段文本：思维链摘出，故事保留', () => {
  it('摘掉 <thinking> 整段（含 mermaid 与「开始大思考」），正文只剩故事', () => {
    const result = filterStoryTextShell(`${THINKING_SAMPLE}\n\n<content>${STORY}</content>`);
    expect(result.text).toBe(STORY);
    expect(result.text).not.toContain('<thinking>');
    expect(result.text).not.toContain('mermaid');
    expect(result.text).not.toContain('开始大思考');
    expect(result.thinking).toContain('开始大思考');
    expect(result.thinking).toContain('graph TD');
    expect(result.removedTags).toContain('thinking');
    expect(result.removedTags).toContain('content');
  });

  it('未闭合的思维链按「位于块首」处理：摘到块尾，不让它漏进正文', () => {
    const result = filterStoryTextShell('<thinking>\n自言自语：先想想怎么承接。\n</content>');
    expect(result.text).toBe('');
    expect(result.thinking).toContain('自言自语');
  });

  it('孤立的思维链标签被清掉，正文其余部分不动', () => {
    const result = filterStoryTextShell(`前一段。\n</thinking>\n<thinking/>\n后一段。`);
    expect(result.text).toBe('前一段。\n\n后一段。');
  });

  it('摘要标签内容并入 summary，面板标签内容单独成项', () => {
    const result = filterStoryTextShell(`<meow_FM>旅行者与砂糖确认关系。</meow_FM>\n<char_date>${PANEL}</char_date>`);
    expect(result.text).toBe('');
    expect(result.summary).toBe('旅行者与砂糖确认关系。');
    expect(result.panels).toEqual([PANEL]);
  });

  it('ECoT 注释标记不算故事文本', () => {
    const result = filterStoryTextShell(`<!-- Start the ECoT -->\n<!--在此注释点思考本次输出中的重要剧情细节-->\n${STORY}`);
    expect(result.text).toBe(STORY);
  });

  it('没有外壳标签时原样返回（不误伤普通正文）', () => {
    const plain = '旅行者推开门，风从广场上吹进来。';
    const result = filterStoryTextShell(plain);
    expect(result.text).toBe(plain);
    expect(result.thinking).toBe('');
    expect(result.removedTags).toEqual([]);
  });
});

describe('B 整轮解析：正文干净、思维链进诊断、面板独立成块', () => {
  function buildRawTurn(): NarrativeTurn {
    return {
      body: [
        { kind: 'narration', id: 'n1', text: THINKING_SAMPLE },
        { kind: 'narration', id: 'n2', text: `<content>${STORY}</content>` },
        { kind: 'system', id: 'p1', text: `<char_date>${PANEL}</char_date>` },
      ],
      choices: [{ id: 'c1', label: '把门闩上' }],
      factCandidates: [
        { domain: 'character', fact: '砂糖仍在害羞', evidence: '自言自语' },
        { domain: 'location', fact: '两人在休息室', evidence: STORY.slice(0, 12) },
      ],
      continuation: { summary: '', unresolved: [] },
    } as NarrativeTurn;
  }

  it('解析后就地摘除外壳：body 不再含思维链，取回时仍在诊断里', () => {
    const parsed = parseNarrativeTurn(JSON.stringify(buildRawTurn()));
    const bodyText = parsed.body.map((block) => block.text).join('\n');
    expect(bodyText).not.toContain('<thinking>');
    expect(bodyText).not.toContain('开始大思考');
    expect(bodyText).toContain(STORY);
    expect(getNarrativeTurnPresetCot(parsed)).toContain('开始大思考');
    expect(getNarrativeTurnNormalizationWarnings(parsed).join('｜')).toContain('已移除预设输出外壳标签');
  });

  it('思维链整段被摘掉的空块直接消失，正文块数量收敛到故事与面板', () => {
    const parsed = parseNarrativeTurn(JSON.stringify(buildRawTurn()));
    expect(parsed.body.map((block) => block.kind)).toEqual(['narration', 'system']);
    expect(parsed.body[0]!.text).toBe(STORY);
    expect(parsed.body[1]!.text).toContain('宇智波云');
  });

  it('只有正文里能站住的证据才算事实候选（思维链里的证据作废）', () => {
    const parsed = parseNarrativeTurn(JSON.stringify(buildRawTurn()));
    expect(parsed.factCandidates.map((item) => item.fact)).toEqual(['两人在休息室']);
  });

  it('parseResponse 走同一套过滤（主剧情实际入口）', () => {
    const parsed = parseResponse(JSON.stringify(buildRawTurn()));
    expect(parsed.body.map((block) => block.text).join('\n')).not.toContain('<thinking>');
  });

  it('不需要过滤时不产生诊断噪声', () => {
    const clean: NarrativeTurn = {
      body: [{ kind: 'narration', text: STORY }],
      choices: [],
      factCandidates: [],
      continuation: { summary: '摘要', unresolved: [] },
    } as NarrativeTurn;
    const parsed = parseNarrativeTurn(JSON.stringify(clean));
    expect(getNarrativeTurnPresetCot(parsed)).toBe('');
    expect(getNarrativeTurnNormalizationWarnings(parsed)).toEqual([]);
  });
});

describe('C 过滤器直连契约', () => {
  it('filterNarrativeTurnShell 把面板变成独立 system 块且不丢原文', () => {
    const turn: NarrativeTurn = {
      body: [{ kind: 'narration', text: `${STORY}\n<char_date>${PANEL}</char_date>` }],
      choices: [],
      factCandidates: [],
      continuation: { summary: '', unresolved: [] },
    } as NarrativeTurn;
    const result = filterNarrativeTurnShell(turn);
    expect(result.turn.body).toHaveLength(2);
    expect(result.turn.body[0]).toEqual({ kind: 'narration', text: STORY });
    expect(result.turn.body[1]).toEqual({ kind: 'system', text: PANEL });
  });

  it('已有更完整的续写摘要时不覆盖模型给的摘要', () => {
    const turn: NarrativeTurn = {
      body: [{ kind: 'narration', text: `<meow_FM>短摘要</meow_FM>` }],
      choices: [],
      factCandidates: [],
      continuation: { summary: '这是模型自己写的、更完整的续写摘要，应当保留下来。', unresolved: [] },
    } as NarrativeTurn;
    const result = filterNarrativeTurnShell(turn);
    expect(result.turn.continuation.summary).toBe('这是模型自己写的、更完整的续写摘要，应当保留下来。');
  });

  it('流式预览同样摘掉思维链（生成过程中不再刷出后台分析）', () => {
    const raw = JSON.stringify({
      body: [
        { kind: 'system', text: '<thinking>\n自言自语：先想想怎么承接。\n</thinking>' },
        { kind: 'narration', text: STORY },
      ],
    });
    const preview = extractStreamingNarrativeBody(raw);
    expect(preview).not.toContain('<thinking>');
    expect(preview).not.toContain('自言自语');
    expect(preview).toContain(STORY);
  });
});
