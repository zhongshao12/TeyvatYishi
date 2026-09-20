# Legacy Quest Boundary Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the quest UI from the Legacy `任务系统` bidirectional adapter to the formal `QuestJournal` state while preserving save schema 2 and the remaining compatibility bridge.

**Architecture:** Introduce a formal immutable `abandonQuest` operation over `QuestJournal`. `QuestPanel` consumes `QuestEntry`/`QuestJournal`, while `App.tsx` writes through `updateGameState`; legacy quest conversion remains only for callers not yet migrated.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 3, Teyvat schema 2

---

### Task 1: Add the formal quest mutation

- [x] Add a failing behavior test to `tests/unit/questService.test.ts` for `abandonQuest(journal, id, updatedAt)`.
- [x] Verify it moves one active entry to `abandoned`, sets status, updates timestamps/history, leaves unknown IDs unchanged, and does not mutate the input.
- [x] Run `pnpm vitest run tests/unit/questService.test.ts` and confirm the missing export fails first.
- [x] Implement the immutable operation in `services/questService.ts` using `QuestJournal` and `QuestEntry`.

### Task 2: Migrate the quest panel boundary

- [x] Change `components/features/GameSystems/QuestPanel.tsx` props to:

```ts
interface QuestPanelProps {
  quest: QuestJournal;
  onQuestChange: (updater: (previous: QuestJournal) => QuestJournal) => void;
}
```

- [x] Map formal English field names to the existing Chinese UI labels and use `abandonQuest` for manual abandonment.
- [x] In `App.tsx`, pass `state.game.任务` and update it through `state.updateGameState(previous => ({ ...previous, 任务: updater(previous.任务) }))`.
- [x] Remove the Legacy `任务系统` import from `App.tsx`.
- [x] Update `scripts/quest-state-machine-regression.mjs` to assert the formal boundary instead of the Legacy helper name.

### Task 3: Verify migration safety

- [x] Run `pnpm vitest run tests/unit/questService.test.ts` and `node scripts/quest-state-machine-regression.mjs`.
- [x] Run `pnpm build` and the full unit suite.
- [x] Confirm the Legacy `任务/set任务` adapter still exists only for unmigrated runtime callers and save compatibility; do not delete it in this slice.
- [x] Record the passing checks; this workspace has no Git metadata, so no commit step is available.
