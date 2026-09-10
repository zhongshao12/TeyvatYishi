import { normalizeIrminsulMemory, type IrminsulEntry } from '@/models/teyvat/irminsul';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';

export function buildIrminsulArchivePromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'irminsulArchive', { category: 'format' });
}

export function buildIrminsulArchiveEntry(input: unknown): IrminsulEntry {
  return normalizeIrminsulMemory({ entries: [input] }).entries[0] ?? {
    id: '', title: '', summary: '', sourceTurns: [], keywords: [], recordedAt: '', archiveType: 'short', sourceText: '', turn: 0,
  };
}
