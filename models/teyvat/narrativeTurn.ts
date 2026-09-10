export const STORY_BLOCK_KINDS = ['narration', 'dialogue', 'system'] as const;
export type StoryBlockKind = typeof STORY_BLOCK_KINDS[number];

export interface StoryBlock {
  kind: StoryBlockKind;
  text: string;
  id?: string;
  speaker?: string;
}

export interface PlayerChoice {
  id: string;
  label: string;
}

export const FACT_CANDIDATE_DOMAINS = [
  'world',
  'character',
  'inventory',
  'quest',
  'relationship',
  'location',
  'time',
  'system',
] as const;
export type FactCandidateDomain = typeof FACT_CANDIDATE_DOMAINS[number];

export interface FactCandidate {
  domain: FactCandidateDomain;
  fact: string;
  /** Exact visible excerpt from one body block. */
  evidence: string;
}

export interface ContinuationSummary {
  summary: string;
  unresolved: string[];
}

export interface NarrativeTurn {
  body: StoryBlock[];
  choices: PlayerChoice[];
  factCandidates: FactCandidate[];
  continuation: ContinuationSummary;
}

export function narrativeTurnBodyText(turn: NarrativeTurn): string {
  return turn.body
    .map((block) => block.kind === 'dialogue' && block.speaker
      ? `【${block.speaker}】${block.text}`
      : block.text)
    .join('\n\n')
    .trim();
}

export function createEmptyNarrativeTurn(): NarrativeTurn {
  return {
    body: [],
    choices: [],
    factCandidates: [],
    continuation: { summary: '', unresolved: [] },
  };
}
