# Inventory Narrative Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explicitly acquired and consumed player-owned physical items are reflected once in the formal inventory and survive save/load.

**Architecture:** Retain the variable model as primary producer of item facts. Add a conservative narrative-derived fallback for omitted gains and expand existing removal detection; merge by item/action before the current fact-to-command/preflight/commit path, rather than writing inventory directly from prose.

**Tech Stack:** TypeScript, formal `TeyvatInventory`, Vitest, existing variable settlement transaction.

**Spec:** `docs/superpowers/specs/2026-09-23-phone-moments-and-turn-consistency-design.md`

## Global Constraints

- Inventory writes must go through formal `item` facts and domain commands, never a separate UI-only bag.
- Do not create an item for vague names, information without a physical carrier, merely observed objects, a hypothetical/negated event, or another person's possession.
- Reuse existing category/rarity only when known; never invent weapon/artifact rarity.
- A model-reported action and narrative fallback for the same item/action in the same turn count once.
- Preserve existing dirty worktree changes and recovery/session guards.

## Review Focus

1. `安柏递给你一枚日落果，你收下` must increase the player's food quantity by one (Task 1 test).
2. `安柏拿出日落果给别人` must not increase inventory (Task 1 test).
3. `我喝下一瓶药剂` must consume the player's existing item (Task 2 test).
4. `我没有喝药剂` and `丽莎喝下药剂` must not consume it (Task 2 test).
5. A model `gain` plus the same fallback, or recovery replay with the same settlement ID, must not grant twice (Task 3 tests).

---

### Task 1: Derive only provable item gains

**Files:**
- Modify: `utils/variableFacts.ts`
- Test: `tests/unit/narrativeInventoryFacts.test.ts` (create)

**Interfaces:**
- Consumes: narrative body and current `TeyvatInventory.items`.
- Produces: `deriveNarrativeInventoryGainFacts(body: string, items: readonly TeyvatItem[]): { facts: Array<Extract<变量事实, { type: 'item' }>>; warnings: string[] }`.

- [ ] **Step 1: Write failing gain and false-positive tests**

```ts
import { expect, it } from 'vitest';
import { deriveNarrativeInventoryGainFacts } from '@/utils/variableFacts';

it('derives a concrete fruit received by the player', () => {
  expect(deriveNarrativeInventoryGainFacts('安柏递给你一枚日落果，你收下并放进背包。', []).facts)
    .toContainEqual(expect.objectContaining({ type: 'item', action: 'gain', name: '日落果', category: 'food', rarity: 1, quantity: 1 }));
});
it('ignores property still held by someone else or only observed', () => {
  expect(deriveNarrativeInventoryGainFacts('安柏拿出一枚日落果递给琴。你在旁边看着。', []).facts).toEqual([]);
  expect(deriveNarrativeInventoryGainFacts('你看见桌上有一枚日落果。', []).facts).toEqual([]);
  expect(deriveNarrativeInventoryGainFacts('你没有收下一枚日落果。', []).facts).toEqual([]);
});
it('warns rather than inventing an unknown weapon rarity', () => {
  const result = deriveNarrativeInventoryGainFacts('安柏递给你一把无名长剑，你收下。', []);
  expect(result.facts).toEqual([]);
  expect(result.warnings).toContain('背包结算待确认：无名长剑缺少可靠分类或星级');
});
```

