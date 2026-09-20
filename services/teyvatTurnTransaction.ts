import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import type { FactCandidate } from '@/models/teyvat/narrativeTurn';
import type { TeyvatDomainCommand, TeyvatTurnError } from '@/models/teyvat/domainCommand';
import {
  applyRegisteredTeyvatCommand,
  rebuildTeyvatDomainCommand,
  type TeyvatEvidenceContext,
} from '@/utils/teyvatCommandRegistry';

export interface TeyvatTurnAcceptedResult {
  status: 'accepted';
  nextState: TeyvatGameState;
  commands: TeyvatDomainCommand[];
  errors: [];
}

export interface TeyvatTurnRejectedResult {
  status: 'rejected';
  nextState: TeyvatGameState;
  commands: TeyvatDomainCommand[];
  errors: TeyvatTurnError[];
}

export interface TeyvatTurnCommittedResult extends Omit<TeyvatTurnAcceptedResult, 'status'> {
  status: 'committed';
}

export interface TeyvatTurnCommitFailedResult extends Omit<TeyvatTurnRejectedResult, 'status'> {
  status: 'commit_failed';
}

export type TeyvatTurnTransactionResult =
  | TeyvatTurnAcceptedResult
  | TeyvatTurnRejectedResult
  | TeyvatTurnCommittedResult
  | TeyvatTurnCommitFailedResult;

/** Apply and validate a turn without the expensive whole-root normalization. */
export function preflightTeyvatTurn(
  initial: TeyvatGameState,
  rawCommands: readonly unknown[],
  evidenceContext: TeyvatEvidenceContext = {},
): TeyvatTurnAcceptedResult | TeyvatTurnRejectedResult {
  const commands: TeyvatDomainCommand[] = [];
  const errors: TeyvatTurnError[] = [];
  let cursor = initial;

  rawCommands.forEach((raw, index) => {
    const rebuilt = rebuildTeyvatDomainCommand(raw, index, evidenceContext);
    if (!rebuilt.ok) {
      errors.push(rebuilt.error);
      return;
    }
    commands.push(rebuilt.command);
    const applied = applyRegisteredTeyvatCommand(cursor, rebuilt.command, index);
    if (!applied.ok) {
      errors.push(applied.error);
      return;
    }
    cursor = applied.state;
  });

  if (errors.length) return { status: 'rejected', nextState: initial, commands, errors };
  return { status: 'accepted', nextState: cursor, commands, errors: [] };
}

export function reduceTeyvatTurn(
  initial: TeyvatGameState,
  rawCommands: readonly unknown[],
  evidenceContext: TeyvatEvidenceContext = {},
): TeyvatTurnAcceptedResult | TeyvatTurnRejectedResult {
  const preflight = preflightTeyvatTurn(initial, rawCommands, evidenceContext);
  if (preflight.status === 'rejected') return preflight;
  return { ...preflight, nextState: normalizeTeyvatGameState(preflight.nextState) };
}

export function commitTeyvatTurn(
  initial: TeyvatGameState,
  rawCommands: readonly unknown[],
  replaceGameState: (nextState: TeyvatGameState) => void,
  evidenceContext: TeyvatEvidenceContext = {},
): TeyvatTurnTransactionResult {
  const preflight = preflightTeyvatTurn(initial, rawCommands, evidenceContext);
  if (preflight.status === 'rejected') return preflight;
  return commitPreflightedTeyvatTurn(initial, preflight, replaceGameState);
}

/** Commit a previously accepted preflight without rebuilding and applying its commands a second time. */
export function commitPreflightedTeyvatTurn(
  initial: TeyvatGameState,
  preflight: TeyvatTurnAcceptedResult,
  replaceGameState: (nextState: TeyvatGameState) => void,
): TeyvatTurnTransactionResult {
  const nextState = normalizeTeyvatGameState(preflight.nextState);
  try {
    replaceGameState(nextState);
    return { ...preflight, nextState, status: 'committed' };
  } catch {
    return {
      status: 'commit_failed',
      nextState: initial,
      commands: preflight.commands,
      errors: [{ index: preflight.commands.length, code: 'COMMIT_FAILED' }],
    };
  }
}

export async function runCommittedTurnEffects(input: {
  committedState: TeyvatGameState;
  publicFacts: readonly FactCandidate[];
  runBackground: (state: TeyvatGameState, publicFacts: readonly FactCandidate[]) => Promise<TeyvatGameState>;
  autosave: (state: TeyvatGameState) => Promise<void>;
}): Promise<TeyvatGameState> {
  const backgroundState = await input.runBackground(input.committedState, input.publicFacts);
  await input.autosave(backgroundState);
  return backgroundState;
}
