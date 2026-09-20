export interface MainNarrativeValidationInput {
  blank: boolean;
  missingPartyMembers: string[];
  rerollSimilarity: number;
  protocolIssues: string[];
  canRetry: boolean;
}

export type MainNarrativeValidationDecision =
  | { action: 'retry' | 'reject'; kind: 'empty' }
  | { action: 'retry' | 'reject'; kind: 'missing_party'; missingPartyMembers: string[] }
  | { action: 'retry'; kind: 'reroll_similarity'; similarity: number }
  | { action: 'retry'; kind: 'protocol'; protocolIssues: string[] }
  | { action: 'accept'; kind?: undefined; protocolIssues: string[] };

export function decideMainNarrativeValidation(
  input: MainNarrativeValidationInput,
): MainNarrativeValidationDecision {
  if (input.blank) {
    return { action: input.canRetry ? 'retry' : 'reject', kind: 'empty' };
  }
  if (input.missingPartyMembers.length > 0) {
    return {
      action: input.canRetry ? 'retry' : 'reject',
      kind: 'missing_party',
      missingPartyMembers: input.missingPartyMembers,
    };
  }
  if (input.rerollSimilarity >= 0.86 && input.canRetry) {
    return { action: 'retry', kind: 'reroll_similarity', similarity: input.rerollSimilarity };
  }
  if (input.protocolIssues.length > 0 && input.canRetry) {
    return { action: 'retry', kind: 'protocol', protocolIssues: input.protocolIssues };
  }
  return { action: 'accept', protocolIssues: input.protocolIssues };
}
