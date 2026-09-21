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

  const haystack = subject
    ? [subject.姓名, subject.别名, subject.介绍, subject.外貌, subject.备注?.join(' ')].filter(Boolean).join(' ')
    : `${fallbackName}\n${fallbackText}`;
  if (BLOCKED_SUBJECT_RE.test(haystack)) {
    return `${displayName} 命中非成人、机械或非人形对象屏蔽规则，禁止写入 NSFW 档案`;
  }
  return null;
}