The warning must also be appended to the settlement batch in Task 3.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts`

Expected: export does not exist or gain case returns no facts.

- [ ] **Step 3: Implement a small player-receipt grammar and safe category inference**

```ts
const KNOWN_NARRATIVE_ITEMS = new Map<string, Pick<TeyvatItem, 'category' | 'rarity'>>([
  ['日落果', { category: 'food', rarity: 1 }],
  ['苹果', { category: 'food', rarity: 1 }],
  ['甜甜花', { category: 'material', rarity: 1 }],
]);
export function deriveNarrativeInventoryGainFacts(body: string, items: readonly TeyvatItem[]) {
  const facts: Array<Extract<变量事实, { type: 'item' }>> = [];
  const warnings: string[] = [];
  const known = new Map([...KNOWN_NARRATIVE_ITEMS, ...items.map((item) => [item.name, { category: item.category, rarity: item.rarity }] as const)]);
  for (const sentence of body.split(/(?<=[。！？!?\n])/u).map((part) => part.trim()).filter(Boolean)) {
    if (!/(?:递给|交给|送给)(?:了)?(?:你|我)|(?:你|我)(?:接过|收下|捡起|拾起|获得)/u.test(sentence)) continue;
    if (/(?:没有|并未|未曾|不曾|假如|如果|打算).{0,12}(?:接过|收下|捡起|拾起|获得)/u.test(sentence)) continue;
    const name = [...known.keys()].find((candidate) => sentence.includes(candidate));
    if (!name) {
      const unknown = sentence.match(/(?:递给|交给|送给)(?:了)?(?:你|我)一[把件枚个瓶份]\s*([^，。！？\s]{2,12})/u)?.[1];
      if (unknown) warnings.push(`背包结算待确认：${unknown}缺少可靠分类或星级`);
      continue;
    }
    const item = known.get(name)!;
    facts.push({ type: 'item', action: 'gain', name, category: item.category, rarity: item.rarity, quantity: parseNarrativeQuantity(sentence, name), evidence: sentence });
  }
  return { facts, warnings };
}
```

Before applying this sketch, split `安柏递给你...你收下` into clauses and confirm the recipient actually accepted; a transfer verb alone in a negated or conditional clause is insufficient. Cover that exact boundary in the RED tests. Do not infer equipment rarity.

- [ ] **Step 4: Run GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts tests/unit/userReportedWorkflowFixesRound3.test.ts`

Expected: gain and negative cases pass, old inventory behavior unchanged.

### Task 2: Recognize player consumption without requiring one pronoun

**Files:**
- Modify: `utils/variableFacts.ts` (`classifyPlayerInventoryRemoval` and `deriveNarrativeInventoryRemovalFacts`)
- Test: `tests/unit/narrativeInventoryFacts.test.ts`

**Interfaces:**
- Consumes: body plus existing named items.
- Produces: `consume`, `give`, or `lose` facts only for completed player actions.

- [ ] **Step 1: Add failing actor and negation tests**

```ts
const potion = [{ id: 'item_potion', category: 'food', name: '药剂', description: '', quantity: 2, rarity: 1, obtainedAtTurn: 1 }] as const;
expect(deriveNarrativeInventoryRemovalFacts('我喝下一瓶药剂，空瓶留在桌上。', potion))
  .toContainEqual(expect.objectContaining({ action: 'consume', name: '药剂', quantity: 1 }));
expect(deriveNarrativeInventoryRemovalFacts('我没有喝下药剂。', potion)).toEqual([]);
expect(deriveNarrativeInventoryRemovalFacts('丽莎喝下药剂，我在旁边看着。', potion)).toEqual([]);
```

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts`

Expected: first-person case has no fact on current code.

- [ ] **Step 3: Extend actor detection, not the global removal verb regex**

```ts
const PLAYER_REFERENCES = ['我', '你', '旅行者', '玩家'];
const actorBeforeVerb = PLAYER_REFERENCES.some((name) => {
  const index = sentence.indexOf(name);
  return index >= 0 && index < verbMatch.index! && verbMatch.index! - index <= 12;
});
if (!actorBeforeVerb) return null;
// Preserve the existing negation and NPC-gives-to-player exclusions;
// do not count a player pronoun in a later bystander clause.
```

Add traveler-name support only when the name is explicitly passed from the settlement snapshot; do not treat every proper noun as the player.

- [ ] **Step 4: Run GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts tests/unit/userReportedWorkflowFixesRound3.test.ts`

Expected: player action recorded, bystander and negated actions ignored.

### Task 3: Merge fallback into the formal transaction exactly once

**Files:**
- Modify: `utils/variableFacts.ts` (export the pure `mergeNarrativeInventoryFacts` helper)
- Modify: `hooks/useGame/variableSettlementWorkflow.ts`
- Test: `tests/unit/narrativeInventoryFacts.test.ts`
- Test: `tests/unit/teyvatTurnTransaction.test.ts`

