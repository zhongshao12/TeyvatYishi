import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录 } from '@/models/npc';

const BLOCKED_CANONICAL_NAMES = new Set(['派蒙', '七七', '可莉', '瑶瑶', '早柚']);
/**
 * 对象词（机械 / 人偶 / 投影 …）。
 *
 * 2026-10-03 玩家要求：「把角色琴从非成人、机械或非人形对象屏蔽规则中移除」。
 * 起因是旧实现把这串词**无差别地扫过 姓名+别名+介绍+外貌+备注**，于是
 * 「常年讨伐**魔物**」「**机械**地处理公文」「西风骑士团**机关**」这类职责/比喻/机构用法
 * 都会把一名原著成年人类角色整条挡在 NSFW 之外。
 *
 * 现在分三档判定（从严到宽）：
 *  1. 词出现在**姓名/别名**里 → 直接算非人形对象（`普通人偶` 仍被拦）；
 *  2. 词出现在介绍/外貌/备注里 → 只有「自我描述」句式才算（是/为/属于/本体是/被称为/由…制造），
 *     或**对象名词**（人偶/傀儡/机器人/机械造物）且不是比喻用法（像…般 / 如同…一样）；
 *  3. 该角色有**原著成年基线**时，第 2 档整档跳过 —— 原著身份比自由文本里的一个词更可信。
 */
const BLOCKED_IDENTITY_WORD_RE = /(机械造物|机器人|机械|机关造物|机关|傀儡|人偶|投影|怪物|魔物)/i;
/** 只在自由文本里、且带「自我描述」句式时才算数的对象词。 */
const OBJECT_NOUN_GROUP = '机械造物|机器人|机械|机关造物|机关|傀儡|人偶|投影|怪物|魔物';
const SELF_DESCRIPTION_PREFIX =
  '(?:是|为|属于|身为|本身是|本体是|真身是|自称|被称(?:为|作)|叫做|名为|由[^。！？\\n]{0,12}?(?:制造|创造|制作|造出|召唤|改造))';
const BLOCKED_SELF_DESCRIPTION_RE = new RegExp(
  `${SELF_DESCRIPTION_PREFIX}[^。！？\\n]{0,12}?(?:${OBJECT_NOUN_GROUP})`,
  'i',
);
/** 几乎不用于人类的对象名词：出现在自由文本里就算数，除非是明喻（像…般/一样/似的）。 */
const STRICT_OBJECT_NOUN_RE = /(?:像|如同|好似|仿佛|宛如)[^。！？\n]{0,8}?(机械造物|机器人|傀儡|人偶|机械)|(机械造物|机器人|傀儡|人偶)\s*(?:般|一样|似的)|(机械造物|机器人|傀儡|人偶)/i;
const SIMILE_USAGE_RE = /(?:像|如同|好似|仿佛|宛如)[^。！？\n]{0,10}?(?:机械造物|机器人|机械|机关|傀儡|人偶|投影|怪物|魔物)/i;
const ADVERBIAL_USAGE_RE = /(?:机械|机关)\s*(?:地|般|似的|一样)/i;
/**
 * 「受保护角色」的名称级正则：由 BLOCKED_CANONICAL_NAMES 加各自别名生成，避免两处名单漂移。
 * 用于已经混进修饰语的姓名（如「可莉（火花骑士）」）上兜底。
 */
const PROTECTED_NAME_RE = new RegExp(
  [...BLOCKED_CANONICAL_NAMES]
    .flatMap((name) => [name, ...(matchCanonical(name)?.aliases ?? [])])
    .join('|'),
  'i',
);

type NsfwArchiveSubject = Pick<NPC记录, '姓名' | '别名' | '介绍' | '外貌' | '备注'> | undefined;

function identityTexts(subject: NsfwArchiveSubject, fallbackName = ''): string[] {
  return [fallbackName, subject?.姓名, subject?.别名]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .flatMap((value) => value.split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean));
}

/**
 * 命中「非成年 / 受保护原著角色」名单（派蒙、七七、可莉、瑶瑶、早柚）。
 *
 * 与 `getNsfwArchiveBlockReason` 的区别：这里**只看身份名单**，不看介绍/外貌/备注里的自由文本。
 * 亲密事件好感规则要全档位跳过这些角色，用名单判定才能得到可预测的结果
 * （而不是取决于某段 AI 文案里是否碰巧写了「人偶」之类的词）。
 *
 * `fallbackNames` 接受多个候选名（姓名 + 别名），逐个判定：
 *   `matchCanonical` 是整串精确比较，把多个名字 join 成一个字符串会**永远匹配不上**。
 */
