# M6 拆分方案（`executeSendWorkflow` 巨型函数拆分）

> 状态：**待用户确认后执行**。本文件是持久化载体 —— 上一版方案只作为对话消息交付，
> 之后从上下文中丢失，无法据此施工。这次先落盘。
>
> 日期：2026-09-20
> 前置：回归基线已收敛到 **185/185 全绿**、`tsc` exit 0、`vitest` 101/600 全绿。
> 工作流源码视图（`scripts/lib/workflowSources.mjs`）与完整性门禁
> （`scripts/workflow-sources-integrity-regression.mjs`）已就位，正是为本次拆分准备的安全网。

---

## 1. 目标与硬约束（已批准，不可偏离）

| 项 | 约束 |
| --- | --- |
| 目标 | 把 `hooks/useGame/sendWorkflow.ts` 的 `executeSendWorkflow` 拆成独立阶段模块 |
| 懒加载 | 新模块**必须** `await import()`，不得静态 import，否则会进 app-core 反而撑大首屏 |
| 分包登记 | 新模块**必须**登记进 `build/manualChunkStrategy.ts:4` 的 allowlist（`return undefined`） |
| 体积预算 | 不得突破 `.bundle-budget.json` 的 `maxChunkBytes: 1200000`（app-core 当前约 1,141,796 B，余量约 58 KB） |
| 行为不变 | 拆分只搬运代码，不改行为；每步后 `node scripts/run-all-regressions.mjs` 必须仍 **185/185** |
| 其它门禁 | 每步后 `npx tsc -b` exit 0、`npx vitest run` 101 files/600 tests 全绿 |
| 断言 | 不得删除或弱化任何回归断言；断言若因搬迁失效，通过 `readWorkflowSources()` / `sliceWorkflowFile()` 解决 |
| 提交 | **不执行 `git commit`**，改动留给用户审阅 |

## 2. 现状（已侦察）

```
hooks/useGame/sendWorkflow.ts
  653  export async function executeSendWorkflow(   ← 巨型函数起点
  722    // 0.  reroll 回滚快照
  744    // 1.  Add user message（清理旧 assistant snapshot）
  763    // 2.  Build system prompt            ~331 行  ← 最大块之一
 1094    // 3.  Prepare messages for API
 1185    // 4.  Stream AI response（含自动重试循环）
 1311    // 5.  Build AI message
 1457    // 6.  Update memory
 1499    // 8.5 变量模型校准                    ~536 行  ← 最大块
 1877    // 9.5 元素附着与反应结算
 1910    // 10. Auto-save
 2045  }                                          ← 巨型函数终点（约 1393 行）
 2046  async function runVariableCalibrationStep(  ← 已抽出的相邻函数
```

**已有先例（机制已验证可用）**：`build/manualChunkStrategy.ts:4` 已登记 5 个抽出模块
`contextSnapshot` / `narrativeImageWorkflow` / `postSettlementRecoveryWorkflow` /
`variableSettlementWorkflow` / `postSettlementCommitStage`。照此模式继续即可。

**安全网已就位**：25 个曾直接读 `sendWorkflow.ts` 的脚本已全部收敛到工作流视图，
拆分时只需维护 `WORKFLOW_FILES` 登记表，**不需要改任何脚本、不需要删任何断言**。

## 3. 拆分步骤

> ⚠️ 待确认项：Step 2 与 Step 3 的模块名可从既有记录确证
> （`variableCalibrationStage`、`mainPromptAssembly`）；**Step 1 的具体身份我无法从仓库或当前上下文确证**
> —— 请确认 Step 1 是哪一个阶段（下方给出候选），或直接重新给出方案原文。

### Step 1 —— 待确认（候选）
按"M6 拆分方案"的三步设计，Step 1 最可能是以下之一：
- **候选 A：主叙事流式与重试阶段**（步骤 4，1185–1310）—— 与已有
  `services/ai/mainNarrativeAttemptRunner.ts` / `mainNarrativeRetryPolicy.ts` 同层，拆分后
  重试策略与流式会话可独立测试。
- **候选 B：记忆更新阶段**（步骤 6，1457–1498）—— 与已有 `memoryUtils.ts` /
  `postNarrativeMemoryStage.ts` 同层。
- **候选 C：本回合前置快照与用户消息阶段**（步骤 0–1，722–762）—— 体量小，适合作为
  第一个"打通流程"的样板（风险最低）。

### Step 2 —— `variableCalibrationStage`（步骤 8.5，1499–2034，约 536 行）
- 抽出为 `hooks/useGame/variableCalibrationStage.ts`
- 依赖：`services/ai/variableModel.ts`、`utils/variableRegistry.ts`、`utils/variableFacts.ts`、
  `utils/teyvatCommandRegistry.ts`、`services/teyvatTurnTransaction.ts`
