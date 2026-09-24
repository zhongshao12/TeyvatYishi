import { normalizeNarrativeTurn } from '@/services/ai/narrativeTurnParser';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { normalizeLegacyRecoveryPhase } from '@/compat/legacy-hsr/readOnly';

export type WorkflowRecoveryPhase =
  | 'narrative_received'
  | 'settlement_pending'
  | 'settlement_committed'
  | 'autosave_committed';

export interface WorkflowRecoveryJournal {
  version: 3;
  workflowId: string;
  startedAt: number;
  updatedAt: number;
  input: string;
  turnAtStart: number;
  /** Save-tree node active when this workflow began; null means an unsaved new journey. */
  originSaveTreeNodeId?: string | null;
  phase: WorkflowRecoveryPhase;
  userMessageId?: string;
  assistantMessageId?: string;
  pendingNarrative?: NarrativeTurn;
  pendingSettlement?: {
    settlementId: string;
    source: TeyvatGameState;
    variableDraft?: string;
  };
  /** Exact normalized root after the one settlement commit; durable restart source for the post tail. */
  committedState?: TeyvatGameState;
  phaseStartedAt: number;
}

export const WORKFLOW_RECOVERY_STALE_MS = 4 * 60 * 60 * 1000;

export interface WorkflowHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
}

const VALID_PHASES: readonly WorkflowRecoveryPhase[] = [
  'narrative_received', 'settlement_pending', 'settlement_committed', 'autosave_committed',
];

const HISTORICAL_PHASE_MAP: Readonly<Record<string, WorkflowRecoveryPhase>> = {
  main_request: 'narrative_received',
  variable_settlement: 'settlement_pending',
  steambird: 'settlement_committed',
  memory: 'settlement_committed',
  courier_seed: 'settlement_committed',
  story_weaving: 'settlement_committed',
  image_parse: 'settlement_committed',
  image_generate: 'settlement_committed',
  autosave: 'settlement_committed',
};

function createWorkflowId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `workflow_${uuid}` : `workflow_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkflowRecoveryJournal(input: string, turnAtStart: number, originSaveTreeNodeId?: string | null): WorkflowRecoveryJournal {
  const now = Date.now();
  return {
    version: 3,
    workflowId: createWorkflowId(),
    startedAt: now,
    updatedAt: now,
    input: input.slice(0, 100_000),
    turnAtStart: Math.max(1, Math.trunc(turnAtStart) || 1),
    ...(originSaveTreeNodeId !== undefined ? { originSaveTreeNodeId } : {}),
    phase: 'narrative_received',
    phaseStartedAt: now,
  };
}

function parsePendingNarrative(value: unknown): NarrativeTurn | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeNarrativeTurn(value);
  } catch {
    return undefined;
  }
}

function parsePendingSettlement(value: unknown): WorkflowRecoveryJournal['pendingSettlement'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.settlementId !== 'string' || !raw.settlementId.trim() || raw.source === undefined) return undefined;
  try {
    return {
      settlementId: raw.settlementId.trim(),
      source: normalizeTeyvatGameState(raw.source),
      ...(typeof raw.variableDraft === 'string' ? { variableDraft: raw.variableDraft.slice(0, 100_000) } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseCommittedState(value: unknown): TeyvatGameState | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeTeyvatGameState(value);
  } catch {
    return undefined;
  }
}

export function parseWorkflowRecoveryJournal(value: unknown): WorkflowRecoveryJournal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) return null;
  if (typeof raw.workflowId !== 'string' || !raw.workflowId.trim()) return null;
  if (typeof raw.input !== 'string' || !raw.input.trim() || raw.input.length > 100_000) return null;
  const normalizedPhase = raw.version === 3
    ? raw.phase
    : typeof raw.phase === 'string'
      ? HISTORICAL_PHASE_MAP[raw.phase] ?? normalizeLegacyRecoveryPhase(raw.phase)
      : undefined;
  if (!VALID_PHASES.includes(normalizedPhase as WorkflowRecoveryPhase)) return null;
  const startedAt = Number(raw.startedAt);
  const updatedAt = Number(raw.updatedAt);
  const turnAtStart = Number(raw.turnAtStart);
  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt) || !Number.isFinite(turnAtStart)) return null;
  const pendingNarrative = parsePendingNarrative(raw.pendingNarrative);
  const pendingSettlement = parsePendingSettlement(raw.pendingSettlement);
  const committedState = parseCommittedState(raw.committedState);
  return {
    version: 3,
    workflowId: raw.workflowId,
    startedAt,
    updatedAt,
    input: raw.input,
    turnAtStart: Math.max(1, Math.trunc(turnAtStart)),
    ...(raw.originSaveTreeNodeId === null || typeof raw.originSaveTreeNodeId === 'string'
      ? { originSaveTreeNodeId: raw.originSaveTreeNodeId as string | null }
      : {}),
    phase: normalizedPhase as WorkflowRecoveryPhase,
    userMessageId: typeof raw.userMessageId === 'string' ? raw.userMessageId : undefined,
    assistantMessageId: typeof raw.assistantMessageId === 'string' ? raw.assistantMessageId : undefined,
    ...(pendingNarrative ? { pendingNarrative } : {}),
    ...(pendingSettlement ? { pendingSettlement } : {}),
    ...(committedState ? { committedState } : {}),
    phaseStartedAt: raw.version === 3 && Number.isFinite(Number(raw.phaseStartedAt))
      ? Number(raw.phaseStartedAt)
      : startedAt,
  };
}

export function updateWorkflowRecoveryJournal(
  journal: WorkflowRecoveryJournal,
  patch: Partial<Pick<WorkflowRecoveryJournal, 'phase' | 'userMessageId' | 'assistantMessageId' | 'pendingNarrative' | 'pendingSettlement' | 'committedState'>>,
): WorkflowRecoveryJournal {
  const now = Date.now();
  const changedPhase = patch.phase !== undefined && patch.phase !== journal.phase;
  // These roots are produced by the typed runtime immediately before this
  // call. Re-normalizing the whole save here duplicated the expensive NPC,
  // chat, album and phone traversal on the critical post-turn path. Durable
  // data is still fully normalized by parseWorkflowRecoveryJournal on load.
  const pendingSettlement = patch.pendingSettlement
    ? {
        settlementId: patch.pendingSettlement.settlementId,
        source: patch.pendingSettlement.source,
        ...(patch.pendingSettlement.variableDraft !== undefined
          ? { variableDraft: patch.pendingSettlement.variableDraft.slice(0, 100_000) }
          : {}),
      }
    : undefined;
  return {
    ...journal,
    ...patch,
    ...(patch.pendingNarrative ? { pendingNarrative: normalizeNarrativeTurn(patch.pendingNarrative) } : {}),
    ...(pendingSettlement ? { pendingSettlement } : {}),
    ...(patch.committedState ? { committedState: patch.committedState } : {}),
    updatedAt: now,
    phaseStartedAt: changedPhase ? now : journal.phaseStartedAt,
  };
}

export function isWorkflowRecoveryComplete(
  journal: WorkflowRecoveryJournal,
  history: WorkflowHistoryMessage[],
): boolean {
  void history;
  return journal.phase === 'autosave_committed';
}
