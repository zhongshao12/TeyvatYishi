import { describe, expect, it } from 'vitest';
import { decideMainNarrativeValidation } from '@/services/ai/mainNarrativeValidation';

const valid = {
  blank: false,
  missingPartyMembers: [] as string[],
  rerollSimilarity: 0,
  protocolIssues: [] as string[],
  canRetry: true,
};

describe('main narrative validation decision', () => {
  it('rejects a final blank response instead of accepting it', () => {
    expect(decideMainNarrativeValidation({ ...valid, blank: true, canRetry: false })).toEqual({
      action: 'reject',
      kind: 'empty',
    });
  });

  it('prioritizes missing party members over later protocol checks', () => {
    expect(decideMainNarrativeValidation({
      ...valid,
      missingPartyMembers: ['安柏', '丽莎'],
      protocolIssues: ['缺少 choices'],
    })).toEqual({ action: 'retry', kind: 'missing_party', missingPartyMembers: ['安柏', '丽莎'] });
  });

  it('accepts a similar reroll on the final attempt', () => {
    expect(decideMainNarrativeValidation({ ...valid, rerollSimilarity: 0.91, canRetry: false })).toEqual({
      action: 'accept',
      protocolIssues: [],
    });
  });

  it('retries an incomplete DeepSeek protocol only while budget remains', () => {
    expect(decideMainNarrativeValidation({ ...valid, protocolIssues: ['缺少 continuation'] })).toEqual({
      action: 'retry',
      kind: 'protocol',
      protocolIssues: ['缺少 continuation'],
    });
    expect(decideMainNarrativeValidation({ ...valid, protocolIssues: ['缺少 continuation'], canRetry: false })).toEqual({
      action: 'accept',
      protocolIssues: ['缺少 continuation'],
    });
  });
});