- 注意：`executeSendWorkflow` 内约 40 个可变局部量被闭包捕获，抽取时以显式 `deps` 参数传入
  （参照既有 `SendWorkflowDeps`，`sendWorkflow.ts:342-351`）

### Step 3 —— `mainPromptAssembly`（步骤 2，763–1093，约 331 行）
- 抽出为 `hooks/useGame/mainPromptAssembly.ts`
- 依赖：`systemPromptBuilder.ts`、`promptModuleMessageInjection.ts`、`historyWindow.ts`、
  `mainRecallStage.ts`、`contextSnapshot.ts`
- 注意：`WORKFLOW_FILES` 中这些文件已登记，抽取后**无需改动任何回归脚本**

## 4. 每步的标准作业流程

1. 建模块文件，把目标行段搬过去；把闭包捕获的可变量改为显式 `deps` 参数。
2. 在 `sendWorkflow.ts` 里改为 `await import('./<module>')` 调用（保持原有执行时机）。
3. 把新模块加进 `build/manualChunkStrategy.ts:4` 的 allowlist 正则。
4. 维护 `scripts/lib/workflowSources.mjs` 的 `WORKFLOW_FILES`（新模块登记进去；
   若完整性门禁报"漏登记依赖"，按提示二选一处理）。
5. 跑门禁：`run-all-regressions`（必须 185/185）、`tsc -b`、`vitest run`，
   以及 `test:bundle-size`（确认 app-core 未超预算）。
6. 记录：本文件追加"第 N 步完成"小节（改动文件、搬运行数、门禁数字）。

## 5. 停止条件

- 任一门禁转红且无法在不弱化断言的前提下修复 → 停止并报告。
- app-core 超出 1,200,000 B → 停止并报告（不得提高预算）。
- 发现必须改行为才能拆分 → 停止并报告（M6 是纯搬运）。

---

## 6. 执行记录

### Step 1 —— ✅ 完成（2026-09-20）

**用户确认**：Step 1 = 候选 C（原步骤 0-1，`sendWorkflow.ts:722-761`）。

| 项 | 内容 |
| --- | --- |
| 新模块 | `hooks/useGame/sendPreparationStage.ts`（`prepareSendTurn`） |
| 搬运 | `sendWorkflow.ts` 722-761 行（40 行）→ 22 行懒加载调用 |
| 分包登记 | `build/manualChunkStrategy.ts:4` 加入 `sendPreparationStage` |
| 视图登记 | `WORKFLOW_FILES` 加入 `hooks/useGame/sendPreparationStage.ts`（38 → 39 个文件） |

**关键设计：三个外层可变量用「回调在原始位置回写」，而不是返回后统一赋值。**
原因不是风格而是行为等价：原实现里 `rollbackSnapshotOnAbort` 在
`await persistWorkflowRecoveryJournal(...)` **之前**就被赋值，而它在 `sendWorkflow.ts:1962-1968`
的回滚路径上被读取。若改成返回后统一赋值，则 journal 落库失败时该变量会是旧值 —— 真实的行为变更。

**踩到并修正的坑（M6 纪律）**：我第一次搬运时顺手把
`compactChatHistoryForLongSession(...)` 的换行重新格式化了，并让回调参数名变成 `snapshot`，
结果打红了两条断言（`save-performance-regression.mjs:77` 与
`story-weaving-memory-regression.mjs:61`，都是 `rollbackSnapshotOnAbort = preTurnSnapshot`）。
**修法是让搬迁后的文本与原文逐字一致，而不是改断言**：把回调参数命名为
`preTurnSnapshot` / `purgedHistory`，两处赋值原文即完全保留，断言一字未改。
→ 后续每一步都必须遵守：**只搬运，不重新格式化被搬动的代码。**

**门禁（全部通过）**：

```
npx tsc -b                             → exit 0
node scripts/run-all-regressions.mjs   → 185/185 通过, exit 0
npx vitest run                         → 101 files / 600 tests, exit 0
npm run build                          → exit 0
node scripts/bundle-size-regression.mjs→ exit 0
    app-core 1104.5 KB ≤ 1171.9 KB（1,130,959 B / 预算 1,200,000 B，余量 69,041 B）
    拆分前 1,141,796 B → 拆分后 1,130,959 B（**减少 10,837 B**）
```

**懒加载已验证**：产物中存在独立 chunk `sendPreparationStage-B7d-43BF.js`（2.3 KB）。
（注：app-core 里也能搜到 `prepareSendTurn` 这个名字 —— 那是
`const { prepareSendTurn } = await import(...)` 解构时保留的**属性名引用**，不是实现体内联；
实现体在独立 chunk 中，app-core 同步缩小即为证据。）

