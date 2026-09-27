# NPC 私密档案与好感结算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只为可靠确认成年的 NPC 结算可归属的亲密事件，并让玩家首次对象、旧档补全与好感增量在更名和重试后保持一致。

**Architecture:** 成年资格是独立于本回合模型事实的纯函数；首次对象用稳定 `player` 引用保存，展示时才解析存档玩家姓名。正文证据先转换为带稳定 NPC ID 的候选，再由现有变量批次/回合事务一次提交；不另建第二套好感历史。

**Tech Stack:** React、TypeScript、Vitest、现有 legacy/Teyvat NPC 模型、变量事实与回合事务。

**Spec:** `docs/superpowers/specs/2026-09-27-npc-affinity-irminsul-consistency-design.md` 第 1–3 节及相关验收场景。

## Global Constraints

- 仅已确认成年且非受保护、非人形对象可写私密字段；本回合 `ageConfirm: adult` 不构成独立确认。
- 旧档只补女性、可靠成年、`是否处女 = 否`、首次对象缺失/“无”/可确认玩家泛称的记录；非玩家对象、`是/未知` 原样保留。
- 亲密档位固定为 +30 / +5 / +3 / +3；每 NPC 每回合只取最高档，不改变普通负面或其他独立事件的结算。
- 旧档推定必须标记 `legacy_assumed` 和“具体回合未知”，不伪造事件时间或细节。
- 不新增依赖，不重建存档根；每项功能先看到失败测试再改代码。

## Review Focus

- 同名 NPC 分属不同存档或不同稳定 ID：Task 4 的测试必须证明去重不串档、不串人。
- 玩家改名且 NPC 的首次对象另有明确非玩家姓名：Task 2 的测试必须证明该值不被替换。
- “A 告诉玩家 B 与 C 亲吻”这类第三方转述：Task 3 的测试必须证明无自动亲密增量。
- 模型声称成年、但档案仍未知或有明确未成年线索：Task 1/3 的测试必须证明无法提升年龄和发出亲密结算。
- 一个回合既有确认亲吻又有独立冲突负面变化：Task 4 的测试必须证明只消除重复亲密增量。

---

### Task 1: 独立成年资格与私密写入门禁

**Files:**
- Create: `utils/npcAdultEligibility.ts`
- Modify: `models/npc.ts`, `models/teyvat/character.ts`, `hooks/useGameState.ts`, `utils/npcArchiveEnrichment.ts`, `utils/variableFacts.ts`
- Test: `tests/unit/npcAdultEligibility.test.ts`, `tests/unit/npcNsfwFemaleDefaults.test.ts`, `tests/unit/nsfwMinorAgeGate.test.ts`

**Interfaces:**
- Produces: `resolveNpcAdultEligibility(input: { name: string; aliases?: readonly string[]; description?: string; ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked'; ageSource?: 'canonical' | 'manual' | 'legacy_unverified'; canonicalBaselineAge?: 'adult' | 'unknown' | 'minor_blocked' }): { confirmed: boolean; reason: string }`.
- Produces: legacy `NSFW档案.年龄确认来源` ↔ Teyvat `matureArchive.ageConfirmationSource` with the same three values. Missing source is `legacy_unverified`, not `manual`.
- Consumes: existing `getNsfwArchiveBlockReason` and explicit `CanonicalArchiveBaseline.nsfw年龄确认`.

