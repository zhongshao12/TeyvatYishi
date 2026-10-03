# 剧情资源与玩家覆盖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资源更新只刷新未编辑字段，玩家编辑和游戏进度可靠保留，收口 R03 双源漂移。

**Architecture:** 内置基线、逐字段覆盖与运行状态分离。先审阅当前两源差异，再迁移 v4 持久化及全部投影/装载入口，最后补界面来源提示和门禁。

**Tech Stack:** TypeScript、React、现有设置/存档服务、Node.js 资源脚本、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-03-story-resource-overrides-design.md`（用户已确认）。

## Global Constraints

- 新持久态版本为 v4。旧档没有可靠来源标记时，保留差异并提示，不静默覆盖。
- 不涉及 B08、B09；不增加发送硬上限；不改变已存篇章和分段 ID；不批量重置玩家进度。
- 空字符串、空数组是合法编辑；归一化默认值不能冒充旧档显式编辑。
- 自定义系列继续完整保存。资源生成显式执行，验证只检查不写文件。
- 沿用项目依赖，不升级依赖、不创建以玩家姓名为键的全局覆盖表；不推送 GitHub。

## Review Focus

- 旧 v2 字段根本不存在：不能制造空覆盖（Task 2）。
- 玩家编辑为空、编辑正文或 AI 重分解：保存/导入不能丢失（Task 2、3）。
- 资源删除当前分段或整个系列/新增同名系列：保留孤立覆盖和运行引用，按 ID 隔离（Task 2）。
- 加载/保存期间切档或自动推进并发：元数据不能跨档污染或回退（Task 3）。
- public 更长不代表正确：逐字段审阅总表独有事实，不能自动覆盖（Task 1）。

## 文件职责

- `data/storyWeavingPreset.ts`：资源装载及原公共入口，委托持久化模块，不继续膨胀。
- 新 `services/storyWeavingPersistence.ts`：基线、覆盖、v4 序列化/装载与旧档保守迁移。
- `models/storyWeaving.ts`、`models/teyvat/runtimeSlices.ts`、`hooks/useGameState.ts`：来源元数据及投影。
- `components/features/GameSystems/PlotPanel.tsx`：来源说明、旧档提示、恢复字段内置值。
- 新 `scripts/generate-story-weaving-canon-total.mjs`：经审阅后从 public 权威源生成总表。

### Task 1: 审阅并收口剧情资源双源

**Files:** 新建 `docs/reviews/2026-10-03-story-canon-source-diff.md`、`scripts/generate-story-weaving-canon-total.mjs`；修改 `data/storyWeavingCanonDecomposed.json`、`scripts/story-weaving-memory-regression.mjs`、`scripts/validate-story-weaving-canon.mjs`；仅在差异审阅证明需要时修改对应 public JSON。

**Interfaces:** 生成脚本提供 `--check`（只检查）与 `--write`（显式生成）；固定顺序取自内置预设清单。校验：完整系列/分段语义相等、ID 唯一、现有 canon validator 通过。

- [ ] **Step 1:** 输出 19 系列逐分段字段差异和枫丹/纳塔正文差异，逐项注明“public 新增 / 总表独有 / 冲突”。逐项审阅后记录去向，冲突未解决前不生成。
- [ ] **Step 2:** 为 `--check` 加入总表少一场景与正文改动的失败夹具；断言退出非零且所有输入字节不变。运行后观察真实失败，不只测 JSON 排版。
- [ ] **Step 3:** 实现生成器；只在审阅完成后用 `--write` 收口。保护场景节点、可见性与六国扩写，保留全部原 ID。
- [ ] **Step 4:** 运行生成器 `--check`、现有 canon 校验及 `node scripts/story-weaving-memory-regression.mjs`；应通过，同时保留至少两条断言防止枫丹/纳塔回退旧正文。
- [ ] **Step 5:** 审阅仅资源/脚本差异，形成独立本地提交；不混入其他工作区改动，不推送。

### Task 2: 基线与覆盖的 v4 往返

**Files:** 新 `services/storyWeavingPersistence.ts`、`tests/unit/storyWeavingPersistenceV4.test.ts`；修改 `models/storyWeaving.ts`、`data/storyWeavingPreset.ts`、`tests/unit/storyWeavingPresetMerge.test.ts`、`scripts/story-weaving-persistence-behavior-regression.mjs`。

**Interfaces:**

- `StoryBuiltinBinding`: `resourceRevision`、`seriesFieldFingerprints`、`segmentFieldFingerprints`、`seriesOverrides`、`segmentOverrides`、`orphanedSegments`；覆盖值按字段白名单校验。
- `StoryMigrationWarning`: `id`、`seriesId`、可选 `segmentId`、`field`、`reason: 'legacy_origin_unknown' | 'resource_removed'`。
- `剧情编织系统` 增加可选 `builtinBindings` 与 `migrationWarnings`；完整运行态和轻量 v4 传输态分开声明类型，避免靠不安全 cast 伪装完整原文。
- `bindStoryResourceBaseline(bundled: 剧情编织系统): 剧情编织系统`。
- `buildPersistedStoryWeavingSystem(system: 剧情编织系统): PersistedStoryWeavingV4`。
- `hydratePersistedStoryWeavingSystem(saved: unknown, bundled: 剧情编织系统): 剧情编织系统`。
- `restoreStoryBuiltinField(system, bundled, { seriesId, segmentId?, field }): 剧情编织系统`。
- 确定性序列化按对象键排序、数组保留顺序；指纹为 UTF-8 长度＋FNV-1a 64 位值，仅作变化检测，不作为安全凭证。公开函数继续从原 `data/storyWeavingPreset.ts` 导出。
- 系列内容白名单：标题、作品名、来源文件名、原始文本、章节列表、每段章数、核心角色摘要、核心角色、涉及地点索引、涉及派系索引。分段白名单为模型中全部内容字段，但排除 id、组号、启用注入、处理状态、运行状态、最近错误、updatedAt；字数根据最终原文重算，不单独覆盖。当前阶段概括与当前进度属于运行状态。ID、来源类型、内置预设 ID 不可由覆盖更改。

- [ ] **Step 1:** 写失败测试：旧基线下只改概括，资源更新正文/结束条件；hydrate 断言概括等于玩家值、正文和结束条件等于新资源、进度 ID/运行状态不变。
- [ ] **Step 2:** 增加空字符串/空数组/正文编辑、自定义系列、删除分段/整个系列、新同名系列、v2 缺字段、v3 差异保留并提示、重复加载幂等的具体断言；运行单文件并确认现实现失败。
- [ ] **Step 3:** 实现字段白名单、基线绑定、覆盖采集和新基线合并。原始字段存在性在归一化前捕获；不存在的字段采用资源，明确存在的旧差异标为来源未知覆盖。删除系列仍保留其已有覆盖与运行引用；旧轻量档没有保存的原文明确显示“资源不可用”，不能借其他同名系列填充或假称完整恢复。
- [ ] **Step 4:** 修改旧“资源刷新”测试，使输入确实包含旧资源基线且没有覆盖；保留“玩家修改必须恢复”的原断言。运行上述单测与持久化回归，应全部通过；普通内置态轻量体积仍须通过原门禁，真实正文编辑允许保存编辑正文。
- [ ] **Step 5:** 检查纯模型/序列化差异，独立本地提交。

### Task 3: 全入口来源元数据与 UI

**Files:** 修改 `models/teyvat/runtimeSlices.ts`、`hooks/useGameState.ts`、`hooks/useGame.ts`、`hooks/useGame/saveLoadWorkflow.ts`、`hooks/useGame/turnSnapshot.ts`、`hooks/useGame/postSettlementCommitStage.ts`、`hooks/useGame/variableCalibrationStage.ts`、`hooks/useGame/sendWorkflow.ts`、`components/features/GameSystems/PlotPanel.tsx`；新 `tests/unit/storyWeavingOverrideIntegration.test.tsx`；更新 `tests/unit/storyMainlineHydrationIntegration.test.ts`。

**Interfaces:** `StoryWeavingDto` 携带相同来源元数据；两向投影/归一化保留而不共享可变引用。设置装载允许 `unknown` 传输态，统一经 hydrate；自动推进/回滚调用同一持久化入口。

- [ ] **Step 1:** 添加真实投影往返、存档/设置/快照/导入导出往返、同名玩家双档隔离与延迟保存切档测试。断言覆盖值和来源元数据不丢、不互串、自动推进不被误记为内容覆盖。
- [ ] **Step 2:** 添加 UI 测试：旧档显示一次来源未知提示，点击“恢复此字段内置值”后该字段随下一版本更新，其他覆盖不变；保存失败保留草稿并显示失败。运行新测试观察失败。
- [ ] **Step 3:** 迁移所有入口并接入 UI。保存读取当前 session 与最新剧情版本，失败不得提前显示成功。显式恢复仅删除指定覆盖，不重置整个系列或当前进度。
- [ ] **Step 4:** 运行 `node node_modules/typescript/bin/tsc -b --force --pretty false`、全量 Vitest、完整回归、生产构建；两条旧剧情失败必须转绿，不删断言、不提高 App/useGameState 体量上限。
- [ ] **Step 5:** 审阅入口覆盖清单并独立本地提交；文档列出旧档保守迁移与恢复内置值的方法。

## 环境与执行交接

Windows 测试/构建使用进程级 TEMP/TMP 指向项目 `.tmp-regression`，不修改系统 ACL。使用现有 Node 入口，避免挂起的全局 pnpm shim；需要子进程权限时按实际工具审批运行。

本计划待用户审阅。建议在当前任务由主代理逐项执行；每项完成红→绿→回归后再做下一项。不自动合并 main 或推送 GitHub。
