import type { IrminsulEntry, IrminsulMemory } from '@/models/teyvat/irminsul';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';

export function buildIrminsulRecallPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'irminsulRecall');
}

function searchableText(entry: IrminsulEntry): string {
  return [entry.title, entry.summary, entry.sourceText, ...entry.keywords].join('\n').toLocaleLowerCase();
}

export function retrieveIrminsulEntries(memory: IrminsulMemory, query: string, limit = 8): IrminsulEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) return [];
  return memory.entries
    .filter((entry) => terms.every((term) => searchableText(entry).includes(term)))
    .slice(0, Math.max(0, Math.trunc(limit) || 0))
    .map((entry) => ({ ...entry, sourceTurns: [...entry.sourceTurns], keywords: [...entry.keywords] }));
}