- [ ] **Step 1: Write failing tests** named `accepts_trusted_adult_source`, `rejects_unverified_adult`, `rejects_minor_even_if_model_says_adult`: use `expect(resolveNpcAdultEligibility(input).confirmed).toBe(true/false)` for canonical/manual versus unknown, legacy-unverified, protected and explicit-minor inputs. Update the old “all female = adult” expectation to “only trusted adult”.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/npcAdultEligibility.test.ts tests/unit/npcNsfwFemaleDefaults.test.ts tests/unit/nsfwMinorAgeGate.test.ts`; expect the new adult-boundary assertions to fail.
- [ ] **Step 3: Add and normalize age source** in both NPC models and their legacy/Teyvat bridge in `hooks/useGameState.ts`; missing legacy source stays unverified unless the explicit canonical baseline validates that identity.
- [ ] **Step 4: Implement `resolveNpcAdultEligibility`** and apply it to NSFW baseline creation, `nsfw_archive` fact-to-command translation and Teyvat archive normalization. Do not infer adult from gender, absent minor words or this turn’s intimacy fact; keep regular NPC facts unaffected.
- [ ] **Step 5: Re-run** the three test files; expect PASS, then `pnpm exec tsc -b --pretty false`; expect exit 0.
- [ ] **Step 6: Commit** only Task 1 files with `fix: require trusted adult status for NPC private archives`.

### Task 2: 玩家首次对象引用与有界旧档补全

**Files:**
- Create: `utils/npcFirstPartner.ts`
- Modify: `models/npc.ts`, `models/teyvat/character.ts`, `hooks/useGameState.ts`, `components/features/GameSystems/CompanionPanel.tsx`
- Test: `tests/unit/npcFirstPartner.test.ts`, `tests/unit/legacyNpcIdentity.test.ts`, `tests/unit/companionPanelBehavior.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveNpcAdultEligibility`.
- Produces: `firstSexualPartnerRef?: 'player'`, `firstSexualPartnerSource?: 'narrative' | 'legacy_assumed' | 'manual'`, `firstSexualPartnerTurn?: number` in Teyvat; `首次性行为对象引用`、`首次性行为对象来源`、`首次性行为对象回合` in legacy archive.
- Produces: `migrateLegacyFirstPartner(npc: NPC记录, playerName: string): NPC记录` and `displayFirstPartner(archive: NPC_NSFW档案 | undefined, playerName: string): string`.

- [ ] **Step 1: Write failing tests** named `backfills_only_adult_not_virgin_missing_partner` and `player_rename_changes_display_not_storage`: assert `migrateLegacyFirstPartner(npc, '云').NSFW档案?.首次性行为对象引用 === 'player'`, a second call equals the first, `displayFirstPartner(archive, '新名字') === '新名字'`, and non-player/`是`/`未知`/unknown-age records are unchanged. Add a UI test for source label and manual correction.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/npcFirstPartner.test.ts tests/unit/legacyNpcIdentity.test.ts tests/unit/companionPanelBehavior.test.ts`; expect new tests to fail.
- [ ] **Step 3: Add fields and round-trip normalization** in both NPC models and `hooks/useGameState.ts`; retain the old free-text field for a genuine non-player object, but never persist a copied player display name as identity.
- [ ] **Step 4: Implement the two pure helpers** and invoke migration at the loaded-save NPC boundary using that save’s traveler name. Reliable historical event proof uses `narrative` plus its true turn; otherwise add exactly one labeled “旧档推定，具体回合未知” experience. Do not modify other experiences.
- [ ] **Step 5: Render the resolved display name/source** in `CompanionPanel` using existing `travelerName` prop, and add an explicit manual correction control for an adult `legacy_assumed` record (choose player, specify another name, or clear to unknown). Save the correction with source `manual`; unknown eligibility remains “待确认”.
- [ ] **Step 6: Re-run** the three test files plus `pnpm exec tsc -b --pretty false`; expect PASS/exit 0.
- [ ] **Step 7: Commit** only Task 2 files with `fix: keep first partner bound to traveler identity`.

### Task 3: 玩家参与证据与最高亲密档位

**Files:**
- Create: `utils/npcIntimacyEvidence.ts`
- Modify: `utils/variableFacts.ts`, `models/variableCommand.ts`, `tests/unit/affinityEventRules.test.ts`
- Test: `tests/unit/npcIntimacyEvidence.test.ts`, `tests/unit/affinityEventRules.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveNpcAdultEligibility` and Task 2 first-object fields.
- Produces: `detectNpcIntimacyEvent(body: string, npc: TeyvatNpcRecord, playerName: string): { tier: 'sex' | 'kiss' | 'flirt' | 'touch'; evidence: string } | null`.
- Extends `deriveNarrativeIntimacyFacts` options with `playerName` and `turn`, and allows its accepted `nsfw_archive` fact to carry first-object player ref, source `narrative`, and true event turn.

