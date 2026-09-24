# 朋友圈状态解释与单人评论重试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让玩家在朋友圈明确看到评论资格、接口状态和编辑后果，并只重试失败的那位角色。

**Architecture:** 资格人数复用 `selectMomentCommenters` 的联系人与好感度规则，但单独计算总合格人数，不因每条动态最多三位评论而截断。手机模型配置由 App 现有 `resolveCourierApiConfig` 判定后传入界面。失败重试意图携带 NPC ID，异步工作流只领取该目标，保留会话、修订和当前好感度校验。

**Tech Stack:** React 19、TypeScript、Vitest/jsdom。

**Spec:** `docs/superpowers/specs/2026-09-23-remaining-player-experience-design.md` 第二批“朋友圈说明”。

## Global Constraints

- 仅玩家发帖；评论者必须是可用手机联系人且好感度严格大于 `NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD`（100），单条动态最多三位评论。
- 编辑正文会清空旧评论，增加修订号；旧修订的模型结果不得写回。
- 无合格角色或无有效手机 API 时不伪造评论；不展示 API 密钥或原始异常。
- 保留当前 `codex/` 分支和全部未提交改动，不暂存或提交混合工作树。

## Review Focus

- 同一 NPC 被多个联系人引用：资格人数只计一次；联系人不可用不计入。
- 好感度恰好 100：不满足严格高于阈值；101 才满足。
- 动态已有两位失败：点其中一位只重试该位，不再次生成另一位。
- 重试期间切档、编辑或删除动态：迟到评论不得写回。
- API 未配置或合格人数为零：界面说明不会产生评论，玩家仍能发布和编辑自己的动态。

---

### Task 1: 资格人数与编辑后果提示

**Files:**
- Modify: `services/courierMoments.ts`
- Modify: `components/features/Courier/CourierMomentsPanel.tsx`
- Modify: `components/features/Courier/CourierModal.tsx`
- Modify: `App.tsx`
- Test: `tests/unit/courierMomentsActions.test.ts`, `tests/unit/courierMomentsUi.test.ts`

**Interfaces:**
- Produces: `countEligibleMomentCommenters(contacts: readonly CourierContact[], npcs: readonly NPC记录[]): number`，去重并按现有严格阈值判定；`CourierModal` 接收 `canGenerateMomentComments?: boolean`；`CourierMomentsPanel` 接收 `eligibleCommenterCount: number` 和 `canGenerateComments: boolean`。

- [ ] **Step 1: 写失败测试。** 一名 NPC 的两个可用联系人只计一次；好感度 100 不计、101 计；不可用联系人不计。UI 测试断言“仅你可以发布”“当前有 N 位角色符合评论条件”“生死挚友（好感度超过 100）”，零资格和 API 未配置均有不会收到评论的说明。点“编辑”后，在保存按钮旁看到“保存修改将清空旧评论，并按新内容重新生成”；取消不改修订，确认后旧评论被清空。
- [ ] **Step 2: 跑 `node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsActions.test.ts tests/unit/courierMomentsUi.test.ts --reporter=dot`，确认新断言 RED。**
- [ ] **Step 3: 实现。** `countEligibleMomentCommenters` 从 `selectMomentCommenters` 提取共享的去重合格集合，但保留原选择函数按动态 ID 排序取前三的行为；不要用选择结果长度冒充总人数。`CourierModal` 从 `npcRecords`/`courier.contacts` 计算人数。`App` 用当前手机 API 覆盖和主配置调用 `resolveCourierApiConfig`，检查返回配置的 HTTP(S) 地址、密钥及模型 ID 是否已填写，仅作为“本地字段已配置”的布尔状态，不声称网络可达。面板显示资格、未配置解释和编辑警示，不改变发帖动作。
- [ ] **Step 4: 定向测试、TypeScript、变更文件 Lint；不提交混合文件。**

### Task 2: 单个失败评论重试

**Files:**
- Modify: `components/features/Courier/CourierMomentsPanel.tsx`
- Modify: `components/features/Courier/CourierModal.tsx`
- Modify: `App.tsx`
- Modify: `hooks/useGame/courierMomentWorkflow.ts`
- Test: `tests/unit/courierMomentsUi.test.ts`, `tests/unit/courierMomentWorkflow.test.ts`
- Modify: `PLAYER_EXPERIENCE_ROADMAP.md`

**Interfaces:**
- Consumes: Task 1 的资格信息。
- Produces: `onRequestMomentComments(postId: string, revision: number, npcId?: string)`；`runMomentComments(deps, postId, revision, npcId?: string)`。没有 `npcId` 是新发帖/编辑后的最多三人生成；指定 `npcId` 仅重试该修订中已经标记为 `failed` 的目标。

- [ ] **Step 1: 写失败测试。** 两个失败目标下，点击“重试安柏评论”传入 `amber`，任务只调用一次安柏生成器；更新原来整条动态“评论生成失败，重试”的 UI 断言。指定不存在、已完成或生成中的 NPC ID 时不发请求。切档、修订或删除后迟到结果仍被丢弃。测试 API 无配置时该目标维持失败且没有模板评论。
- [ ] **Step 2: 跑 `node node_modules/vitest/vitest.mjs run tests/unit/courierMomentsUi.test.ts tests/unit/courierMomentWorkflow.test.ts --reporter=dot`，确认新断言 RED。**
- [ ] **Step 3: 实现。** 每个失败目标独立显示以可辨识姓名命名的按钮；`CourierModal` 透传 NPC ID；`App` 的待处理请求按 `postId + revision + npcId` 区分，同动态不同人的重试不互相覆盖，切档仍清除旧请求。`runMomentComments` 的指定 ID 分支先检查该修订的目标状态确为 `failed`，其余生成、资格重验、写回护栏保持不变。
- [ ] **Step 4: 运行定向及全量单测、TypeScript、变更文件 Lint、现有手机回归脚本、生产构建、`git diff --check`。将实际通过数量和未手工验收项记入路线图，不把设计目标写成完成；不提交混合文件。**
