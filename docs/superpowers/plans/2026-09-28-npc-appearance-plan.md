# NPC 外貌与常用穿着档案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让人物外貌字段完整、来源清晰、可安全补全，并防止临时换装覆写常用穿着。

**Architecture:** 在现有 NPC 上存结构化字段与来源，不替换自由文本外貌。AI 只提交经校验的空字段；三围和内衣沿用已确认成年门禁，所有写入经领域纯函数后再进状态/存档。

**Tech Stack:** TypeScript、React、Vitest、现有 `chatCompletion`、Teyvat/legacy 映射。

**Spec:** `docs/superpowers/specs/2026-09-28-phone-codex-profile-consistency-design.md` 外貌、常用穿着与成年私密字段章节。

## Global Constraints

- AI 推测仅填空并明确标注“AI 推测”；不覆盖原著、手动、正文明确资料。
- 未确认成年、未成年或受保护角色不得生成/显示三围与内衣。
- 内衣不由 AI 猜测，只由手动修改或明确剧情证据写入。
- 临时换装不覆盖常用穿着；旧档原 `穿着` 视为常用值且不伪造来源。
- 不新增依赖，不以模型自身声称“成年”通过年龄门禁。

## Review Focus

- 一次 API 响应含合法字段和一个无效数值：Task 2 验证整次不提交半份资料；仅返回合法的部分字段时允许补齐该部分空白。
- AI 返回成年声明和三围，但 NPC 年龄仍未知：Task 2 验证三围不写不显示。
- 重复补全或角色改名：Task 2 验证已有值/来源不变、按 NPC ID 写入。
- 正文只写“今天换了衣服”：Task 3 验证常用穿着不变、互动记忆仍可记录。
- 旧档有 `穿着`、私密档案未知年龄：Task 1/3 验证存读档后原常用衣着保留且私密字段继续受门禁。

---

### Task 1: 外貌字段与来源的存档契约

**Files:**
- Modify: `models/npc.ts`, `models/teyvat/character.ts`, `hooks/useGameState.ts`, `components/features/GameSystems/CompanionPanel.tsx`
- Test: `tests/unit/npcAppearanceArchive.test.ts`, `tests/unit/teyvatRuntimeReducer.test.ts`

**Interfaces:**
- Produces: `NPC外貌字段 = { value: string; source: 'canon' | 'manual' | 'narrative' | 'ai_estimate' }`；`NPC外貌档案` 可选键 `发色 | 瞳色 | 身高 | 体重 | 三围`，挂在 `NPC记录.外貌档案?`。Teyvat DTO 对应 `appearanceFacts`，逐键保留 value/source。
- `三围` 读写及 UI 展示调用 `resolveNpcAdultEligibility(input: NpcAdultEligibilityInput)` 的既有成年判定，不由外貌字段自身提供年龄证据。

- [ ] **Step 1: 写失败测试** `appearance_facts_roundtrip_with_source` 与 `unknown_age_hides_measurements`：五项空值显示“未记录”，已知值的来源往返；未知年龄即使旧档带三围，普通 UI 也不显示该字段内容。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/npcAppearanceArchive.test.ts tests/unit/teyvatRuntimeReducer.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** 新类型、归一化、legacy/Teyvat 映射和同伴页字段展示；`外貌` 自由文本与已有原著基准不删改。
- [ ] **Step 4: 重跑定向测试、TypeScript；通过后提交** `feat: persist sourced NPC appearance facts`。

### Task 2: AI 空白字段补全与人工校正

**Files:**
- Create: `services/ai/npcAppearanceEstimate.ts`, `services/npcAppearanceFacts.ts`
- Modify: `components/features/GameSystems/CompanionPanel.tsx`, `App.tsx`（传入现有活动 API 配置）
- Test: `tests/unit/npcAppearanceEstimate.test.ts`, `tests/unit/companionPanelBehavior.test.ts`