- [ ] **Step 1: Write failing tests** named `direct_confirmed_event_uses_highest_tier` and `third_party_or_uncertain_event_is_ignored`: assert `deriveNarrativeIntimacyFacts(body, records, options)` contains one `{ type:'npc', affinityDelta: 5 }` for an adult kiss+embrace, but `[]` for third-party reports, planned/denied/refused events, a named spectator, unknown adulthood and protected NPCs. Include player-name and second-person narrative examples plus each fixed value +30/+5/+3/+3.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/npcIntimacyEvidence.test.ts tests/unit/affinityEventRules.test.ts`; expect the new boundaries to fail.
- [ ] **Step 3: Implement `detectNpcIntimacyEvent`** as a conservative sentence-level parser: require direct player↔NPC attribution and completed affirmative action, reject ambiguous subjects rather than guessing. Keep evidence as an actual source excerpt; no invented padding may pass the evidence gate.
- [ ] **Step 4: Refactor `deriveNarrativeIntimacyFacts`** to use the detector, stable NPC ID and highest tier. Only accepted adult player↔NPC sex events emit first-object player ref and status change; do not promote age in the emitted fact.
- [ ] **Step 5: Re-run** both tests, `pnpm test:affinity-intimacy` and `pnpm test:nsfw-archive`; expect PASS.
- [ ] **Step 6: Commit** only Task 3 files with `fix: attribute intimacy only to confirmed player NPC events`.

### Task 4: 回合幂等与模型增量定向去重

**Files:**
- Modify: `hooks/useGame/variableSettlementWorkflow.ts`, `utils/variableFacts.ts`, `models/variableCommand.ts`
- Test: `tests/unit/variableSettlementWorkflow.test.ts`, `tests/unit/affinitySettlementBounds.test.ts`

**Interfaces:**
- Consumes: Task 3 accepted event with NPC ID, tier, evidence and `turn`; existing `VariableSettlementParams.settlementId` and `vbatch_${settlementId}`.
- Produces: `buildNpcIntimacyEventId(settlementId: string, turn: number, npcId: string, tier: string): string` in `utils/variableFacts.ts`; the committed variable batch/receipt is the single authoritative record. The ID is scoped by the existing per-save batch history, not by a new global store.

- [ ] **Step 1: Write failing tests** named `same_settlement_replay_is_idempotent`, `same_name_separate_save_is_independent`, and `keeps_independent_negative_model_fact`: assert replay leaves affinity unchanged, independent save/NPC ID still gets the event, a duplicate model +5 is removed while independent -3 remains, and rejected preflight reports no committed +5.
- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/variableSettlementWorkflow.test.ts tests/unit/affinitySettlementBounds.test.ts`; expect new assertions to fail.
- [ ] **Step 3: Implement the stable event ID** using `settlementId`, turn, NPC ID and tier, and anchor it to the existing per-save settlement batch/replay check. Do not add a second relation-history store.
- [ ] **Step 4: Replace name-wide model filtering** with same-NPC-ID, same-evidence/event duplicate filtering. Preserve independently justified positive/negative facts and keep the committed receipt aligned with accepted commands only.
- [ ] **Step 5: Re-run** both tests, `pnpm test:affinity-intimacy`, `pnpm test:nsfw-archive`, `pnpm exec tsc -b --pretty false`; expect PASS/exit 0.
- [ ] **Step 6: Commit** only Task 4 files with `fix: make intimacy affinity settlement idempotent`.

### Task 5: End-to-end regression gate

**Files:**
- Test: `tests/unit/npcFirstPartner.test.ts`, `tests/unit/npcIntimacyEvidence.test.ts`, `tests/unit/variableSettlementWorkflow.test.ts`

**Interfaces:** Consumes Tasks 1–4; produces no new runtime interface.

- [ ] **Step 1: Add failing integrated test** `reload_replay_preserves_partner_and_affinity` that constructs two same-name NPCs in separate save IDs, changes the traveler name after first event, reloads and replays the same settlement ID, then asserts `displayFirstPartner(...) === '新名字'`, affinity grew exactly once, experience count is 1 and non-player histories match their original values.
- [ ] **Step 2: Run** the new targeted test; expect failure before any final integration fix.
- [ ] **Step 3: Apply only the missing boundary wiring** shown by that failing test; do not broaden the age or legacy-migration rules.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm lint`, `pnpm build`, `pnpm test:affinity-intimacy`, `pnpm test:nsfw-archive`; expect all exit 0. Manually inspect confirmed-adult old save, uncertain-age old save, first partner after rename, and one duplicate recovery.
- [ ] **Step 5: Commit** any final NPC integration fixes with `test: cover NPC intimacy persistence across reload`.
