# Companion Dou Dizhu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar chronology page with a saveable three-player Dou Dizhu game featuring two invited companions, affinity-shaped legal NPC play, and exactly-once affinity/memory settlement.

**Architecture:** Add one normalized game-state slice to the existing Teyvat save root. Keep card rules and state transitions pure, NPC policy separate from legality, and settlement atomic in one root-state update. Reuse the `timeline` route key while changing its label and panel; leave world time and timeline data untouched.

**Tech Stack:** TypeScript, React, Vitest, Vite, pnpm; no new dependencies or model API requirement.

**Spec:** `docs/superpowers/specs/2026-09-28-doudizhu-companion-game-design.md`

## Global Constraints

- Three seats: player plus exactly two distinct, known, non-archived NPC IDs. Do not change `travelingTogether` or party composition.
- Standard 54-card rules and rank order 3–A, 2, small joker, big joker; sequences exclude 2/jokers. No betting or currency changes.
- Completed games give each invited NPC exactly +5 affinity (bounded by existing maximum), one shared memory, and an affinity history entry; no payout before completion or twice for one game ID.
- Keep route ID `timeline`, `TEYVAT_SCHEMA_VERSION` 2, and all world time/chronology fields. Old saves without the new slice normalize to an empty table.
- Strategy and phrases may depend on existing relationship and personality but must never inspect another seat's hand when choosing a move. The game is playable offline.
- Preserve unrelated dirty-worktree edits; stage only files belonging to each task.

## File Structure

- `services/doudizhu/rules.ts`: card rank, play classification/comparison, legal-play enumeration; no React or save imports.
- `models/teyvat/doudizhu.ts`: versionless additive `DoudizhuState` and `DoudizhuGame` types, bounded normalization; `models/teyvat/state.ts` owns root-slice creation/hydration.
- `services/doudizhu/game.ts`: seeded deal, bid/play/pass/redeal transitions, turn ordering and terminal result; never edits NPC data.
- `services/doudizhu/strategy.ts`: legal NPC choice using only its hand, public trick/history, role, affinity tier and persona tags; deterministic under saved seed.
- `services/doudizhu/settlement.ts`: one idempotent `TeyvatGameState` update for +5, relation, affinity ledger and two NPC memories.
- `components/features/GameSystems/DoudizhuPanel.tsx`: invite, bid, hand/trick controls, recent moves, recovery and result; `App.tsx` wires one root-state action; `data/gameMenu.ts` changes the label.

## Review Focus

1. Duplicate click or save reload after finish must not award +5 or memory twice → Task 4 idempotency tests.
2. A malformed or tampered saved hand must not award affinity or hang NPC turns → Task 2 normalization and Task 4 rejection tests.
3. An NPC that disappears or is archived mid-game must stop the game with a visible recovery path, not credit a different same-name NPC → Task 4 stable-ID test and Task 5 UI test.
4. NPC strategy must not use hidden hands and must produce only legal moves, including unusual airplane/four-with-two patterns → Tasks 1 and 3 tests.
5. Old saves and sidebar selection must still load while world time and historical data remain unchanged → Tasks 2 and 5 tests.

---

### Task 1: Pure Card Rules

**Files:** Create `services/doudizhu/rules.ts`, `tests/unit/doudizhuRules.test.ts`.

**Interfaces:** Card IDs are integers 0–53: four suits for ranks 3–15 (15 = 2), 52 = small joker, 53 = big joker. Export type `DoudizhuPattern` with `kind`, `mainRank`, `cardCount`, `chainLength`, plus `rankOfCard(cardId: number): number`, `classifyDoudizhuPlay(cards: readonly number[]): DoudizhuPattern | null`, `canBeatDoudizhuPlay(candidate: DoudizhuPattern, target: DoudizhuPattern): boolean`, and `listLegalDoudizhuPlays(hand: readonly number[], target?: DoudizhuPattern): number[][]`. Reject duplicate/out-of-range IDs. Enumerate rank-count templates rather than blindly testing all subsets of 20 cards.

