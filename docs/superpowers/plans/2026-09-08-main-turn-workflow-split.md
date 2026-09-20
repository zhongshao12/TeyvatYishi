# Main Turn Workflow Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `sendWorkflow.ts` responsibility by moving token usage and cache-prefix diagnostics into a pure, unit-tested turn diagnostics boundary without changing runtime behavior.

**Architecture:** Keep `executeSendWorkflow` as the orchestration entry point. Move deterministic diagnostics into `hooks/useGame/turnDiagnostics.ts`; the workflow imports the two public builders and continues to persist the same `回合Token消耗` and debug context shapes.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 3, Vite 6

---

### Task 1: Establish the diagnostics contract

- [x] Add `tests/unit/turnDiagnostics.test.ts` importing `buildTurnTokenUsage` and `buildCachePrefixDiagnostics` from the new boundary.
- [x] Cover API usage precedence, estimate fallback, mixed cache-only usage, disabled diagnostics, and first changed section detection.
- [x] Run `pnpm vitest run tests/unit/turnDiagnostics.test.ts` and confirm the missing module fails first.

### Task 2: Extract the pure diagnostics boundary

- [x] Add `hooks/useGame/turnDiagnostics.ts` with the existing behavior and explicit public input types.
- [x] Export these entry points:

```ts
export function buildTurnTokenUsage(input: TurnTokenUsageInput): 回合Token消耗;
export function buildCachePrefixDiagnostics(input: CachePrefixDiagnosticsInput):
  NonNullable<聊天消息['debugContext']>['cachePrefixDiagnostics'] | undefined;
```

- [x] Replace local implementations in `hooks/useGame/sendWorkflow.ts` with imports.
- [x] Update `scripts/turn-usage-regression.mjs` so source assertions follow the new module boundary and still verify workflow integration.
- [x] Run `pnpm vitest run tests/unit/turnDiagnostics.test.ts` and `pnpm test:turn-usage`.

### Task 3: Verify the workflow seam

- [x] Run `pnpm build`.
- [x] Confirm `sendWorkflow.ts` contains calls to both imported diagnostics builders and no duplicate implementations.
- [x] Record the passing checks; this workspace has no Git metadata, so no commit step is available.
