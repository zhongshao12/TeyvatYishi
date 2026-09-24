# Courier Natural Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phone letters and replies never expose internal seed summaries or mechanically recite shared-memory entries.

**Architecture:** Keep structured courier seeds as orchestration data, but derive a separate speech-safe event description for the AI prompt. The local fallback uses only validated event facts or a short trigger-based line and never appends raw memory summaries as a second bubble.

**Tech Stack:** TypeScript, Vitest, existing courier AI client.

**Spec:** `docs/superpowers/specs/2026-09-23-phone-moments-and-turn-consistency-design.md`

## Global Constraints

- Preserve the existing phone API priority, per-character context, delivery cadence, and shared memory writes.
- Do not let a character know an event merely because global world state contains it.
- Never copy `seed.context`, `recentInteraction`, or `unfinishedBusiness` verbatim into fallback dialogue.
- Retain messages sent in existing saves; repair only future generation.
- Preserve unrelated dirty worktree changes; no commit on the shared dirty `main` branch without user instruction.

## Review Focus

1. The reported 安柏 sentence must not appear as a phone message (Task 1 test).
2. A concrete, first-hand event such as a promised patrol may still inform a message (Task 1 test).
3. Empty/malformed seeds must produce a safe short fallback rather than metadata (Task 1 test).
4. Private and group prompts for one sender must not import another NPC's private experience (Task 2 test).
5. Letter, private reply, and group reply output that repeats a seed instruction must be rejected before delivery (Task 2 test).

---

### Task 1: Separate event facts from internal seed text

**Files:**
- Modify: `services/ai/courierService.ts`
- Modify: `hooks/useGame/courierBackgroundJobs.ts` only if seed construction is shown to leak into other paths.
- Test: `tests/unit/courierNaturalMessages.test.ts` (create)

**Interfaces:**
- Consumes: `CourierDeliverySeed.context`, `CourierSenderProfile` and existing `composeCourierLetterLocally` / `composeCourierReplyLocally`.
- Produces: `extractCourierSpeechEvent(context: string): string | null` for the AI prompt; safe fallback messages that contain no raw memory ledger sentence.

- [ ] **Step 1: Add failing behavior tests**

```ts
import { describe, expect, it } from 'vitest';
import { composeCourierLetterLocally, composeCourierReplyLocally, extractCourierSpeechEvent } from '@/services/ai/courierService';
import type { CourierConversation, CourierDeliverySeed, CourierMessage } from '@/models/teyvat/courier';
import type { CourierSenderProfile } from '@/services/ai/courierService';

const meta = '安柏近期与旅行者有互动，可低频投递一封跟进来信。已发生事实：关于安柏对在戒严区域遇到的陌生人（玩家）留下了深刻的第一印象，可能会有后续联络。';
const seed: CourierDeliverySeed = { id: 'seed-2', senderId: 'amber', reason: '跟进', turn: 2, source: 'memory', triggerType: 'quest', priority: 'normal', targetType: 'private', targetId: 'amber', title: '近况', context: meta, relatedNpcIds: ['amber'], status: 'pending' };
const sender: CourierSenderProfile = { name: '安柏', recentInteraction: meta };
const playerMessage: CourierMessage = { id: 'p-1', senderId: 'player', senderName: '旅行者', role: 'user', content: '明天巡逻吗？', turn: 2, timestamp: 2, readBy: ['player'] };
const conversation: CourierConversation = { id: 'amber-chat', title: '安柏', participantIds: ['player', 'amber'], messages: [playerMessage], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 2 };
it('does not speak internal relationship summaries', () => {
  expect(extractCourierSpeechEvent(meta)).toBeNull();
  const letter = composeCourierLetterLocally({ seed, sender });
  expect(letter).not.toMatch(/关于安柏对|留下了深刻|可能会有后续联络|对了，.*我还记着/u);
});
it('does not append memory ledger text to a reply', () => {
  const reply = composeCourierReplyLocally({ conversation, playerMessage, sender });
  expect(reply).not.toContain('我可没忘');
});
it('keeps a concrete first-hand event and handles an empty seed', () => {
  expect(extractCourierSpeechEvent('明天一起巡逻。')).toBe('明天一起巡逻。');
  expect(composeCourierLetterLocally({ seed: { ...seed, context: '' }, sender }).trim()).not.toBe('');
});
```

The current raw interpolation must fail these tests before the fix.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/courierNaturalMessages.test.ts`

Expected: leaked phrases appear; `extractCourierSpeechEvent` is not yet exported.

- [ ] **Step 3: Implement the event projection and remove raw memory tails**

```ts
export function extractCourierSpeechEvent(context: string): string | null {
  const event = extractEventBasis(context).trim();
  if (!event || /关于.{0,30}对.*(?:印象|好感)|可能会有后续|可低频投递|玩家一行人/u.test(event)) return null;
  return event.slice(0, 90);
}
// In composeCourierLetterLocally replace `extractEventBasis(seed.context)` with
// `extractCourierSpeechEvent(seed.context)` and remove memoryAnchor/memoryLine.
// In composeCourierReplyLocally remove memoryAnchor/memoryLine; keep its direct
// player-message response and relationship tone. Return arrays omit memoryLine.
```

Keep the action-specific sentence templates only for facts that pass the projection. Do not remove personal style data from the AI profile.

- [ ] **Step 4: Run GREEN and neighboring tests**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/courierNaturalMessages.test.ts tests/unit/courierGroupLifecycle.test.ts tests/unit/userReportedWorkflowFixesRound3.test.ts`

