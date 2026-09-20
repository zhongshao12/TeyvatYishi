import type { IrminsulEntry, IrminsulMemory } from '@/models/teyvat/irminsul';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { buildRetrievalQueryProfile, scoreRetrievalCandidate } from '@/services/retrievalScoring';

export function buildIrminsulRecallPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'irminsulRecall');
}

function searchableText(entry: IrminsulEntry): string {
  return [entry.title, entry.summary, entry.sourceText, ...entry.keywords].join('\n').toLocaleLowerCase();
}

export function retrieveIrminsulEntries(memory: IrminsulMemory, query: string, limit = 8): IrminsulEntry[] {
  const profile = buildRetrievalQueryProfile(query);
  if (!profile) return [];
  return memory.entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreRetrievalCandidate(
        profile,
        searchableText(entry),
        [entry.title, ...entry.keywords],
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, Math.trunc(limit) || 0))
    .map(({ entry }) => ({ ...entry, sourceTurns: [...entry.sourceTurns], keywords: [...entry.keywords] }));
}