### Step 2 —— ⏳ 未开始（`variableCalibrationStage`，1499-2034）
### Step 3 —— ⏳ 未开始（`mainPromptAssembly`，763-1093）

> 注：Step 1 完成后 `sendWorkflow.ts` 行号整体前移 18 行，Step 2/3 的区间需重新定位。
### Step 2 —— ✅ 完成（2026-09-20）

| 项 | 内容 |
| --- | --- |
| 新模块 | `hooks/useGame/variableCalibrationStage.ts`（`runVariableCalibrationStage`，515 行） |
| 搬运 | `sendWorkflow.ts` 1481-1858 行（378 行）→ 44 行懒加载调用 |
| 文件规模 | `sendWorkflow.ts` 2042 → **1708 行**（−334） |
| 分包登记 | allowlist 加入 `variableCalibrationStage` |
| 视图登记 | `WORKFLOW_FILES` 38 → 40 个文件 |
| 附带 | `runVariableCalibrationStep` 改为 `export`（定义在 sendWorkflow、另有 2 处块外调用，故不能搬进 stage；stage chunk 静态依赖 app-core，无循环） |

**侦察手段（值得复用）**：未通读 378 行，而是用工具算出
①块内用到的外层标识符（**值用法**过滤，剔除 `source:` 这类属性名假依赖）；
②被写入的外层变量；③块内声明中在块后仍被使用的 10 个值（必须返回）；
④块内是否有**顶层 `return`**（结论：无，全在嵌套函数内 → 不需要早退信号量）。

**踩到的两个坑**：
1. 静态分析对**多行解构**（`const { a, b, ... } = x`）会漏检依赖。解决办法不是完善静态分析，而是**让 tsc 当权威**：
   生成模块后跑 `tsc -b --force`，它一次点全了 7 个缺失项（3 个依赖 + 2 个被 import 解析器漏掉的名字 + 1 个未导出的 helper）。
2. **结果类型交给 TS 推断**（不写显式 Result 接口），因此 13 个未知输出类型无需手工标注 —— 这是本步能一次编译通过的关键。

**门禁（全部通过）**：

```
workflow-sources-integrity-regression → exit 0（40 个文件）
node scripts/run-all-regressions.mjs   → 185/185 通过, exit 0
npx vitest run                         → 101 files / 600 tests, exit 0
npm run build                          → exit 0
node scripts/bundle-size-regression.mjs→ exit 0
    app-core 1095.6 KB ≤ 1171.9 KB（拆分前 1104.5 KB，累计从 1,141,796 B 降约 19 KB）
```

### Step 3 —— ✅ 完成（见下）
### Step 3 —— ✅ 完成（2026-09-20）

| 项 | 内容 |
| --- | --- |
| 新模块 | `hooks/useGame/mainPromptAssembly.ts`（`runMainPromptAssembly`，424 行） |
| 搬运 | `sendWorkflow.ts` 745-1074（330 行）→ 39 行懒加载调用 |
| 分包登记 | allowlist 加入 `mainPromptAssembly` |
| 视图登记 | `WORKFLOW_FILES` 40 → 41 个文件 |
| 附带 | `compactForRerollInstruction` 改为 `export`（模块顶层 helper，块外另用 1 次） |

**本步踩到并解决的问题（对后续同类工作有普遍价值）**：

1. **单行解构盲区**：侦察器对 `const { a, b, c } = x;`（单行）漏检，导致 `updatedHistory` / `userMsg`
   被当成未声明。**修法不是把静态分析做得更全，而是以 tsc 为权威** —— 它一次点全 8 个缺失项。
2. **`sliceWorkflowFile` 的代价显形**：Tavern V2 的断言写死了
   `sliceWorkflowFile('hooks/useGame/sendWorkflow.ts', 'tavernV2Messages = buildTavernMessageChain({', …)`，
   代码搬到新模块后直接抛错。**这个失败是响亮且精确的**（报出缺失标记名），
   而不是静默变绿 —— 说明当初"用抛错语义替代 `indexOf >= 0` 断言"的设计是对的。
   新增 `sliceWorkflowMarker(fromMarker, toMarker)`：按标记在已登记文件中自动定位，
   **0 个命中抛错、≥2 个命中抛错**，因此抗搬迁且不会退化成"随便命中一个就算过"。
   两处调用已迁移。

**门禁（全部通过）**：

```
workflow-sources-integrity-regression → exit 0（41 个文件）
npx tsc -b --force                     → exit 0
node scripts/run-all-regressions.mjs   → 185/185 通过, exit 0
npx vitest run                         → 101 files / 600 tests, exit 0
npm run build                          → exit 0
node scripts/bundle-size-regression.mjs→ exit 0
    app-core 1089.3 KB ≤ 1171.9 KB
```