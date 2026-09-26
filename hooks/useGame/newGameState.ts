import { applyLegacyGameStateOverrides } from '@/hooks/useGameState';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { createEmptyTeyvatGameState, type ArchiveCodex, type TeyvatGameState } from '@/models/teyvat';
import type { 世界状态 } from '@/models/world';

export interface NewGameStateInput {
  traveler: 角色数据结构;
  world: 世界状态;
  initialNpcs: NPC记录[];
  storyWeaving: 剧情编织系统;
  codexCatalog: ArchiveCodex;
}

/** A new game never uses an existing run as its base, even if names match. */
export function buildNewGameState(input: NewGameStateInput): TeyvatGameState {
  const game = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), {
    旅人: input.traveler,
    世界: input.world,
    NPC: input.initialNpcs,
    剧情编织: input.storyWeaving,
    turnCount: 1,
  });

  return {
    ...game,
    图鉴: {
      entries: input.codexCatalog.entries.map((entry) => ({
        ...entry,
        unlockedAtTurn: 0,
        tags: [...entry.tags],
        keywords: [...entry.keywords],
        triggerKeywords: [...entry.triggerKeywords],
        relatedEntryIds: [...entry.relatedEntryIds],
        injection: { ...entry.injection },
        usage: { ...entry.usage },
        runtimeUnlock: { ...entry.runtimeUnlock, status: '', note: '' },
      })),
      unlockedEntryIds: [],
    },
  };
}
