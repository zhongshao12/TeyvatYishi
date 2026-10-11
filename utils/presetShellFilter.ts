/**
 * 酒馆预设「输出外壳」过滤器（2026-10-03）。
 *
 * 背景：MoM 系预设把输出写成「变量 + 标签外壳」——
 *   `<!-- Start the ECoT -->` → `<thinking>…（自言自语、mermaid 流程图、大思考）…</thinking>`
 *   → `<content>正文</content>` → `<meow_FM>摘要</meow_FM>` → `<char_date>角色表</char_date>`
 * 上一轮我们把「预设要求什么就写什么」落到实处（思维链写进 `kind:"system"` 块），
 * 但玩家实测的结果是：**思维链整段出现在正文里**，`<thinking>` 标签、流程图、
 * 「# 开始大思考」这些幕后分析挤在故事中间，读起来就不再是小说了。
 *
 * 本模块只做一件事：把这类**外壳**从可见正文里摘出来。
 *   - 思维链 / 分析 / ECoT 注释 / seeds → 摘出正文（另存到消息诊断里，不再展示、不再进记忆）；
 *   - `<content>` / `<正文>` 这类**包裹标签** → 只拆标签，保留里面的故事文本；
 *   - `<meow_FM>` / `<短期记忆>` 这类**摘要标签** → 内容并入 `continuation.summary`；
 *   - `<char_date>` / `<状态栏>` 这类**面板标签** → 变成独立的 `system` 块（预设要求它们可见）。
 *
 * 不猜、不吞故事：只有确实匹配到已知外壳标签才动手，未闭合的思维链按「它在块首」处理，
 * 摘完若整块为空则整块丢弃（解析层本来就会丢弃空块）。
 */

import type { NarrativeTurn, StoryBlock } from '@/models/teyvat/narrativeTurn';

export interface ShellFilterResult {
  /** 过滤后的可见文本（可能为空）。 */
  text: string;
  /** 摘出的思维链正文。 */
  thinking: string;
  /** 摘出的摘要正文（`<meow_FM>` 等）。 */
  summary: string;
  /** 摘出的面板正文（`<char_date>` 等），每项一块。 */
  panels: string[];
  /** 摘出的元信息正文（`<disclaimer>` 免责声明/破限声明等），不展示、只留诊断。 */
  meta: string[];
  /** 本次摘掉/拆掉的标签名（已去重、小写）。 */
  removedTags: string[];
}

export interface NarrativeShellFilterResult {
  turn: NarrativeTurn;
  thinking: string;
  summary: string;
  panels: string[];
  /** 被丢弃的元信息块（免责声明/破限声明等），只用于诊断，不进入正文与记忆。 */
  meta: string[];
  removedTags: string[];
  /** 思维链字符数（用于诊断展示）。 */
  thinkingChars: number;
}

/** 思维链类外壳：内容属于幕后分析，不进可见正文。 */
const THINKING_TAGS = [
  'thinking', 'think', 'thought', 'thoughts', 'thinking_rules', 'think_rules',
  'cot', 'ecot', 'analysis', 'reasoning', 'reason',
  '思考', '思索', '推理', '分析', '内心分析', '自言自语', '小思考', '大思考',
  '前置小思考', '前置思考', '开始前置小思考', '开始大思考', 'seeds', 'seed',
];

/** 摘要类外壳：内容并入 continuation.summary。 */
const SUMMARY_TAGS = ['meow_fm', 'fm', 'summary', 'recap', '摘要', '短期记忆', '记忆'];

/** 面板类外壳：内容变成独立的 system 块（玩家可见的面板）。 */
const PANEL_TAGS = [
  'char_date', 'chara_date', 'status', 'statusbar', 'status_bar', 'panel',
  '状态栏', '状态面板', '面板', '角色表', '角色表格', '表格', '八维', '数据面板',
  'variablecheck', 'variable_check', 'details',
];

