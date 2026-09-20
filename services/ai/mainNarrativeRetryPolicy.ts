export interface MainNarrativeAttemptBudgetInput {
  autoRetryOnError: boolean;
  autoRetryCount: number;
  requiresValidationRepair: boolean;
}

export function resolveMainNarrativeMaxAttempts(input: MainNarrativeAttemptBudgetInput): number {
  const configured = input.autoRetryOnError
    ? Math.max(1, Math.trunc(input.autoRetryCount)) + 1
    : 1;
  return input.requiresValidationRepair ? Math.max(2, configured) : configured;
}

export function shouldRetryNarrativeAttempt(input: { attempt: number; maxAttempts: number }): boolean {
  return input.attempt >= 1 && input.attempt < input.maxAttempts;
}