- [ ] **Step 1: Write failing tests** for every spec pattern, minimum sequence lengths, 2/joker exclusion, same-kind and same-length comparison, bombs/rocket, duplicate cards, and legal enumeration from a 20-card landlord hand.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/doudizhuRules.test.ts`; expect missing exports/failing cases.
- [ ] **Step 3: Implement** the four exported functions, with pattern recognition and comparison pure and deterministic.
- [ ] **Step 4: Run** the focused suite and `pnpm exec tsc -b`; expect pass.
- [ ] **Step 5: Commit** `feat: add pure Dou Dizhu card rules`.

### Task 2: Save Slice and Deterministic Game State Machine

**Files:** Create `models/teyvat/doudizhu.ts`, `services/doudizhu/game.ts`, `tests/unit/doudizhuGame.test.ts`; modify `models/teyvat/state.ts`, `models/teyvat/index.ts`, `tests/unit/teyvatSaveContract.test.ts`.

**Interfaces:** Export `createEmptyDoudizhuState(): DoudizhuState`, `normalizeDoudizhuState(raw: unknown): DoudizhuState`, `startDoudizhuGame(npcIds: readonly [string, string], seed: number, gameId: string): DoudizhuGame`, and `applyDoudizhuMove(game: DoudizhuGame, move: DoudizhuMove): DoudizhuGame`. The game stores seat IDs, seed, all hands/bottom, played-card IDs for conservation checks, phase, bids, landlord, active seat, current trick, pass count, capped public log, result and `settled` flag. `DoudizhuState` also stores bounded recent games, settled IDs, and `lastError?: string` for recoverable UI feedback. Export `DoudizhuUiAction` as a tagged union: `invite` carries two NPC IDs, a generated seed and game ID; `bid | play | pass` carry player choices but no seat; `abandon` carries no move. Internal `DoudizhuMove` has a `0 | 1 | 2` seat and relevant bid/cards. Invalid moves throw a domain error without changing game state. All-pass redeals from a seed derived deterministically from the prior seed and redeal count; never loops forever internally.

- [ ] **Step 1: Write failing tests** for 17/17/17+3 deal, 20-card landlord, all-pass redeal, turn order, two-pass reset, cannot pass on lead, wins for either side, old save without the slice, save/reload mid-game, and malformed hand/seat rejection.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/doudizhuGame.test.ts tests/unit/teyvatSaveContract.test.ts`; expect missing state and transition behavior.
- [ ] **Step 3: Implement** the state model and reducer; add root `斗地主` slice with empty fallback in create/normalize, retaining schema version and world fields.
- [ ] **Step 4: Run** focused suites and `pnpm exec tsc -b`; expect pass.
- [ ] **Step 5: Commit** `feat: persist deterministic Dou Dizhu games`.

### Task 3: Offline Companion Strategy and Voice

**Files:** Create `services/doudizhu/strategy.ts`, `tests/unit/doudizhuStrategy.test.ts`.

**Interfaces:** Export `createDoudizhuNpcView(game: DoudizhuGame, seat: 1 | 2): DoudizhuNpcView` and `chooseDoudizhuNpcMove(view: DoudizhuNpcView, profile: Pick<TeyvatNpcRecord, 'id' | 'affinity' | 'personality' | 'speechStyle'>): DoudizhuMove`. The view exposes only the acting NPC's hand, public trick/log, seats/roles, active seat and saved RNG seed; it never contains other private hands. Export `describeDoudizhuNpcMove(move, profile, result?): string` for short in-character table lines. Low/mid/high affinity alter scoring of legal choices, not legality or win condition.

