import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { buildCodexEntryInjectionPreview } from '@/services/codexRetrieval';
import type { NPC记录 } from '@/models/npc';
import { canRevealNpcMeasurements, canRevealNpcRecordMeasurements, NPC_APPEARANCE_KEYS, npcAppearanceSourceLabel } from '@/services/npcAppearanceFacts';
import { readImageCharacterFacts, type ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { omitNpcAppearanceMeasurements, reconcileNpcAppearance, reconcileNpcAppearanceParagraphs } from '@/utils/npcAppearanceReconciliation';
import { matchesNpcCodexIdentity } from '@/utils/npcCodexIdentity';

export interface CodexArchiveItem {
  id: string;
  category: string;
  name: string;
  summary: string;
  injectionPreview: string;
  unlocked: boolean;
  readable: boolean;
  entry: CodexEntry;
  characterFacts?: ImageCharacterFacts;
  searchText: string;
}

function publicCharacterProjection(entry: CodexEntry, npc: NPC记录 | undefined): { entry: CodexEntry; characterFacts?: ImageCharacterFacts } {
  const characterFacts = npc ? readImageCharacterFacts(npc) : undefined;
  const permittedMeasurements = npc ? canRevealNpcRecordMeasurements(npc) : canRevealNpcMeasurements({ name: entry.name, description: [entry.summary, entry.description].join(' ') });
  const publicText = (text: string) => permittedMeasurements ? text : omitNpcAppearanceMeasurements(text);
  // Summary and description may also narrate other people; only labeled appearance sections establish subject scope.
  const projectMixedText = (text: string) => reconcileNpcAppearanceParagraphs(publicText(text), characterFacts?.appearanceDetails, 'mixed');
  return {
    characterFacts,
    entry: { ...entry, summary: projectMixedText(entry.summary), description: projectMixedText(entry.description), sourceText: projectMixedText(entry.sourceText),
      tags: entry.tags.map(publicText).filter(Boolean), keywords: entry.keywords.map(publicText).filter(Boolean), triggerKeywords: entry.triggerKeywords.map(publicText).filter(Boolean),
      injection: Object.fromEntries(Object.entries(entry.injection).map(([key, value]) => [key, typeof value !== 'string' || key === 'type' ? value
        : key === 'appearanceAnchor' ? reconcileNpcAppearance(publicText(value), characterFacts?.appearanceDetails)
          : key === 'publicText' ? projectMixedText(value) : publicText(value)])),
    },
  };
}

export function buildCodexArchiveItems(codex: ArchiveCodex, npcRecords: readonly NPC记录[] = []): CodexArchiveItem[] {
  return codex.entries.map((entry: CodexEntry) => {
    const unlocked = codex.unlockedEntryIds.includes(entry.id) || entry.runtimeUnlock.status === 'unlocked';
    const readable = unlocked || entry.category === 'character';
    const projection = entry.category === 'character' ? publicCharacterProjection(entry, npcRecords.find(npc => matchesNpcCodexIdentity(npc, entry))) : { entry };
    const visible = projection.entry;
    const details = NPC_APPEARANCE_KEYS.flatMap(key => {
      const fact = projection.characterFacts?.appearanceDetails?.[key];
      return fact ? [`${key} ${fact.value} ${npcAppearanceSourceLabel(fact.source)}`] : [];
    });
    return { id: entry.id, category: entry.category, name: entry.name,
      summary: readable ? visible.summary : '', injectionPreview: readable ? buildCodexEntryInjectionPreview(visible) : '', unlocked, readable,
      ...projection,
      searchText: (readable ? [visible.name, visible.category, visible.summary, visible.description, visible.sourceText, visible.source,
        ...visible.tags, ...visible.keywords, ...visible.triggerKeywords, ...Object.values(visible.injection),
        projection.characterFacts?.appearance, projection.characterFacts?.outfit, ...details] : [entry.name, entry.category]).filter(Boolean).join('\n'),
    };
  });
}