export function isProtectedCanonicalNpc(
  subject: NsfwArchiveSubject,
  fallbackNames: string | readonly string[] = '',
): boolean {
  const candidates = (Array.isArray(fallbackNames) ? fallbackNames : [fallbackNames])
    .flatMap((name) => identityTexts(subject, name));
  return candidates.some((name) => {
    if (PROTECTED_NAME_RE.test(name)) return true;
    const canonical = matchCanonical(name)?.name;
    return Boolean(canonical && BLOCKED_CANONICAL_NAMES.has(canonical));
  });
}

/**
 * 「未成年年龄证据」判定。
 *
 * 为什么需要它：`BLOCKED_CANONICAL_NAMES` 只认原著名单，机械/怪物靠 `BLOCKED_SUBJECT_RE`，
 * 而**自定义角色**的年龄只写在介绍/外貌/备注里 —— 于是「十岁的学徒」这类角色会被当成成年，
 * 拿到成年标记 + 处女基线，甚至被性爱事件奖励（第二轮审计 S1）。
 *
 * 词表刻意收窄：**不能**用「少女 / 幼」这类词。
 * 实测原著库里 `少女` 出现在 **17/58** 个成年角色的外貌描述中（安柏、甘雨、刻晴…），
 * 用它当闸门会把她们全部误挡。只认明确表述：
 * - 未成年 / 未满N岁（N ≤ 18）/ 儿童 / 孩童 / 幼童 / 幼儿 / 幼小 / 婴儿 / 襁褓 / 小学 / 初中 / 萝莉
 * - 整词解析的年龄表达式：`数字或中文数字 + 可选「周」+ 岁`，值 < 18 即未成年
 *
 * 2026-10-03（B09）修了两类错：
 * 1. **漏掉「周岁」**：`17周岁`、`十七周岁` 此前完全不命中；
 * 2. **子串误判**：`二十四岁`/`二十七岁` 因含 `十四`/`十七` 被判未成年，把二十多岁的角色挡在门外。
 *    现在改为整词解析（正则从数字开始位置吞掉整个中文数词），不再做任意子串匹配。
 */
const MINOR_AGE_WORDING_RE = /(未成年|未满成年|儿童|孩童|幼童|幼儿|幼小|婴儿|襁褓|小学|初中|萝莉)/u;
/** 「十二三岁」这类区间写法：整段都是未成年。 */
const MINOR_AGE_RANGE_RE = /(?:十二三|十三四|十四五|十五六|十六七|十七八)周?岁/u;

/** 中文数词（年龄用不到「万」以上）。 */
const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CHINESE_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };
const CHINESE_NUMERAL_CLASS = '零〇一二两三四五六七八九十百千';
/** 数字或中文数词 + 可选「周」 + 岁。数字串整体匹配，所以 `117岁` 不会退化成 `17岁`。 */
const AGE_EXPRESSION_RE = new RegExp(
  `(?:([0-9]{1,3})|([${CHINESE_NUMERAL_CLASS}]{1,6}))\\s*周?\\s*岁`,
  'gu',
);
/** 「未满N岁」单独看：N ≤ 18 才算未成年（`未满二十岁` 可能是 19 岁的成年人，不能一律拦）。 */
const UNDER_AGE_RE = new RegExp(
  `未满\\s*(?:([0-9]{1,3})|([${CHINESE_NUMERAL_CLASS}]{1,6}))\\s*周?\\s*岁`,
  'gu',
);

function parseChineseNumeral(text: string): number | null {
  if (!text) return null;
  let section = 0;
  let digit = 0;
  let sawAny = false;
  for (const char of text) {
    const value = CHINESE_DIGITS[char];
    if (value !== undefined) {
      digit = digit === 0 ? value : Math.max(digit, value);
      sawAny = true;
      continue;
    }
    const unit = CHINESE_UNITS[char];
    if (unit === undefined) return null;
    sawAny = true;
    if (unit === 10) {
      section += (digit || 1) * 10;
    } else {
      section = (section + (digit || 1)) * unit;
    }
    digit = 0;
  }
  return sawAny ? section + digit : null;
}

