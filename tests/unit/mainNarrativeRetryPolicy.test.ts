import { describe, expect, it } from 'vitest';
import {
  resolveMainNarrativeMaxAttempts,
  shouldRetryNarrativeAttempt,
} from '@/services/ai/mainNarrativeRetryPolicy';

describe('main narrative retry policy', () => {
  it('never retries a blank response beyond the configured attempt budget', () => {
    expect(shouldRetryNarrativeAttempt({ attempt: 1, maxAttempts: 1 })).toBe(false);
    expect(shouldRetryNarrativeAttempt({ attempt: 1, maxAttempts: 2 })).toBe(true);
    expect(shouldRetryNarrativeAttempt({ attempt: 2, maxAttempts: 2 })).toBe(false);
  });

  it('keeps one attempt normally and reserves a repair attempt for strict validators', () => {
    expect(resolveMainNarrativeMaxAttempts({
      autoRetryOnError: false,
      autoRetryCount: 3,
      requiresValidationRepair: false,
    })).toBe(1);
    expect(resolveMainNarrativeMaxAttempts({
      autoRetryOnError: false,
      autoRetryCount: 3,
      requiresValidationRepair: true,
    })).toBe(2);
    expect(resolveMainNarrativeMaxAttempts({
      autoRetryOnError: true,
      autoRetryCount: 2,
      requiresValidationRepair: false,
    })).toBe(3);
  });
});
