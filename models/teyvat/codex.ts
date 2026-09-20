export interface CodexEntry {
  id: string;
  category: string;
  name: string;
  description: string;
  unlockedAtTurn: number;
  tags: string[];
  summary: string;
  sourceText: string;
  source: string;
  keywords: string[];
  triggerKeywords: string[];
  injection: CodexInjection;
  runtimeUnlock: { status: string; note: string; condition?: string };
  usage: { narrative: boolean; courier: boolean; steambird: boolean; variables: boolean };
  relatedEntryIds: string[];
  importance: number;
  linkable: boolean;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CodexInjection {
  publicText?: string;
  type?: 'character' | 'lore';
  identityAndFaction?: string;
  personalityAndBehavior?: string;
  speechStyle?: string;
  dialogueSamples?: string;
  appearanceAnchor?: string;
  currentFormAndLimits?: string;
  conciseStory?: string;
  portrayalBoundaries?: string;
  definition?: string;
  facts?: string;
  narrativeUse?: string;
  boundaries?: string;
}

export interface ArchiveCodex {
  entries: CodexEntry[];
  unlockedEntryIds: string[];
}

export const MAX_CODEX_ENTRIES = 1200;

export function createEmptyArchiveCodex(): ArchiveCodex {
  return { entries: [], unlockedEntryIds: [] };
}

export function normalizeArchiveCodex(input: unknown): ArchiveCodex {
  const raw = isRecord(input) ? input : {};
  const normalizedEntries: CodexEntry[] = Array.isArray(raw.entries) ? raw.entries.flatMap((value): CodexEntry[] => {
    if (!isRecord(value)) return [];
    const unlock = isRecord(value.runtimeUnlock) ? value.runtimeUnlock : {};
    const usage = isRecord(value.usage) ? value.usage : {};
    return [{
      id: String(value.id ?? ''), category: String(value.category ?? ''), name: String(value.name ?? ''),
      description: String(value.description ?? ''), unlockedAtTurn: Math.max(0, Math.trunc(Number(value.unlockedAtTurn) || 0)),
      tags: Array.isArray(value.tags) ? value.tags.map(String) : [], summary: String(value.summary ?? ''),
      sourceText: String(value.sourceText ?? ''), source: String(value.source ?? ''),
      keywords: Array.isArray(value.keywords) ? value.keywords.map(String) : [],
      triggerKeywords: Array.isArray(value.triggerKeywords) ? value.triggerKeywords.map(String) : [],
      injection: isRecord(value.injection) ? {
        ...(typeof value.injection.publicText === 'string' ? { publicText: value.injection.publicText } : {}),
        ...(value.injection.type === 'character' || value.injection.type === 'lore' ? { type: value.injection.type } : {}),
        ...(typeof value.injection.identityAndFaction === 'string' ? { identityAndFaction: value.injection.identityAndFaction } : {}),
        ...(typeof value.injection.personalityAndBehavior === 'string' ? { personalityAndBehavior: value.injection.personalityAndBehavior } : {}),
        ...(typeof value.injection.speechStyle === 'string' ? { speechStyle: value.injection.speechStyle } : {}),
        ...(typeof value.injection.dialogueSamples === 'string' ? { dialogueSamples: value.injection.dialogueSamples } : {}),
        ...(typeof value.injection.appearanceAnchor === 'string' ? { appearanceAnchor: value.injection.appearanceAnchor } : {}),
        ...(typeof value.injection.currentFormAndLimits === 'string' ? { currentFormAndLimits: value.injection.currentFormAndLimits } : {}),
        ...(typeof value.injection.conciseStory === 'string' ? { conciseStory: value.injection.conciseStory } : {}),
        ...(typeof value.injection.portrayalBoundaries === 'string' ? { portrayalBoundaries: value.injection.portrayalBoundaries } : {}),
        ...(typeof value.injection.definition === 'string' ? { definition: value.injection.definition } : {}),
        ...(typeof value.injection.facts === 'string' ? { facts: value.injection.facts } : {}),
        ...(typeof value.injection.narrativeUse === 'string' ? { narrativeUse: value.injection.narrativeUse } : {}),
        ...(typeof value.injection.boundaries === 'string' ? { boundaries: value.injection.boundaries } : {}),
      } : {},
      runtimeUnlock: {
        status: String(unlock.status ?? ''), note: String(unlock.note ?? ''),
        ...(unlock.condition ? { condition: String(unlock.condition) } : {}),
      },
      usage: { narrative: usage.narrative === true, courier: usage.courier === true, steambird: (usage.steambird ?? usage.news) === true, variables: usage.variables === true },
      relatedEntryIds: Array.isArray(value.relatedEntryIds) ? value.relatedEntryIds.map(String) : [],
      importance: Number(value.importance) || 0, linkable: value.linkable === true, builtin: value.builtin === true,
      createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0,
    }];
  }) : [];
  const entries = retainBoundedCodexEntries(normalizedEntries);
  const retainedIds = new Set(entries.map((entry) => entry.id));
  return {
    entries,
    unlockedEntryIds: Array.isArray(raw.unlockedEntryIds) ? raw.unlockedEntryIds.map(String).filter((id) => retainedIds.has(id)) : [],
  };
}

function retainBoundedCodexEntries(entries: CodexEntry[]): CodexEntry[] {
  if (entries.length <= MAX_CODEX_ENTRIES) return entries;
  const builtins = entries.filter((entry) => entry.builtin).slice(-MAX_CODEX_ENTRIES);
  const customSlots = MAX_CODEX_ENTRIES - builtins.length;
  const selected = new Set<CodexEntry>([
    ...builtins,
    ...(customSlots > 0 ? entries.filter((entry) => !entry.builtin).slice(-customSlots) : []),
  ]);
  return entries.filter((entry) => selected.has(entry));
}
import { isRecord } from '@/utils/valueGuards';