function readAgeValue(digits: string | undefined, chinese: string | undefined): number | null {
  if (digits !== undefined) {
    const value = Number(digits);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const value = parseChineseNumeral(chinese ?? '');
  return value !== null && value > 0 ? value : null;
}

interface AgeExpression {
  raw: string;
  value: number;
}

/** 整词解析文本里的全部年龄表达式（`周岁` / `岁` 都算）。 */
export function parseAgeExpressions(text: string): AgeExpression[] {
  if (!text) return [];
  const found: AgeExpression[] = [];
  for (const match of text.matchAll(new RegExp(AGE_EXPRESSION_RE.source, 'gu'))) {
    const value = readAgeValue(match[1], match[2]);
    if (value === null) continue;
    found.push({ raw: match[0], value });
  }
  return found;
}

/** 文本里是否含「未成年年龄证据」；命中则返回命中的原文片段。 */
function findMinorAgeEvidence(text: string): string | null {
  const wording = text.match(MINOR_AGE_WORDING_RE);
  if (wording) return wording[0];
  const range = text.match(MINOR_AGE_RANGE_RE);
  if (range) return range[0];
  for (const match of text.matchAll(new RegExp(UNDER_AGE_RE.source, 'gu'))) {
    const value = readAgeValue(match[1], match[2]);
    if (value !== null && value <= 18) return match[0];
  }
  const minor = parseAgeExpressions(text).find((age) => age.value < 18);
  return minor ? minor.raw : null;
}

const MINOR_AGE_EVIDENCE_RE = MINOR_AGE_WORDING_RE;

/**
 * 返回「未成年年龄证据」的原因；没有则为 null。
 * 只读**身份与描述文本**，不看会话内容，因此同一个角色每次判定一致。
 */
export function getMinorAgeEvidenceReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
): string | null {
  const displayName = subject?.姓名 || fallbackName || '目标';
  const texts = [
    ...identityTexts(subject, fallbackName),
    subject?.介绍,
    subject?.外貌,
    subject?.备注?.join(' '),
    fallbackText,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  for (const value of texts) {
    const hit = findMinorAgeEvidence(value);
    if (hit) return `${displayName} 的描述里出现未成年年龄证据（${hit.trim().slice(0, 24)}），按未成年处理`;
  }
  return null;
}

/**
 * 返回「明确成年年龄证据」的理由；没有则为 null。
 *
 * 与「年龄未知」严格区分：只有整词解析出 ≥ 18 的年龄、且同一段文本里没有未成年证据时，
 * 才给出这个理由。**未检出未成年词不等于成年已确认** —— 那种情况由调用方按放宽规则处理，
 * 并在理由里如实写成「年龄未知」。
 */
export function getAdultAgeEvidenceReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
): string | null {
  const displayName = subject?.姓名 || fallbackName || '目标';
  const texts = [
    ...identityTexts(subject, fallbackName),
    subject?.介绍,
    subject?.外貌,
    subject?.备注?.join(' '),
    fallbackText,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  for (const value of texts) {
    if (findMinorAgeEvidence(value)) continue;
    const adult = parseAgeExpressions(value).find((age) => age.value >= 18);
    if (adult) return `${displayName} 的描述里出现明确成年年龄（${adult.value} 岁）`;
  }
  return null;
}

export function getNsfwArchiveBlockReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
  options?: { canonicalAdultBaseline?: boolean },
): string | null {
  const names = identityTexts(subject, fallbackName);
  const canonicalName = names.map((name) => matchCanonical(name)?.name).find(Boolean);
  const displayName = subject?.姓名 || fallbackName || '目标';
  // 受保护幼态原著名单：既按原著库匹配，也按名称级正则兜底
  // （`七七` 这类不在原著角色库里的名字同样必须拦住）。
  if ((canonicalName && BLOCKED_CANONICAL_NAMES.has(canonicalName)) || names.some((name) => PROTECTED_NAME_RE.test(name))) {
    return `${displayName} 属于非成人或非人形对象，禁止写入 NSFW 档案`;
  }

  // 自定义角色没有原著名单可依，只能看描述里的年龄证据。
  const minorReason = getMinorAgeEvidenceReason(subject, fallbackName, fallbackText);
  if (minorReason) return `${minorReason}，禁止写入 NSFW 档案`;

  // 第 1 档：姓名/别名本身就是对象词（「普通人偶」「机械投影」）。
  if (names.some((name) => BLOCKED_IDENTITY_WORD_RE.test(name))) {
    return `${displayName} 命中非成人、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }

  // 第 3 档：原著成年基线角色的介绍/外貌/备注一律不再走自由文本词表 ——
  // 「常年讨伐魔物」这类职责描述不再把成年人类角色挡在门外（琴的误伤即此）。
  if (options?.canonicalAdultBaseline) return null;

  const freeText = subject
    ? [subject.介绍, subject.外貌, subject.备注?.join(' ')].filter(Boolean).join(' ')
    : fallbackText;
  if (!freeText) return null;

  // 第 2 档：自由文本里必须带自我描述句式，或出现「几乎不用于人类」的对象名词且不是比喻用法。
  if (BLOCKED_SELF_DESCRIPTION_RE.test(freeText)) {
    return `${displayName} 命中非成人、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }
  const adverbial = ADVERBIAL_USAGE_RE.test(freeText) || SIMILE_USAGE_RE.test(freeText);
  if (!adverbial && STRICT_OBJECT_NOUN_RE.test(freeText)) {
    return `${displayName} 命中非成人、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }
  return null;
}
