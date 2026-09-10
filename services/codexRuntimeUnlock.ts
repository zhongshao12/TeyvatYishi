import type { 剧情编织历史归档, 剧情编织系统 } from '@/models/storyWeaving';
import { 归一化剧情编织系统 } from '@/models/storyWeaving';
import { normalizeArchiveCodex, type ArchiveCodex, type CodexEntry } from '@/models/teyvat/codex';

export interface CodexRuntimeUnlockResult {
  codex: ArchiveCodex;
  changed: boolean;
  unlocked: Array<{ id: string; name: string; status: string; reason: string }>;
}

export function applyStoryArchiveCodexRuntimeUnlock(params: { codex: ArchiveCodex; storyWeaving: 剧情编织系统 | undefined }): CodexRuntimeUnlockResult {
  const codex = normalizeArchiveCodex(params.codex);
  const archives = 归一化剧情编织系统(params.storyWeaving).当前进度?.历史归档 ?? [];
  if (!codex.entries.length || !archives.length) return { codex, changed: false, unlocked: [] };
  const unlocked: CodexRuntimeUnlockResult['unlocked'] = [];
  const entries = codex.entries.map((entry) => {
    const archive = findMatchingArchive(entry, archives);
    if (!archive || isAlreadyOpen(entry.runtimeUnlock.status) || isManualOnly(entry.runtimeUnlock)) return entry;
    const reason = `剧情编织归档「${archive.分段标题}」命中图鉴解锁条件。`;
    unlocked.push({ id: entry.id, name: entry.name, status: 'unlocked', reason });
    return { ...entry, runtimeUnlock: { ...entry.runtimeUnlock, status: 'unlocked', note: reason }, updatedAt: Date.now() };
  });
  if (!unlocked.length) return { codex, changed: false, unlocked };
  const unlockedEntryIds = Array.from(new Set([...codex.unlockedEntryIds, ...unlocked.map((item) => item.id)]));
  return { codex: normalizeArchiveCodex({ entries, unlockedEntryIds }), changed: true, unlocked };
}

function findMatchingArchive(entry: CodexEntry, archives: 剧情编织历史归档[]): 剧情编织历史归档 | undefined {
  const condition = normalizeText(entry.runtimeUnlock.condition);
  if (!condition || condition.length < 3) return undefined;
  const tokens = condition.split(/[，,。；;、\n\r\s]+/u).map(normalizeText).filter((item) => item.length >= 3);
  return archives.find((archive) => {
    const text = normalizeComparable([archive.分段ID, archive.分段标题, archive.摘要, archive.切换说明, ...(archive.角色推进摘要 ?? []), ...(archive.判定理由 ?? [])].filter(Boolean).join('\n'));
    return tokens.some((token) => text.includes(normalizeComparable(token)));
  });
}

function isAlreadyOpen(status: string): boolean {
  return new Set(['unlocked', 'available', '已解锁', '可用']).has(normalizeText(status).toLowerCase());
}

function isManualOnly(unlock: CodexEntry['runtimeUnlock']): boolean {
  return /manual|手动|只读/i.test(`${unlock.status} ${unlock.note} ${unlock.condition ?? ''}`);
}

function normalizeText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function normalizeComparable(value: string): string { return value.toLowerCase().replace(/[\s"'“”‘’《》「」『』【】\[\]（）()·\-_:：,，。；;、/\\|]+/gu, ''); }