/**
 * 元信息类外壳（2026-10-03 用户实测）：免责声明 / 破限声明 / OOC 说明 —— **整块丢弃**。
 *
 * 现场：正文里出现了 `<disclaimer>`，里面套着 `<boundlessroleplay>` 与
 * `<sacredartisticvision>` 两大段英文声明。它们既不是故事，也不是玩家要看的面板。
 */
const META_TAGS = [
  'disclaimer', 'boundlessroleplay', 'sacredartisticvision', 'sacred_artistic_vision',
  'ooc', 'meta', 'note', 'notice', 'system_note', 'systemprompt', 'system_prompt',
  'jailbreak', 'unfiltered', 'legalnotice', 'legal_notice',
  '免责声明', '声明', '创作声明', '破限', '越狱', '元信息', '作者的话',
];

/** 包裹类外壳：只拆标签，保留内部故事文本。 */
const WRAPPER_TAGS = ['content', 'body', 'text', 'answer', 'reply', '正文', '内容', '故事正文', '回答'];

const ALL_SHELL_TAGS = [...THINKING_TAGS, ...SUMMARY_TAGS, ...PANEL_TAGS, ...META_TAGS, ...WRAPPER_TAGS];

function escapeRegExp(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const TAG_GROUP = [...new Set(ALL_SHELL_TAGS)].map(escapeRegExp).join('|');
const THINKING_GROUP = [...new Set(THINKING_TAGS)].map(escapeRegExp).join('|');
const SUMMARY_GROUP = [...new Set(SUMMARY_TAGS)].map(escapeRegExp).join('|');
const PANEL_GROUP = [...new Set(PANEL_TAGS)].map(escapeRegExp).join('|');
const META_GROUP = [...new Set(META_TAGS)].map(escapeRegExp).join('|');
const WRAPPER_GROUP = [...new Set(WRAPPER_TAGS)].map(escapeRegExp).join('|');

/** 收集闭合块的内容并从文本中移除。返回移除后的文本与收集到的内容。 */
function takeClosedBlocks(
  text: string,
  group: string,
  removed: Set<string>,
): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const pattern = new RegExp(`<\\s*(${group})\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*\\1\\s*>`, 'gi');
  const next = text.replace(pattern, (_match, tag: string, inner: string) => {
    removed.add(String(tag).toLowerCase());
    const content = (inner ?? '').trim();
    if (content) blocks.push(content);
    return '\n';
  });
  return { text: next, blocks };
}

/**
 * 过滤一段故事块文本（或流式预览文本）。
 *
 * 顺序很关键：先摘思维链（它可能包住摘要/面板），再摘摘要与面板，最后拆包裹标签。
 */