**Interfaces:**
- Produces: `generateNpcAppearanceEstimate(config: API配置项, npc: NPC记录): Promise<Partial<NPC外貌档案>>`；仅返回可解析候选，不直接写状态。
- Produces: `applyNpcAppearanceEstimate(npc: NPC记录, estimate: Partial<NPC外貌档案>): NPC记录`；只填空，统一标注 `ai_estimate`，成人门禁禁止未确认成年者的三围。
- 手动更正经 `setNpcAppearanceFact(npc, key, value): NPC记录` 写 `manual` 来源；身高、体重、三围校验格式和合理范围，拒绝半份无效输出。

- [ ] **Step 1: 写失败测试** `fills_only_blanks_and_marks_ai_estimate`、`rejects_partial_invalid_response`、`unknown_age_cannot_accept_measurements`、`manual_value_survives_regeneration`：API 输出按姓名/ID 绑定，空白才填，错误无局部落盘，手动更正优先。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/npcAppearanceEstimate.test.ts tests/unit/companionPanelBehavior.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** 受限 JSON 生成与纯校验/应用函数；只把当前角色资料作为上下文，拒绝模型输出年龄证明、内衣或额外字段；UI 有加载、失败和可手动改写反馈。
- [ ] **Step 4: 重跑定向测试、TypeScript 与相关 API 回归；通过后提交** `feat: estimate missing NPC appearance facts`。

### Task 3: 常用穿着稳定性与成人内衣字段

**Files:**
- Modify: `models/npc.ts`, `models/teyvat/character.ts`, `hooks/useGameState.ts`, `components/features/GameSystems/CompanionPanel.tsx`, `utils/variableFacts.ts`, `services/ai/variableModel.ts`
- Create: `utils/npcUsualClothing.ts`
- Test: `tests/unit/npcUsualClothing.test.ts`, `tests/unit/nsfwArchiveLongTermFacts.test.ts`, `tests/unit/variableSettlementWorkflow.test.ts`

**Interfaces:**
- Existing `NPC记录.穿着` 保持存档键，UI 名称为“常用穿着”。
- Produces: `shouldReplaceUsualClothing(current: string | undefined, next: string, evidence: string, manual?: boolean): boolean`：空基准可首次填充，非空基准仅手动或明确持久变化时替换。
- `NPC_NSFW档案.常用内衣?` / mature DTO `usualUnderwear?` 仅已确认成年女性可写/显示；AI 外貌补全永不产生此字段。

- [ ] **Step 1: 写失败测试** `temporary_outfit_does_not_replace_usual_clothing`、`explicit_permanent_change_updates_usual_clothing`、`adult_underwear_roundtrip_but_unknown_age_is_blocked`；含旧档 `穿着` 原值与一次临时换装。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/npcUsualClothing.test.ts tests/unit/nsfwArchiveLongTermFacts.test.ts tests/unit/variableSettlementWorkflow.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** 持久性判定并在 legacy/Teyvat 两条变量写入通路调用；私密字段在模型、归一化、映射与 UI 边界统一走成年门禁；临时服装可留同行记忆。
- [ ] **Step 4: 重跑定向测试、TypeScript、私密档案回归；通过后提交** `fix: keep usual clothing stable and gate underwear archive`。

### Task 4: 外貌批次回归

**Files:** Test only: `tests/unit/npcAppearanceArchive.test.ts`, `tests/unit/npcAppearanceEstimate.test.ts`, `tests/unit/npcUsualClothing.test.ts`

- [ ] **Step 1: 补旧档/新档、同名角色、未成年证据、取消 AI 请求的交叉测试**；每个断言通过稳定 ID 与年龄门禁检查。
- [ ] **Step 2: 跑**全量单测、TypeScript、Lint、生产构建；均退出 0，记录既有 warning。
- [ ] **Step 3: 如有集成修正单独提交** `test: cover NPC appearance archive boundaries`。
