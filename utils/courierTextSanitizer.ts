/** Phone boundaries deliberately distinguish context facts from spoken output. */
const INTERNAL_LINE = /(?:char_seven|七维关系(?:状态|表)?|变量事实|变量结算|deliverySeed|triggerType|seed\.context|系统提示|提示词|记忆库|主动联系(?:主动)?(?:理由|原因|依据)|initiative(?:_reason| rationale)?|scheduledAtTurn|targetType|targetId|可低频投递|可能会有后续联络|根据记忆生成|(?:time|scene)\s*[:：])/iu;
const NUMERIC_RELATION = /(?:名分|环境|利益|情欲|接受度|经验|好感(?:度)?|信任|尊重|依赖|亲密|欲望|戒备|关系)[\s:=：|]*[-+]?\d+(?:\.\d+)?/u;
const NUMERIC_TABLE_ROW = /^\s*[^。！？!?\n\d]*[-+]?\d+(?:\.\d+)?(?:\s*[|,，\t ]+\s*[-+]?\d+(?:\.\d+)?){6,}\s*\|?\s*$/u;
const RELATION_TABLE_HEADER = /^\s*\|?\s*(?:姓名|角色|名分|环境|利益|情欲|好感(?:度)?|接受度|经验|信任|尊重|依赖|亲密|欲望|戒备)(?:\s*[|,，\t ]+\s*(?:姓名|角色|名分|环境|利益|情欲|好感(?:度)?|接受度|经验|信任|尊重|依赖|亲密|欲望|戒备)){2,}\s*\|?\s*$/u;
const LEDGER_NARRATIVE = /(?:^|[:：])\s*关于(?!我|你)[^，。！？]{0,30}对[^。！？]*(?:印象|好感)|^\s*(?:(?!(?:我|你|他|她))[^，。！？:：]{1,20})?对(?:旅行者|玩家)(?:的)?(?:长期|第一)?印象\s*[:：]|^\s*(?:最近(?:共同经历|互动)|共同经历|未完成事项|未解决冲突|必须记得|禁止遗忘)\s*[:：]|^\s*玩家一行人|^\s*(?!我|你)[^，。！？]{0,20}通过手机(?:与旅行者交谈|发来消息)|^\s*关系(?:有所|得到)(?:提升|进展)/u;

/** Remove entire XML envelopes, including nested bodies; unclosed bodies fail closed. */
function removeXmlEnvelopes(raw: string): string {
  const stack: string[] = [];
  let result = '';
  let cursor = 0;
  const tags = /<\s*(\/?)\s*([\w\u4e00-\u9fff:-]+)(?=[\s/>]|$)[^>]*(?:>|$)/gu;
  for (const match of raw.matchAll(tags)) {
    const before = raw.slice(cursor, match.index);
    if (!stack.length) result += before;
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index);
      else if (!stack.length) {
        // Without an opening boundary, any preceding lines may belong to the
        // internal body. Only text after this closing boundary is recoverable.
        result = '';
      }
    } else if (!/\/\s*>$/u.test(match[0])) stack.push(name);
    cursor = match.index! + match[0].length;
  }
  if (!stack.length) result += raw.slice(cursor);
  return result;
}

/** Keep real role-known ledger facts, but discard machine/scheduling instructions. */
export function sanitizeCourierFactText(raw: string): string {
  const text = removeXmlEnvelopes(raw)
    .replace(/```(?:json|xml|ya?ml)[\s\S]*?(?:```|$)/giu, '')
    .replace(/```(?:\w+)?\s*([\s\S]*?)```/gu, '$1')
    .replace(/(?:^|(?<=[。！？!?\n]))[^。！？!?\n]*Complete\.[ \t]*/gimu, '')
    .replace(/\bComplete\.(?=\s|$)/giu, '')
    .replace(/已发生事实\s*[:：]/gu, '');
  return text.split(/\r?\n/u).flatMap((line) => {
    if (NUMERIC_TABLE_ROW.test(line) || RELATION_TABLE_HEADER.test(line) || /^[\s|:—-]+$/u.test(line)) return [];
    // Metadata sentences can coexist with useful natural sentences on one line.
    return line.split(/(?<=[。！？!?])/u)
      .filter((sentence) => !INTERNAL_LINE.test(sentence) && !NUMERIC_RELATION.test(sentence))
      .join('').trim();
  }).filter(Boolean).join('\n').trim();
}

/** Do not expose ledger narration as a character's own dialogue. */
export function isCourierLedgerFieldText(text: string): boolean {
  return text.split(/\r?\n|(?<=[。！？!?])/u).some((sentence) => LEDGER_NARRATIVE.test(sentence));
}

export function sanitizeCourierMessageText(raw: string): string {
  return sanitizeCourierFactText(raw).split(/\r?\n/u).map((line) => line
    .split(/(?<=[。！？!?])/u)
    .filter((sentence) => !isCourierLedgerFieldText(sentence))
    .join('').trim())
    .filter((line) => line && !/^(?:提醒一声|关于|有件事想告诉你|想起)[:：，…\s]*$/u.test(line))
    .join('\n').trim();
}

/** Non-destructive history view; this placeholder must never enter role memory. */
export function displayCourierMessageText(raw: string): string {
  return sanitizeCourierMessageText(raw) || '消息正文含内部记录，已隐藏。';
}

/** Local templates cannot reliably convert third-person facts into first-person speech. */
export function isCourierLedgerNarrative(text: string, subjectNames: readonly string[] = []): boolean {
  return isCourierLedgerFieldText(text) || /(?:旅行者|玩家)|(?:他|她)(?:们)?(?:曾|已经|近期|最近)/u.test(text)
    || subjectNames.some((name) => Boolean(name.trim()) && text.includes(name.trim()));
}
