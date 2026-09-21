import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录 } from '@/models/npc';

const BLOCKED_CANONICAL_NAMES = new Set(['派蒙', '七七', '可莉', '瑶瑶', '早柚']);
const BLOCKED_SUBJECT_RE = /(派蒙|Paimon|七七|Qiqi|可莉|Klee|瑶瑶|Yaoyao|早柚|Sayu|机械|机关|机器人|机械造物|傀儡|人偶|投影|怪物|魔物)/i;
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
 * - 未成年 / 未满N岁 / 儿童 / 孩童 / 幼童 / 幼儿 / 幼小 / 婴儿 / 襁褓 / 小学 / 初中 / 萝莉
 * - 数字年龄 1-17 岁（用 lookbehind 防止「18岁」被 `8岁` 命中）
 * - 中文年龄 一岁…十八岁
 */
const MINOR_AGE_EVIDENCE_RE = /(未成年|未满[十百千0-9]*[岁周]|未满成年|儿童|孩童|幼童|幼儿|幼小|婴儿|襁褓|小学|初中|萝莉|(?<!\d)(?:[1-9]|1[0-7])\s*岁|(?<![一二三四五六七八九十])[一二三四五六七八九十]岁|十[一二三四五六七]岁|(?:十二三|十三四|十四五|十五六|十六七|十七八)岁)/u;

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
  const hit = texts.find((value) => MINOR_AGE_EVIDENCE_RE.test(value));
  return hit ? `${displayName} 的描述里出现未成年年龄证据（${hit.trim().slice(0, 24)}），按未成年处理` : null;
}

export function getNsfwArchiveBlockReason(
  subject: NsfwArchiveSubject,
  fallbackName = '',
  fallbackText = '',
): string | null {
  const names = identityTexts(subject, fallbackName);
  const canonicalName = names.map((name) => matchCanonical(name)?.name).find(Boolean);
  const displayName = subject?.姓名 || fallbackName || '目标';
  if (canonicalName && BLOCKED_CANONICAL_NAMES.has(canonicalName)) {
    return `${displayName} 属于非成人或非人形对象，禁止写入 NSFW 档案`;
  }

  // 自定义角色没有原著名单可依，只能看描述里的年龄证据。
  const minorReason = getMinorAgeEvidenceReason(subject, fallbackName, fallbackText);
  if (minorReason) return `${minorReason}，禁止写入 NSFW 档案`;

  const haystack = subject
    ? [subject.姓名, subject.别名, subject.介绍, subject.外貌, subject.备注?.join(' ')].filter(Boolean).join(' ')
    : `${fallbackName}\n${fallbackText}`;
  if (BLOCKED_SUBJECT_RE.test(haystack)) {
    return `${displayName} 命中非成人、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }
  return null;
}
