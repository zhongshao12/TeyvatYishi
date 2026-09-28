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
  return codex.entries.map((entry: CodexEntry) => {
    const unlocked = codex.unlockedEntryIds.includes(entry.id) || entry.runtimeUnlock.status === 'unlocked';
    return { id: entry.id, category: entry.category, name: entry.name,
      summary: unlocked ? entry.summary : '', injectionPreview: unlocked ? buildCodexEntryInjectionPreview(entry) : '', unlocked };
  });
}
