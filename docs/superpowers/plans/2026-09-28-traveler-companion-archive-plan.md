# 旅人档案与同伴归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让旅人基础档案可编辑、关系图归属旅人，并让同伴可归档和恢复而不丢失人物历史。

**Architecture:** 继续以现有旅行者和 NPC 状态为唯一数据源。复用 `RelationshipGraphPanel`；归档仅改变 NPC 的可见/活跃状态并保留原阶位，不删除记录或手机联系人。

**Tech Stack:** TypeScript、React、Vitest、现有 Teyvat/legacy 双向映射。

**Spec:** `docs/superpowers/specs/2026-09-28-phone-codex-profile-consistency-design.md` 旅人档案与同伴归档章节。

## Global Constraints

- 玩家姓名不能为空；取消编辑不能改变存档或私密档案首次对象引用。
- 关系事件只来自已提交变量批次，不能从当前好感度伪造历史。
- 归档保留 NPC 稳定 ID、记忆、关系和手机联系人；恢复不自动入队。
- 旧档无归档字段时默认为未归档；不新增依赖。

## Review Focus

- 玩家改名后首次对象显示旧名：Task 1 验证 `player` 引用仍显示新名。
- 取消编辑后旧值被状态写入：Task 1 验证状态对象未变。
- 图节点点击后同伴页没有选中该角色：Task 2 验证跨面板跳转。
- 归档同行角色后依然注入主剧情或留在队伍：Task 3 验证活跃筛选与同行标记。
- 旧档/同名角色归档错位：Task 3 验证按 ID 往返、另一同名人物不受影响。

---

### Task 1: 旅人基础资料编辑

**Files:**
- Modify: `components/features/Character/TravelerProfileModal.tsx`, `App.tsx`（仅必要的保存反馈连接）
- Test: `tests/unit/travelerProfileEdit.test.tsx`

**Interfaces:**
- `TravelerProfileModal` 继续接收 `traveler`、`onTravelerChange`；增加本地草稿和“编辑／保存／取消”。
- `validateTravelerProfileDraft(draft: 角色数据结构): string | null` 可提取到 `models/character.ts` 或同目录小模块；姓名非空、年龄为非负整数、身高符合现有数据类型。

- [ ] **Step 1: 写失败测试** `cancel_keeps_traveler_unchanged`、`save_updates_basic_fields_once`、`player_reference_displays_renamed_traveler`：编辑姓名、别名、性别、年龄、身高、生日、身份、外貌、性格、背景；取消不调用回调；无效值有错误；保存一次更新且不更改元素/等级等派生字段。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/travelerProfileEdit.test.tsx tests/unit/npcFirstPartner.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** UI 草稿和校验，不在键入时写游戏状态；继续沿用已有 `onTravelerChange` 存档路径。
- [ ] **Step 4: 重跑定向测试与 TypeScript；通过后提交** `feat: edit traveler basic profile safely`。

### Task 2: 关系图与最近变化迁入旅人档案

**Files:**
- Modify: `components/features/Character/TravelerProfileModal.tsx`, `components/features/GameSystems/CompanionPanel.tsx`, `App.tsx`
- Reuse: `components/features/GameSystems/RelationshipGraphPanel.tsx`, `utils/relationshipGraph.ts`
- Test: `tests/unit/travelerRelationshipGraph.test.tsx`, `tests/unit/affinityChangeHistory.test.ts`

**Interfaces:**
- `TravelerProfileModal` 新增 `npcRecords: NPC记录[]`、`variableBatches: 变量命令批次[]`、`onSelectNpc: (id: string) => void`。
- `CompanionPanel` 新增 `focusNpcId?: string` 供旅人档案点击节点后打开同一 NPC；原 `graph` 标签移除，保留复用组件而非复制图数据。

- [ ] **Step 1: 写失败测试** `graph_in_traveler_profile_opens_selected_npc`、`recent_events_use_committed_delta`：中心显示当前玩家名、事件 +/−/绝对设置正确，点击图节点关闭旅人档案并聚焦同伴；同伴页无旧关系图入口。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/travelerRelationshipGraph.test.tsx tests/unit/affinityChangeHistory.test.ts`；新增测试先失败。
- [ ] **Step 3: 接入** 现有 `RelationshipGraphPanel` 与 App 导航状态。旅人档案只读取已提交批次；没有 NPC 时显示已有空态。
- [ ] **Step 4: 重跑定向测试与 TypeScript；通过后提交** `feat: move relationship graph into traveler profile`。

### Task 3: 同伴归档、恢复与活跃筛选

**Files:**
- Modify: `models/npc.ts`, `models/teyvat/character.ts`, `hooks/useGameState.ts`, `components/features/GameSystems/CompanionPanel.tsx`, `hooks/useGame/systemPromptBuilder.ts`
- Create: `services/npcArchiving.ts`
- Test: `tests/unit/npcArchiving.test.ts`, `tests/unit/companionPanelBehavior.test.ts`, `tests/unit/teyvatRuntimeReducer.test.ts`

**Interfaces:**
- `NPC记录.已归档?: boolean`、`归档前阶位?: NPC阶位`；Teyvat DTO 使用 `archived?: boolean`、`tierBeforeArchive?: 'companion' | 'extra'`，归一化与双向映射保留。
- Produces: `archiveNpc(record: NPC记录): NPC记录`（保存阶位、置 `同行=false`、将活跃阶位降为 extra、标记归档）与 `restoreNpc(record: NPC记录): NPC记录`（恢复原阶位但保持 `同行=false`）；重复操作幂等。

- [ ] **Step 1: 写失败测试** `archived_party_member_leaves_active_prompt_but_keeps_history`、`restore_keeps_identity_without_rejoining_party`、`same_name_and_legacy_roundtrip_isolated_by_id`：记录仍在、记忆/好感/手机联系人不删除、主剧情活跃同伴提示词不含归档者、读档能恢复、另一同名 NPC 不变。
- [ ] **Step 2: 跑** `node ./node_modules/vitest/vitest.mjs run tests/unit/npcArchiving.test.ts tests/unit/companionPanelBehavior.test.ts tests/unit/teyvatRuntimeReducer.test.ts`；新增测试先失败。
- [ ] **Step 3: 实现** 纯归档函数、DTO/adapter 往返、同伴页“已归档”列表及恢复按钮；所有活跃同伴筛选排除已归档角色，历史关系图仍可看到该角色。
- [ ] **Step 4: 重跑定向测试、TypeScript、NPC/手机身份回归；通过后提交** `feat: archive and restore companions by stable id`。

### Task 4: 档案批次回归

**Files:** Test only: `tests/unit/travelerProfileEdit.test.tsx`, `tests/unit/travelerRelationshipGraph.test.tsx`, `tests/unit/npcArchiving.test.ts`

- [ ] **Step 1: 补存读档与导航交叉测试**：旅人改名、同名 NPC、归档恢复、关系图打开档案连续执行后资料不串。
- [ ] **Step 2: 运行**相关 Vitest、全量 TypeScript、Lint 与构建；均退出 0，记录既有 warning。
- [ ] **Step 3: 如有集成修正单独提交** `test: cover traveler and companion archive continuity`。
