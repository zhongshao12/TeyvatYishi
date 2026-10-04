export interface MainNarrativeValidationInput {
  blank: boolean;
  missingPartyMembers: string[];
  rerollSimilarity: number;
  protocolIssues: string[];
  canRetry: boolean;
  /** 已激活酒馆预设声明的正文汉字下限（null/undefined = 预设没声明，不做长度校验）。 */
  wordCountTarget?: number | null;
  /** 本版可见正文的汉字数（`countVisibleBodyCharacters`）。 */
  bodyCharacterCount?: number;
}

export type MainNarrativeValidationDecision =
  | { action: 'retry' | 'reject'; kind: 'empty' }
  | { action: 'retry' | 'reject'; kind: 'missing_party'; missingPartyMembers: string[] }
  | { action: 'retry'; kind: 'reroll_similarity'; similarity: number }
  | { action: 'retry'; kind: 'protocol'; protocolIssues: string[] }
  | { action: 'retry'; kind: 'word_count_short'; wordCountTarget: number; bodyCharacterCount: number }
  | { action: 'accept'; kind?: undefined; protocolIssues: string[] };

/**
 * 长度校验的触发条件（2026-10-03 第二轮）。
 *
 * 只有在预设**明确声明了长文要求**时才校验，且允许 10% 的浮动 —— 目的是让
 * 「预设要求 3000 字，模型只写 800 字」这类明显不达标被自动重写一次，
 * 而不是把每回合都变成对字数的精确考核（既费 token 又拖时间）。
 */
export const WORD_COUNT_ENFORCEMENT_MIN_TARGET = 1200;
export const WORD_COUNT_ENFORCEMENT_RATIO = 0.9;

/** 可见正文汉字数：去掉空白后按码点计数（中文写作的「字数」口径）。 */
export function countVisibleBodyCharacters(text: string | null | undefined): number {
  if (!text) return 0;
  return [...text.replace(/\s+/gu, '')].length;
}

export function shouldEnforceWordCount(target: number | null | undefined, actual: number): boolean {
  if (typeof target !== 'number' || !Number.isFinite(target)) return false;
  if (target < WORD_COUNT_ENFORCEMENT_MIN_TARGET) return false;
  return actual < target * WORD_COUNT_ENFORCEMENT_RATIO;
}

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
  const bodyCharacterCount = input.bodyCharacterCount ?? 0;
  if (input.canRetry && shouldEnforceWordCount(input.wordCountTarget, bodyCharacterCount)) {
    return {
      action: 'retry',
      kind: 'word_count_short',
      wordCountTarget: input.wordCountTarget as number,
      bodyCharacterCount,
    };
  }
  return { action: 'accept', protocolIssues: input.protocolIssues };
}
