import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { buildCodexEntryInjectionPreview } from '@/services/codexRetrieval';

export interface CodexAiCandidate {
  id: string;
  name: string;
  category: string;
  summary: string;
  injectionPreview: string;
}

export interface CodexAiCandidateIndex {
  candidates: CodexAiCandidate[];
  entriesById: Map<string, CodexEntry>;
}

export function buildCodexAiCandidateIndex(codex: ArchiveCodex, entries: readonly CodexEntry[]): CodexAiCandidateIndex {
  const visible = entries.filter((entry) => codex.unlockedEntryIds.includes(entry.id) || entry.runtimeUnlock.status === 'unlocked');
  return {
    candidates: visible.map((entry) => ({ id: entry.id, name: entry.name, category: entry.category, summary: entry.summary, injectionPreview: buildCodexEntryInjectionPreview(entry) })),
    entriesById: new Map(visible.map((entry) => [entry.id, entry])),
  };
}

export function compileCodexAiSelection(index: CodexAiCandidateIndex, input: { selectedIds?: unknown }): { entries: CodexEntry[]; injection: string } {
  const selectedIds = Array.isArray(input.selectedIds) ? input.selectedIds.filter((id): id is string => typeof id === 'string') : [];
  const entries = selectedIds.flatMap((id) => {
    const entry = index.entriesById.get(id);
    return entry ? [{ ...entry, tags: [...entry.tags], keywords: [...entry.keywords], triggerKeywords: [...entry.triggerKeywords], relatedEntryIds: [...entry.relatedEntryIds], injection: { ...entry.injection }, runtimeUnlock: { ...entry.runtimeUnlock }, usage: { ...entry.usage } }] : [];
  });
  return { entries, injection: entries.map(buildCodexEntryInjectionPreview).filter(Boolean).join('\n\n') };
}
