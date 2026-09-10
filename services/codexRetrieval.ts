import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';

export function buildCodexPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'codex');
}

export interface CodexRetrievalResult {
  entries: CodexEntry[];
  injection: string;
}

function matches(entry: CodexEntry, query: string): boolean {
  const source = [entry.name, entry.category, entry.description, entry.summary, ...entry.tags, ...entry.keywords, ...entry.triggerKeywords].join('\n').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean).every((term) => source.includes(term));
}

function copyEntry(entry: CodexEntry): CodexEntry {
  return { ...entry, tags: [...entry.tags], keywords: [...entry.keywords], triggerKeywords: [...entry.triggerKeywords], relatedEntryIds: [...entry.relatedEntryIds], injection: { ...entry.injection }, runtimeUnlock: { ...entry.runtimeUnlock }, usage: { ...entry.usage } };
}

export function buildCodexEntryInjectionPreview(entry: CodexEntry): string {
  return entry.injection.publicText || entry.injection.facts || entry.summary || entry.description;
}

export function retrieveCodexEntries(codex: ArchiveCodex, query: string, limit = 5): CodexRetrievalResult {
  const entries = codex.entries
    .filter((entry) => codex.unlockedEntryIds.includes(entry.id) || entry.runtimeUnlock.status === 'unlocked')
    .filter((entry) => matches(entry, query))
    .slice(0, Math.max(0, Math.trunc(limit) || 0))
    .map(copyEntry);
  return { entries, injection: entries.map(buildCodexEntryInjectionPreview).filter(Boolean).join('\n\n') };
}