**Interfaces:**
- Consumes: parsed model `item` facts, derived gain/removal facts, `stateSnapshot`, `settlementId`.
- Produces: `mergeNarrativeInventoryFacts(modelFacts: 变量事实[], derived: 物品变量事实[]): 变量事实[]`; `effectiveFacts` without duplicate same-action item facts; existing `factsToTeyvatDomainCommands` remains the only inventory writer.

- [ ] **Step 1: Write failing transaction-facing cases**

```ts
const modelFacts = [{ type: 'item', action: 'gain', name: '日落果', category: 'food', rarity: 1, quantity: 1, evidence: '安柏递给你一枚日落果，你收下。' }];
const fallback = deriveNarrativeInventoryGainFacts('安柏递给你一枚日落果，你收下。', []).facts;
const merged = mergeNarrativeInventoryFacts(modelFacts, fallback);
expect(merged.filter((fact) => fact.type === 'item' && fact.name === '日落果' && fact.action === 'gain')).toHaveLength(1);
```

Add a real `factsToTeyvatDomainCommands` + `commitTeyvatTurn` assertion that the resulting inventory quantity is one, not two. Use the `settlementCommitIdentity.test.ts` harness to replay the same `vbatch_${settlementId}` and assert no second addition.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts tests/unit/teyvatTurnTransaction.test.ts`

Expected: `mergeNarrativeInventoryFacts` is absent and fallback is not included in the transaction.

- [ ] **Step 3: Implement one merge at the settlement boundary**

```ts
export function mergeNarrativeInventoryFacts(modelFacts: 变量事实[], derived: Array<Extract<变量事实, { type: 'item' }>>): 变量事实[] {
  const key = (fact: Extract<变量事实, { type: 'item' }>) => `${fact.action}:${fact.name.trim().toLocaleLowerCase('zh-CN')}`;
  const seen = new Set(modelFacts.filter((fact): fact is Extract<变量事实, { type: 'item' }> => fact.type === 'item').map(key));
  const added = derived.filter((fact) => {
    const identity = key(fact);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return [...modelFacts, ...added];
}
const derivedGains = deriveNarrativeInventoryGainFacts(params.body, stateSnapshot.背包.items);
const inventoryFacts = mergeNarrativeInventoryFacts(allowedFacts, [...derivedGains.facts, ...inventoryRemovalFacts]);
const factsWithPartyPresence = [
  ...inventoryFacts.filter((fact) => fact.type !== 'npc' || !presenceNames.has(fact.name) || typeof fact.following !== 'boolean'),
  ...resolvedNpcFacts, ...narrativeCanonicalNpcFacts, ...partyPresenceFacts,
];
const allWarnings = [...derivedGains.warnings, ...factCommands.warnings];
const warningResults = allWarnings.map((reason) => ({
  command: { action: 'set' as const, key: '(事实忽略)', value: null }, ok: false, kind: 'warning' as const, reason,
}));
// Use allWarnings (not factCommands.warnings alone) for batch report/count and
// buildNpcLedgerUpdateDebug.warnings; do not append inventoryRemovalFacts twice.
```

Match by action + normalized item name; model fact wins. Leave quantity conflicts visible in batch warnings instead of silently adding both. Reuse the existing `vbatch_${settlementId}` marker to prevent replay.

- [ ] **Step 4: Run GREEN and persistence tests**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/narrativeInventoryFacts.test.ts tests/unit/teyvatTurnTransaction.test.ts tests/unit/workflowRecoveryModel.test.ts tests/unit/teyvatSaveContract.test.ts`

Expected: exact quantities, no double grant, save/load retains the resulting formal inventory.

### Task 4: Verify this independent fix

**Files:** none beyond Task 1–3.

**Interfaces:** Produces a separately testable formal inventory settlement repair.

- [ ] Run `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js . --ignore-pattern '.triage/**' --quiet`, and focused inventory tests; require exit code 0.
- [ ] Run `git diff --check`; inspect each change to the large `variableFacts.ts` and `variableSettlementWorkflow.ts` before moving on.
