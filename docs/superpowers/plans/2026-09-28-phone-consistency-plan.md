# 手机评论、来信与备注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让朋友圈评论完整落盘、角色来信不泄漏控制格式，并提供不改变角色身份的联系人备注。

**Architecture:** 继续使用 `CourierSystem` 与现有评论修订号守卫。模型输出在进入手机状态前统一验证；备注是联系人显示字段，不参与 NPC、消息和提及的身份匹配。

**Tech Stack:** TypeScript、React、Vitest、现有手机 AI 客户端。

**Spec:** `docs/superpowers/specs/2026-09-28-phone-codex-profile-consistency-design.md` 手机章节。

## Global Constraints

- 不用姓名作联系人主键；备注不改 `CourierContact.name`、NPC 姓名或消息发送人姓名。
- 每条朋友圈最多三位当前合格联系人评论；编辑/删除后的旧请求不得回填。
- 模板标签与系统字段不得作为手机消息显示；不把不完整 AI 输出当成功评论。
- 不新增依赖，旧存档无备注时照常显示原名。

## Review Focus

- 恰好 120 字但无句末且明显被截断：Task 1 验证失败/重试，不误判为完整。
- 动态修改时前一版请求晚到：Task 1 验证 revision 守卫不回填。
- `<time_format> time: ... scene: ...` 混入事件事实：Task 2 验证提示词和最终来信都不泄漏。
- 模型润色失败：Task 2 验证已生成的本地信仍可投递且不含原始标签。
- 两位同名 NPC 仅一人被备注：Task 3 验证另一联系人、消息身份和 @ 匹配不变。

---

### Task 1: 朋友圈评论完整性

**Files:**
- Modify: `services/ai/courierMomentComments.ts`, `hooks/useGame/courierMomentWorkflow.ts`（仅在现有失败状态不足时）
- Test: `tests/unit/courierMomentComments.test.ts`, `tests/unit/courierMomentWorkflow.test.ts`

**Interfaces:**
- Produces: `validateMomentComment(raw: string, npcName: string): string`；无效时抛 `MOMENT_COMMENT_INVALID`。
- `generateMomentComment(config: API配置项, input: MomentCommentInput): Promise<string>` 最多独立尝试两次，第二次仍无效即抛错供现有失败/重试 UI 使用。

- [ ] **Step 1: 写失败测试** `rejects_cut_off_comment_then_retries_once`：第一次返回缺少完整句末的半句，第二次返回完整短句，只落第二次；两次无效则目标为 failed、不写评论。`stale_revision_cannot_append_comment`：旧修订请求晚到后评论数组不变。已有非目标评论保留。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/courierMomentComments.test.ts tests/unit/courierMomentWorkflow.test.ts`；新增断言先失败。
- [ ] **Step 3: 实现** 上述验证函数，保留 1～120 字、单行、无元文本规则；句末允许中文/英文终止标点或完整表情，不用直接补句号掩盖截断。生成请求预留足够输出 token，但仍遵守 API 配置的硬限制。沿用现有 session/post/revision 检查。
- [ ] **Step 4: 重跑定向测试与** `node ./node_modules/typescript/bin/tsc -b --pretty false`；通过后仅提交本项，提交信息 `fix: reject truncated phone moment comments`。

### Task 2: 来信控制格式清理

**Files:**
- Modify: `services/ai/courierService.ts`, `services/ai/courierLetterModel.ts`, `hooks/useGame/courierBackgroundJobs.ts`（若兜底路径需调整）
- Test: `tests/unit/courierNaturalMessages.test.ts`, `tests/unit/courierLetterModel.test.ts`

**Interfaces:**
- Produces: `sanitizeCourierSeedFact(context: string): string`，供 `extractCourierSpeechEvent` 和本地兜底共享。
- `generateCourierLetter` 仍返回纯角色消息；含 `<time_format>`、`time:`、`scene:`、系统说明时拒收，由现有后台任务保留本地投递。

- [ ] **Step 1: 写失败测试** `paimon_letter_ignores_time_format_markup`：含用户报告的多行时间/场景标签的种子，提示词仅含可知事件，最终 AI/本地来信不含标签；`failed_polish_keeps_clean_local_delivery`：AI 泄漏标签时本地消息仍在，且与游戏时间显示不冲突。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/courierNaturalMessages.test.ts tests/unit/courierLetterModel.test.ts`；新增断言先失败。
- [ ] **Step 3: 实现** 纯种子清理及最终输出校验；只移除控制格式，不凭空改写事实、角色记忆或游戏时钟。保留已存在的本地兜底投递路径。
- [ ] **Step 4: 重跑定向测试、TypeScript 和** `node scripts/phone-reply-quality-regression.mjs`；通过后提交 `fix: strip control markup from phone letters`。

### Task 3: 联系人备注与存档往返

**Files:**
- Modify: `models/teyvat/courier.ts`, `components/features/Courier/CourierModal.tsx`, `components/features/Courier/CourierContactTools.tsx`, `components/features/Courier/CourierConversationList.tsx`
- Create: `services/courierContactRemark.ts`
- Test: `tests/unit/courierContactRemark.test.ts`, `tests/unit/courierContactTools.test.ts`, `tests/unit/courierModalBehavior.test.ts`

**Interfaces:**
- `CourierContact.remark?: string`，`normalizeCourierSystem` 保留长度不超过 40 字的备注。
- Produces: `setCourierContactRemark(system: CourierSystem, contactId: string, remark: string): CourierSystem` 和 `displayCourierContactName(contact: CourierContact): string`；空备注删除覆盖值。

- [ ] **Step 1: 写失败测试** `remark_survives_normalization_without_renaming_npc`、`same_name_contacts_keep_distinct_remarks`、`remark_is_visible_and_can_be_cleared`：ID 精确修改、存档归一化保留、聊天与联系人显示备注、清空恢复原名，@ 匹配仍用角色原名。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/courierContactRemark.test.ts tests/unit/courierContactTools.test.ts tests/unit/courierModalBehavior.test.ts`；新增断言先失败。
- [ ] **Step 3: 实现** 联系人备注的纯变换函数与编辑 UI；不改 NPC/消息 identity，不把备注送入模型人格资料；沿用现有手机状态持久化。
- [ ] **Step 4: 重跑定向测试、TypeScript 与手机相关回归脚本；通过后提交** `feat: add persistent phone contact remarks`。

### Task 4: 手机批次回归

**Files:** Test only: `tests/unit/courierMomentComments.test.ts`, `tests/unit/courierNaturalMessages.test.ts`, `tests/unit/courierContactRemark.test.ts`

- [ ] **Step 1: 补交叉测试**：备注后的角色仍按原名生成评论及 @ 回复；动态编辑/删除与来信并发不串手机会话或存档。
- [ ] **Step 2: 运行** 手机定向 Vitest、`node ./node_modules/eslint/bin/eslint.js .`、`node ./node_modules/vite/bin/vite.js build`；均退出 0，记录既有 warning。
- [ ] **Step 3: 若有必要，仅提交测试/集成修正** `test: cover phone comment letter and remark consistency`。