Expected: all pass, including normal reply and group selection behavior.

### Task 2: Keep generated text on the same speech-safe boundary

**Files:**
- Modify: `services/ai/courierLetterModel.ts`
- Test: `tests/unit/courierNaturalMessages.test.ts`

**Interfaces:**
- Consumes: `extractCourierSpeechEvent`, `buildCourierLetterPrompt`, `buildCourierReplyPrompt`, `buildCourierGroupReplyPrompt`, `generateCourierLetter`, `generateCourierReply`, `generateCourierGroupReply`, `CourierSenderProfile`.
- Produces: prompts without internal seed instructions and validated model output.

- [ ] **Step 1: Write failing prompt/output tests**

```ts
import { buildCourierLetterPrompt, buildCourierReplyPrompt, buildCourierGroupReplyPrompt } from '@/services/ai/courierLetterModel';
const prompt = buildCourierLetterPrompt({ seed, sender });
expect(prompt).not.toContain('可低频投递');
expect(prompt).not.toContain('可能会有后续联络');
expect(prompt).not.toContain('关于安柏对');
expect(prompt).toContain('寄件人：安柏');
const privatePrompt = buildCourierReplyPrompt({ conversation, playerMessage, sender });
expect(privatePrompt).not.toContain('关于安柏对');
const groupPrompt = buildCourierGroupReplyPrompt({ conversation: { ...conversation, type: 'group' }, playerMessage, sender });
expect(groupPrompt).not.toContain('关于安柏对');
```

Mock `chatCompletion` with `vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletion: vi.fn().mockResolvedValue('关于安柏对玩家留下了深刻的第一印象') }))` and pass a complete `API配置项` fixture. Assert `generateCourierLetter` rejects with `LETTER_CONTAINS_META_TEXT`, `generateCourierReply` with `REPLY_CONTAINS_META_TEXT`, and `generateCourierGroupReply` with `GROUP_REPLY_CONTAINS_META_TEXT`.

- [ ] **Step 2: Run RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/courierNaturalMessages.test.ts`

Expected: the prompt still contains the internal context or output passes unchecked.

- [ ] **Step 3: Replace raw prompt seed context with projected event and reject meta-shaped output**

```ts
const event = extractCourierSpeechEvent(seed.context);
const eventLine = event ? `角色可知的近期事件：${event}` : '';
const META_NARRATIVE_PATTERN = /关于.{0,30}对.*(?:印象|好感)|可能会有后续联络|可低频投递|已发生事实|玩家一行人|对了，.*我还记着/u;
const safeProfileLine = (value: string | undefined) => value && !META_NARRATIVE_PATTERN.test(value) ? value : '';
const safeProfileList = (values: string[] | undefined) => (values ?? []).filter((value) => !META_NARRATIVE_PATTERN.test(value));
const safeSender: CourierSenderProfile | undefined = sender && {
  ...sender,
  recentInteraction: safeProfileLine(sender.recentInteraction),
  longTermImpression: safeProfileLine(sender.longTermImpression),
  sharedExperiences: safeProfileList(sender.sharedExperiences),
  unfinishedBusiness: safeProfileList(sender.unfinishedBusiness),
  unresolvedConflicts: safeProfileList(sender.unresolvedConflicts),
  recentMemories: safeProfileList(sender.recentMemories),
  summaryMemories: safeProfileList(sender.summaryMemories),
  mustRemember: safeProfileList(sender.mustRemember),
  recentMessages: safeProfileList(sender.recentMessages),
};
// Use safeSender in all three prompt builders. Omit unsafe seed.reason; use
// eventLine instead of seed.context. Apply META_NARRATIVE_PATTERN alongside
// META_PATTERN in all three output validators with each existing error code.
```

Do not include global location/time as character knowledge unless the existing sender profile explicitly permits it; preserve existing environment continuity text as non-authoritative context.

- [ ] **Step 4: Run GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/courierNaturalMessages.test.ts`

Expected: no internal seed phrasing in the prompt or delivered output.

### Task 3: Verify this independent fix

**Files:** none beyond Task 1–2.

**Interfaces:** Produces a separately testable courier repair.

- [ ] Run `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js . --ignore-pattern '.triage/**' --quiet`, and the focused courier tests; require exit code 0.
- [ ] Run `git diff --check` and inspect only this plan's paths. Do not stage pre-existing dirty changes.
