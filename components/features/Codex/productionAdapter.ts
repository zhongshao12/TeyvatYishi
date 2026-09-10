import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { buildCodexEntryInjectionPreview } from '@/services/codexRetrieval';

export interface CodexArchiveItem {
  id: string;
  category: string;
  name: string;
  summary: string;
  injectionPreview: string;
  unlocked: boolean;
}

export function buildCodexArchiveItems(codex: ArchiveCodex): CodexArchiveItem[] {
  return codex.entries.map((entry: CodexEntry) => ({ id: entry.id, category: entry.category, name: entry.name, summary: entry.summary, injectionPreview: buildCodexEntryInjectionPreview(entry), unlocked: codex.unlockedEntryIds.includes(entry.id) || entry.runtimeUnlock.status === 'unlocked' }));
}