export function filterStoryTextShell(input: string): ShellFilterResult {
  const removed = new Set<string>();
  let text = input ?? '';
  if (!text) return { text: '', thinking: '', summary: '', panels: [], meta: [], removedTags: [] };

  const thinkingBlocks: string[] = [];

  // 1. ECoT 注释段：`<!-- Start the ECoT -->` 之后若紧跟 `<thinking>…</thinking>`，由第 2 步处理；
  //    注释本身永远不是故事文本，直接摘掉（含 seeds 提示注释）。
  text = text.replace(/<!--[\s\S]*?-->/gu, '\n');

  // 2. 思维链闭合块
  const closedThinking = takeClosedBlocks(text, THINKING_GROUP, removed);
  text = closedThinking.text;
  thinkingBlocks.push(...closedThinking.blocks);

  // 3. 未闭合的思维链：预设把它放在最前面，因此从开标签摘到块尾。
  //    若摘完没有剩余文本，交给调用方丢弃整块（不还原，避免思维链漏进正文）。
  const unclosedThinking = new RegExp(`^\\s*<\\s*(?:${THINKING_GROUP})\\b[^>]*>[\\s\\S]*$`, 'iu');
  if (unclosedThinking.test(text)) {
    const matched = text.match(new RegExp(`<\\s*(${THINKING_GROUP})\\b[^>]*>`, 'iu'));
    if (matched?.[1]) removed.add(matched[1].toLowerCase());
    const inner = text.replace(new RegExp(`^\\s*<\\s*(?:${THINKING_GROUP})\\b[^>]*>`, 'iu'), '');
    const cleaned = inner.replace(new RegExp(`<\\s*\\/\\s*(?:${THINKING_GROUP})\\s*>`, 'giu'), '').trim();
    if (cleaned) thinkingBlocks.push(cleaned);
    text = '';
  }

  // 4. 孤立的思维链标签/自闭合标签
  text = text
    .replace(new RegExp(`<\\s*\\/\\s*(?:${THINKING_GROUP})\\s*>`, 'giu'), '\n')
    .replace(new RegExp(`<\\s*(?:${THINKING_GROUP})\\b[^>]*\\/\\s*>`, 'giu'), '\n')
    .replace(new RegExp(`^\\s*<\\s*(?:${THINKING_GROUP})\\b[^>]*>\\s*$`, 'gimu'), '\n');

  // 5. 摘要与面板
  const closedSummary = takeClosedBlocks(text, SUMMARY_GROUP, removed);
  text = closedSummary.text;
  const closedPanels = takeClosedBlocks(text, PANEL_GROUP, removed);
  text = closedPanels.text;

  // 5b. 元信息类（免责声明 / 破限声明 / OOC 说明）：整块丢弃，只留诊断痕迹。
  //     先于面板处理：`<disclaimer>` 里常套着 `<boundlessroleplay>` 等子块。
  const closedMeta = takeClosedBlocks(text, META_GROUP, removed);
  text = closedMeta.text;
  const metaBlocks = [...closedMeta.blocks];
  // 未闭合的元信息块（位于块首时按「到块尾」处理）
  {
    const headRe = new RegExp(`^\\s*<\\s*(?:${META_GROUP})\\b[^>]*>`, 'iu');
    const match = text.match(headRe);
    if (match) {
      const tagMatch = match[0].match(/<\s*([^\s/>]+)/u);
      if (tagMatch?.[1]) removed.add(tagMatch[1].toLowerCase());
      const inner = text.slice(match[0].length)
        .replace(new RegExp(`<\\s*\\/\\s*(?:${META_GROUP})\\s*>`, 'giu'), '')
        .trim();
      if (inner) metaBlocks.push(inner);
      text = '';
    }
  }

  // 6. 面板/摘要的孤立开标签（未闭合且位于块首）：面板按「到块尾」处理，摘要同理。
  const takeUnclosedAtHead = (group: string, bucket: string[]): void => {
    const headRe = new RegExp(`^\\s*<\\s*(?:${group})\\b[^>]*>`, 'iu');
    const match = text.match(headRe);
    if (!match) return;
    const tagMatch = match[0].match(/<\s*([^\s/>]+)/u);
    if (tagMatch?.[1]) removed.add(tagMatch[1].toLowerCase());
    const inner = text.slice(match[0].length).replace(new RegExp(`<\\s*\\/\\s*(?:${group})\\s*>`, 'giu'), '').trim();
    if (inner) bucket.push(inner);
    text = '';
  };
  takeUnclosedAtHead(PANEL_GROUP, closedPanels.blocks);
  takeUnclosedAtHead(SUMMARY_GROUP, closedSummary.blocks);

  // 7. 包裹标签只拆壳，保留故事文本
  const wrapperRe = new RegExp(`<\\s*\\/?\\s*(${WRAPPER_GROUP})\\s*>`, 'giu');
  const hadWrapper = new RegExp(`<\\s*\\/?\\s*(?:${WRAPPER_GROUP})\\s*>`, 'iu').test(text);
  if (hadWrapper) {
    text = text.replace(wrapperRe, (_match, tag: string) => {
      removed.add(String(tag).toLowerCase());
      return '\n';
    });
  }

  // 8. 兜底：清掉其它已知外壳标签的残留（成对标签已处理，这里只清孤立标签）
  text = text.replace(new RegExp(`<\\s*\\/?\\s*(?:${TAG_GROUP})\\b[^>]*>`, 'giu'), '\n');

  return {
    text: text.replace(/\n{3,}/gu, '\n\n').trim(),
    thinking: thinkingBlocks.join('\n\n').trim(),
    summary: closedSummary.blocks.join('\n\n').trim(),
    panels: closedPanels.blocks.map((item) => item.trim()).filter(Boolean),
    meta: metaBlocks.map((item) => item.trim()).filter(Boolean),
    removedTags: [...removed],
  };
}