- [ ] **Step 1: Write failing tests** proving only legal choices for awkward hands, no hidden-hand input, reproducible choices, distinct affinity-stage preferences in a fixed farmer-teammate scenario, and bounded non-generic persona phrasing.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/doudizhuStrategy.test.ts`; expect missing exports.
- [ ] **Step 3: Implement** policy over Task 1 legal plays and a capped public-action style formatter; no network/API calls.
- [ ] **Step 4: Run** focused suite and `pnpm exec tsc -b`; expect pass.
- [ ] **Step 5: Commit** `feat: add companion Dou Dizhu strategy`.

### Task 4: Atomic, Exactly-Once Settlement

**Files:** Create `services/doudizhu/settlement.ts`, `tests/unit/doudizhuSettlement.test.ts`; modify `models/variableCommand.ts`, `models/teyvat/runtimeSlices.ts`, `tests/unit/affinityChangeHistory.test.ts` to accept `source: 'doudizhu'` in the existing affinity-history pipeline. Use existing `models/npc.ts` affinity bounds/relation helpers and Teyvat NPC shared-memory model.

**Interfaces:** Export `applyDoudizhuGameAction(gameState: TeyvatGameState, action: DoudizhuUiAction): TeyvatGameState`. The action starts/abandons a game or maps a player choice to seat 0; after each move, run NPC turns up to a fixed safety cap, then settle if finished. Use `currentGame.id` plus `settled`/bounded settled-ID list for idempotency. Write both NPC updates, a `source: 'doudizhu'` variable batch with two `NPC.[id=...].affinity` results, and the game result in one new root object. Missing/archived NPC ID, invalid move or corrupt game returns unchanged NPC data and a message in `斗地主.lastError`; same-name lookup is forbidden.

- [ ] **Step 1: Write failing tests** for both NPCs receiving +5 whether they win or lose, relationship tier/affinity history, one actual-match shared memory each, replay/reload/rapid-click idempotency, max-affinity clamp, missing/archived/same-name NPC, corrupted game, and mid-game abandon with zero payout.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/doudizhuSettlement.test.ts`; expect missing behavior.
- [ ] **Step 3: Implement** the root transaction and bounded memory/history write; do not call `setNPC` and `setDoudizhu` separately.
- [ ] **Step 4: Run** focused tests plus `pnpm exec vitest run tests/unit/affinityChangeHistory.test.ts tests/unit/teyvatSaveContract.test.ts`; expect pass.
- [ ] **Step 5: Commit** `feat: settle companion card games exactly once`.

### Task 5: Replace Chronology Surface with Playable Panel

**Files:** Create `components/features/GameSystems/DoudizhuPanel.tsx`, `tests/unit/doudizhuPanel.test.tsx`; modify `App.tsx`, `data/gameMenu.ts`. Leave `utils/timelineBuilder.ts` and world time data intact; do not delete them for this feature.

**Interfaces:** `DoudizhuPanel` receives `{ state: DoudizhuState; npcs: readonly TeyvatNpcRecord[]; onAction: (action: DoudizhuUiAction) => void }`. `App.tsx` keeps the `timeline` switch case but lazy-loads the new panel and routes actions through a single `state.updateGameState(current => applyDoudizhuGameAction(current, action))`. Show `state.lastError` without granting rewards.

- [ ] **Step 1: Write failing UI tests** for two distinct invitees, restored unfinished table, keyboard-operable card selection/bid/play/pass, invalid-play explanation, recent public moves, result/+5 display, archived participant recovery, changed menu label, and unchanged world time after actions.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/doudizhuPanel.test.tsx`; expect missing panel/route behavior.
- [ ] **Step 3: Implement** the panel and root callback; retain the saved route ID but label it “斗地主”. Use CSS card faces, no new image assets.
- [ ] **Step 4: Run** focused UI tests, `pnpm exec tsc -b`, and `pnpm exec eslint . --quiet`; expect pass.
- [ ] **Step 5: Commit** `feat: replace chronology panel with Dou Dizhu`.

### Task 6: Cross-Layer Regression and Release Gate

**Files:** Add tests only if a real uncovered edge appears. Do not introduce unrelated product changes.

**Interfaces:** Old and new saves remain usable; one complete three-seat game survives save/reload and settles two NPCs exactly once.

- [ ] **Step 1: Add a failing integration test** combining restored mid-game state, one player move, NPC turns, terminal payout and reload if Tasks 2–5 do not already cover the full flow.
- [ ] **Step 2: Run** all `doudizhu*.test.ts*`, save-contract, affinity-history, and menu tests; expect pass.
- [ ] **Step 3: Run** `pnpm exec vitest run`, `pnpm exec tsc -b`, `pnpm exec eslint . --quiet`, and `pnpm build`; expect exit code 0, recording pre-existing build warnings separately.
- [ ] **Step 4: Commit** any final integration test/fix and report verified scope without claiming browser playtesting unless performed.
