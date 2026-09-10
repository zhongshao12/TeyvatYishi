import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录 } from '@/models/npc';

const BLOCKED_CANONICAL_NAMES = new Set(['派蒙', '七七', '可莉', '瑶瑶', '早柚']);
const BLOCKED_SUBJECT_RE = /(派蒙|Paimon|七七|Qiqi|可莉|Klee|瑶瑶|Yaoyao|早柚|Sayu|机械|机关|机器人|机械造物|傀儡|人偶|投影|怪物|魔物)/i;

type NsfwArchiveSubject = Pick<NPC记录, '姓名' | '别名' | '介绍' | '外貌' | '备注'> | undefined;

function identityTexts(subject: NsfwArchiveSubject, fallbackName = ''): string[] {
  return [fallbackName, subject?.姓名, subject?.别名]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .flatMap((value) => value.split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean));
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