/**
 * 只摘掉「绝不能出现在可见正文里」的外壳 —— 思维链与元信息/声明，
 * 面板与摘要文本原样留在原地。
 *
 * 渲染层（含**已经存进存档的旧消息**）用这个：面板是预设要求可见的状态信息，
 * 而 `<thinking>`/`<disclaimer>` 这类幕后文本任何时候都不该被玩家读到。
 */
export function stripNonDisplayableShell(input: string): string {
  let text = input ?? '';
  if (!text) return '';
  const removed = new Set<string>();
  text = text.replace(/<!--[\s\S]*?-->/gu, '\n');
  text = takeClosedBlocks(text, THINKING_GROUP, removed).text;
  text = takeClosedBlocks(text, META_GROUP, removed).text;
  // 未闭合且位于块首的思维链/元信息：按「到块尾」处理（它们总是写在开头）
  const headRe = new RegExp(`^\\s*<\\s*(?:${THINKING_GROUP}|${META_GROUP})\\b[^>]*>[\\s\\S]*$`, 'iu');
  if (headRe.test(text)) {
    return '';
  }
  text = text.replace(new RegExp(`<\\s*\\/?\\s*(?:${THINKING_GROUP}|${META_GROUP})\\b[^>]*>`, 'giu'), '\n');
  return text.replace(/\n{3,}/gu, '\n\n').trim();
}

/**
 * 过滤整个 NarrativeTurn：正文只保留故事，外壳按类别归位。
 * `panels` 会变成独立的 `system` 块（预设要求它们可见），且不会与原文重复。
 */
export function filterNarrativeTurnShell(turn: NarrativeTurn): NarrativeShellFilterResult {
  const thinkingParts: string[] = [];
  const summaryParts: string[] = [];
  const panels: string[] = [];
  const metaBlocks: string[] = [];
  const removed = new Set<string>();
  const blocks: StoryBlock[] = [];

  for (const block of turn.body) {
    const result = filterStoryTextShell(block.text);
    result.removedTags.forEach((tag) => removed.add(tag));
    if (result.thinking) thinkingParts.push(result.thinking);
    if (result.summary) summaryParts.push(result.summary);
    panels.push(...result.panels);
    metaBlocks.push(...result.meta);
    const text = result.text.trim();
    if (!text) continue;
    blocks.push(text === block.text ? block : { ...block, text });
  }

  for (const panel of panels) {
    if (!panel.trim()) continue;
    blocks.push({ kind: 'system', text: panel });
  }

  const shellSummary = summaryParts.join('\n\n').trim();
  const currentSummary = turn.continuation.summary.trim();
  const continuation = shellSummary && (!currentSummary || shellSummary.length > currentSummary.length)
    ? { ...turn.continuation, summary: shellSummary }
    : turn.continuation;

  const thinking = thinkingParts.join('\n\n').trim();
  return {
    turn: { ...turn, body: blocks, continuation },
    thinking,
    summary: shellSummary,
    panels,
    meta: metaBlocks,
    removedTags: [...removed],
    thinkingChars: [...thinking].length,
  };
}
