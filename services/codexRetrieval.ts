import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { buildRetrievalQueryProfile, scoreRetrievalCandidate } from '@/services/retrievalScoring';

export function buildCodexPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'codex');
}

export interface CodexRetrievalResult {
  entries: CodexEntry[];
  injection: string;
}

function searchableText(entry: CodexEntry): string {
  return [entry.name, entry.category, entry.description, entry.summary, entry.sourceText, ...entry.tags, ...entry.keywords, ...entry.triggerKeywords].join('\n');
}

function copyEntry(entry: CodexEntry): CodexEntry {
  return { ...entry, tags: [...entry.tags], keywords: [...entry.keywords], triggerKeywords: [...entry.triggerKeywords], relatedEntryIds: [...entry.relatedEntryIds], injection: { ...entry.injection }, runtimeUnlock: { ...entry.runtimeUnlock }, usage: { ...entry.usage } };
}

export function buildCodexEntryInjectionPreview(entry: CodexEntry): string {
  return entry.injection.publicText || entry.injection.facts || entry.summary || entry.description;
}

/** Author reference access does not grant any character in-world knowledge. */
export function formatCodexRecallInjection(entries: readonly CodexEntry[]): string {
  const content = entries.map(buildCodexEntryInjectionPreview).filter(Boolean).join('\n\n');
  return content ? `【图鉴写作参考，不是 NPC 已知信息】\n只用于校准世界设定、外貌和人设。NPC 仍只知道亲历、被直接告知或确认公开获知的事实；未到场人物不能凭图鉴出现，未发生剧情不能当作已发生。\n${content}` : '';
}

export function retrieveCodexEntries(codex: ArchiveCodex, query: string, limit = 5): CodexRetrievalResult {
  const profile = buildRetrievalQueryProfile(query);
  if (!profile) return { entries: [], injection: '' };
  const entries = codex.entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreRetrievalCandidate(
        profile,
        searchableText(entry),
        [entry.name, ...entry.tags, ...entry.keywords, ...entry.triggerKeywords],
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, Math.trunc(limit) || 0))
    .map(({ entry }) => copyEntry(entry));
  return { entries, injection: formatCodexRecallInjection(entries) };
}
