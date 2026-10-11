# 逐回合记忆完整性与世界树共享压缩实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 每个完整回合都能独立总结并追溯原文；安全重建指定范围，统一自动、手动和世界树压缩，修复重建弹窗被遮挡。

**Architecture:** 沿用四层数组与世界树，用可选来源映射增强存档，不新建事件数据库。来源选择、分层晋升、范围合并分别为纯业务边界；异步协调器持有会话身份与独立取消控制器，读取 live root 后提交记忆和世界树的同一更新。重建重试复用逐回合 staging，不重复请求成功回合。

**Tech Stack:** React 19、TypeScript、Vite、Vitest/jsdom、pnpm；沿用现有 API 客户端、IndexedDB/桌面存档服务和 Modal 焦点栈，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-11-memory-integrity-and-irminsul-compression-design.md`（用户已确认，提交 `bfbf8b8`）。

## Global Constraints

- 每个完整回合独立生成摘要；批大小仅用于进度分组，不决定一次摘要的回合数量。顺序调用，执行前显示基础调用数量。
- 即时→短期、短期→中期、中期→长期分别使用已有设置；不足一个完整批次保留原层。
- 保留原文、实际来源回合列表和世界时刻；未知历史信息保持未记录，不拿当前时间补历史。
- 只替换所选可定位、未被手动编辑的来源；范围外、跨范围、来源未知及玩家编辑条目保留。
- 失败、取消、切档、重掷或处理来源改变不能覆盖原记忆；无关编辑与追加合并保留。
- 保留 `hasVerifiedIrminsulCoverage` 与 `promoteIrminsulEntry`；不能仅凭模型声称、回合编号或容量目标删除来源。
- pending 不参与召回；失败来源在手动重试前不被每回合重复请求。
- 不新增发送前硬上限，不扩大历史召回窗口，不调用收费模型或操作真实玩家存档来验证。
- 不合并 main、不推送；每个实现任务只提交其自有文件，保留当前未提交手机改动及其报告。
- 生产体积门禁不得放宽；当前 app-core 1170.7 KB 接近 1171.9 KB 门限，新增异步重建协调模块应按需加载。

## Review Focus

1. 来源映射超过 2,000 项或重复回合编号：活跃来源不能在归一化/存档投影中截断，编号不能替代消息身份（任务 1、4）。
2. 历史条目缺少 ID、日期或完整玩家配对：保留旧记录并列出缺口，不生成虚假历史（任务 1、2、4）。
3. 等待期间主回合追加、玩家删除或修改被处理条目：无关新增保留，处理来源变化拒绝旧结果且不复活删除（任务 2、5）。
4. 最后模型请求刚完成时取消或切档、保存队列尚未执行时切档：不得提交到新档，保存文案不能提前报成功（任务 4、5）。
5. 关闭/重开弹窗、连点执行、Esc 与小屏键盘导航：不发双份请求、只取消当前整理、焦点回到正确入口（任务 5、7）。

## 文件边界与共享接口

新增模块保持单一职责：`models/memorySource.ts` 定义来源 DTO；`services/memorySources.ts` 读取与绑定来源；`services/memoryMaintenanceMerge.ts` 范围与 delta 合并；`services/memoryLayerCompression.ts` 共享晋升；`hooks/useGame/memoryMaintenanceStage.ts` 任务/提交协调。原 `memoryUtils.ts` 保留公开接口并逐步委托，不增加另一份循环；原 `memoryRebuild.ts` 保留公开任务 API。

共享类型（以下签名为实施契约，所有任务使用同名类型）：

```ts
type MemorySourceLayer = 'immediate' | 'short' | 'middle' | 'long';
interface MemorySourceItem {
  id: string | null; layer: MemorySourceLayer; text: string;
  sourceTurns: number[]; sourceMessageIds: string[]; sourceEntryIds: string[];
  momentRange: WorldMomentRange | null; generatedFingerprint: string | null;
}
interface MemoryMaintenanceState { memory: 记忆系统; irminsul: IrminsulMemory }
interface MemoryLayerThresholds { immediateToShort: number; shortToMiddle: number; middleToLong: number }
interface MemoryMaintenanceProgress {
  phase: 'turns' | 'short' | 'middle' | 'long' | 'saving';
  processedTurns: number; totalTurns: number; currentTurn: number | null;
}
interface MemoryMaintenancePatch {
  removed: MemorySourceItem[]; added: MemorySourceItem[];
  archiveUpserts: IrminsulEntry[]; archiveRemoved: IrminsulEntry[];
  failureUpserts: 记忆失败草稿[];
}
```

实现中的 import 使用现有 `WorldMomentRange`、`IrminsulEntry`、`记忆系统` 类型，不重新定义。摘要原文通过世界树档案保存；来源列表只保存身份，不复制一份完整聊天到每条元数据。

### Task 1: 来源模型、世界时刻与存档往返

**Files:** Create `models/memorySource.ts`, `services/memorySources.ts`, `tests/unit/memorySourceIntegrity.test.ts`; Modify `models/memory.ts`, `models/chat.ts`, `models/teyvat/runtimeSlices.ts`, `hooks/useGameState.ts`, `hooks/useGame/memoryUtils.ts`, `hooks/useGame/variableCalibrationStage.ts`, `services/teyvatSaveMigration.ts`。

**Interfaces:** Produces `readMemorySourceItems(state: MemoryMaintenanceState): MemorySourceItem[]`, `fingerprintMemoryText(text: string): string`, `resolveRebuildTurnMoment(turn: number, message: 聊天消息, state: MemoryMaintenanceState): WorldMomentRange | null` in `services/memorySources.ts`。

- [x] **1. RED tests:** `memorySourceIntegrity.test.ts` 添加 `roundtrips_sparse_turns_and_moments`（来源 `[3,5]` 不能变为 `[3,4,5]`）、`retains_2001_live_moment_entries`、`legacy_missing_moment_stays_unknown`、`edited_text_does_not_refresh_generated_fingerprint`、`malformed_ids_and_turns_do_not_grant_replace_authority`。测试真实 normalize→Legacy 投影→JSON→存档归一化链路。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memorySourceIntegrity.test.ts tests/unit/memoryWorldMoment.test.ts`；新断言因缺少来源保存/旧 2000 条截断而失败，已有世界时刻用例不能意外失败。
- [x] **3. Implement:** Legacy 新增 `来源回合?: Record<string, number[]>`、`生成文本指纹?: Record<string,string>`；runtime 对应 `sourceTurnsById`、`generatedTextFingerprints`；聊天新增可选 `worldMoment?: WorldMoment` 并在结算成功时写入对应 assistant。更新双向投影、归一化和迁移；回合列表只接受非负安全整数、去重排序。移除对活跃来源映射的 2000 条盲截断；生成时写入文本指纹，手动编辑保留旧指纹。指纹不是安全认证：提交同时比较原值，不能仅凭非加密散列授权删除。历史时刻仅接受精确单回合来源，不从跨回合边界猜测内部日期。
- [x] **4. Verify GREEN:** 上述测试及 `pnpm exec vitest run tests/unit/memoryWorldMomentUi.test.tsx`、`pnpm test:reroll-snapshot`；`pnpm exec tsc -b --force`。
- [x] **5. Commit:** 只暂存本任务实际改动文件，提交 `fix: preserve memory source identity through save projections`。

### Task 2: 局部范围合并与来源变化拒绝

**Files:** Create `services/memoryMaintenanceMerge.ts`, `tests/unit/memoryMaintenanceMerge.test.ts`; Modify `services/memoryRebuild.ts`（仅接入范围准备，不改模型循环）。

**Interfaces:** Consumes Task 1 的来源读取；Produces `prepareMemoryRebuildScope(state: MemoryMaintenanceState, range: MemoryRebuildRange): { replaceable: MemorySourceItem[]; retained: MemorySourceItem[]; warnings: string[] }` 与 `mergeMemoryMaintenancePatch(base: MemoryMaintenanceState, live: MemoryMaintenanceState, patch: MemoryMaintenancePatch): { ok: true; state: MemoryMaintenanceState } | { ok: false; code: 'source_changed'; message: string }`。

- [x] **1. RED tests:** 重建 10–20，保留 1–9、21 以后、跨范围 `[9,10]`、无来源、已编辑条目；实际新增 `[10,12]` 不制造 11。处理 ID 被删除、修改、移动层级时拒绝；无关新增/编辑合并保留。重复提交相同 patch 不重复追加；重复 ID/相同文本不同身份不得误删。失败草稿范围外保持原值。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryMaintenanceMerge.test.ts`；先使测试调用真实导出的业务函数，不以 mock 实现代替断言。
- [x] **3. Implement:** 按稳定 ID、原文和生成指纹识别可替换条目；无可靠来源 fail-closed 保留。原档删除只按实际 verified coverage 结果生成 delta；内存层替换不等于删除世界树原文。合并同时维护同索引 ID、来源回合、时刻、指纹和失败草稿；对已经完全应用的同一结果幂等，对部分应用/来源变动拒绝。
- [x] **4. Verify GREEN:** `pnpm exec vitest run tests/unit/memoryMaintenanceMerge.test.ts tests/unit/irminsulPromotion.test.ts tests/unit/archiveEntryLimits.test.ts tests/unit/postNarrativeMemoryStage.test.ts`。
- [x] **5. Commit:** `fix: limit memory rebuild replacement to verified source ranges`。

### Task 3: 共享分层晋升与失败来源保护

**Files:** Create `services/memoryLayerCompression.ts`, `tests/unit/memoryLayerCompression.test.ts`; Modify `hooks/useGame/memoryUtils.ts`, `hooks/useGame/postNarrativeMemoryStage.ts`, `models/memory.ts`, `models/teyvat/runtimeSlices.ts`, `hooks/useGameState.ts`, `tests/unit/memoryCompressionCoverage.test.ts`。

**Interfaces:** Produces `readMemoryLayerThresholds(settings: 记忆系统设置): MemoryLayerThresholds`; `runMemoryLayerCompression(input: { state: MemoryMaintenanceState; turn: number; settings: 记忆系统设置; summarizer: MemoryRebuildSummarizer; mode: 'automatic' | 'rebuild' | 'manual' | 'irminsul'; signal?: AbortSignal; onProgress?: (progress: MemoryMaintenanceProgress) => void }): Promise<{ state: MemoryMaintenanceState; patch: MemoryMaintenancePatch; failures: 记忆失败草稿[]; blockedReason?: string }>`。保持原自动函数返回字段兼容。

- [x] **1. RED tests:** 配置阈值 2/3/4，24 条即时记录最终得到 1 条长期；余额停留正确。添加第 51 条即时记忆仍保留前 50 条的原文/身份。API 503 失败保留原层来源，不能把 fallback 晋升；下一回合同一失败来源零重复请求，两个文本相同但 ID 不同来源分别有失败草稿。手动重试未改变的保留来源可以晋升，改变的来源拒绝覆盖。关闭 API 零 fetch。未达阈值零 summarizer。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryLayerCompression.test.ts tests/unit/memoryCompressionCoverage.test.ts`；记录旧行为导致的失败。
- [x] **3. Implement:** 提取现有阈值和来源调度，自动压缩委托共享函数；取消 `addImmediateMemory` 的未归档 50 条截断。新增失败草稿 `sourceIds?: string[]` 并在 Legacy/runtime/normalize 往返保留；失败源与 pending 排除下一次自动选择，手动重试例外。API 失败保留源层且记录 pending 档案，不添加“成功摘要”到上层。修改原 `retryMemoryFailureDraft`：有 sourceIds 的新草稿按身份和完整材料核验保留来源，成功后执行共享晋升；旧 fallback 草稿保留既有精确替换分支，缺乏唯一证据时拒绝。支持世界树独立 short/medium 候选，按 ID 与绑定数组去重，跳过 refined 原文锚点和缺乏身份的档案。有效候选仍完整发送，现有原文覆盖/软容量逻辑不放松。
- [x] **4. Verify GREEN:** 上述测试、`tests/unit/postNarrativeMemoryStage.test.ts`、`tests/unit/irminsulPromotion.test.ts`、`tests/unit/archiveEntryLimits.test.ts`，并执行 `node scripts/memory-tier-regression.mjs`、`node scripts/memory-compression-threshold-regression.mjs`。既有 fallback 用例修改为“保留原源＋pending”的新契约，保留失败材料、重试、覆盖核验断言，不能直接删用例。
- [x] **5. Commit:** `fix: share memory promotion rules without discarding pending sources`。

### Task 4: 逐回合 staging、断点重试与批次进度

**Files:** Modify `services/memoryRebuild.ts`, `services/memoryCompression.ts`; Create `tests/unit/memoryRebuildPerTurn.test.ts`; Modify `scripts/memory-rebuild-regression.mjs`, `scripts/memory-failure-draft-regression.mjs`。

**Interfaces:** 保留 `createMemoryRebuildTask(options)`、`runMemoryRebuildTask(task, options)`；任务新增 `nextTurnIndex: number`、`turnSummaries: MemorySourceItem[]`、`stagedIrminsul: IrminsulMemory`、`phase: 'turns' | 'compression' | 'ready'`；设置新增可选 `thresholds: MemoryLayerThresholds`，废弃单一 compressionThreshold 的上层复用。输入 options 增加来源状态与范围准备结果。现有 `commitMemoryRebuildTask` 不再承担无范围的整片更新，由 Task 5 使用安全 patch 提交。

- [x] **1. RED tests:** batchSize 15/30 都对 15 回合独立调用 short 15 次，每次只含该回合玩家输入＋有效正文；重掷只总结当前最后有效回复，流式/失败回复不纳入。第 8 回合失败，重试后 1–7 请求各一次，8 可重试。短期全部成功、中期失败后重试不重发 short。最后请求返回后 signal 已取消不得 ready。无正文回合 4、7 明确出现在缺口提示，不伪造摘要。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryRebuildPerTurn.test.ts`；确认旧批次聚合和已成功回合重复请求断言失败。
- [x] **3. Implement:** 每个回合成功立即写任务 staging 与游标、发送一次进度；持久游戏状态暂不改动。原文创建稳定来源档案，所有摘要保留来源和原文指向；分层步骤委托 Task 3。任务记录失败回合/晋升步骤，用完整材料重试；批大小仅折算 completedBatches。每次 await 后检查取消，调用前检查当前阶段/配置；空输出或 fallback 暂停，不当成功。摘要生成的事实充分性不由固定 3–6 条保证：保留原文并允许摘要按内容输出，不再以 8 行硬截断丢弃摘要结果；不修改独立供应商输出 token 配置。
- [x] **4. Verify GREEN:** `pnpm exec vitest run tests/unit/memoryRebuildPerTurn.test.ts tests/unit/memoryLayerCompression.test.ts tests/unit/memoryCompressionCoverage.test.ts`；`node scripts/memory-rebuild-regression.mjs` 与 `node scripts/memory-failure-draft-regression.mjs`，更新为逐回合/范围契约而非旧循环字符串。
- [x] **5. Commit:** `fix: rebuild memory per turn with resumable staged summaries`。

### Task 5: 会话级整理协调、原子更新与保存身份

**Files:** Create `hooks/useGame/memoryMaintenanceStage.ts`, `services/memoryMaintenanceRegistry.ts`, `tests/unit/memoryMaintenanceSession.test.tsx`, `tests/unit/memoryMaintenanceSave.test.ts`; Modify `hooks/useGame.ts`, `hooks/useGame/memorySaveTask.ts`, `hooks/useGame/saveLoadWorkflow.ts`。

**Interfaces:** 在 saveLoadWorkflow 导出只读 `getActiveSaveTreeIdentity(): { rootId: string; nodeId: string } | null`。registry 定义 `MemoryMaintenanceLease { id: string; sessionId: number; rootId: string | null; signal: AbortSignal; cancel(): void; release(): void }`，导出 `tryAcquireMemoryMaintenanceLease(sessionId: number, rootId: string | null): MemoryMaintenanceLease | null` 及 `isMemoryMaintenanceBusy(sessionId: number): boolean`。新协调器工厂 `createMemoryMaintenanceCoordinator(deps: { getState: () => UseGameStateReturn; getConfig: () => API配置项 | null }): { runRebuild(options: Parameters<UseGameReturn['actions']['handleBatchMemoryRebuild']>[0]): Promise<MemoryRebuildTask>; compress(mode: 'manual' | 'irminsul', layer?: MemorySourceLayer): Promise<void>; retryDraft(id: string): Promise<void>; cancel(): void; dispose(): void }`。`persistMemorySnapshot` 增加可选 context `{ expectedSessionId: number; expectedRootId: string | null; signal?: AbortSignal }`。

- [x] **1. RED tests:** 延迟 summarizer 后切档、重开、重掷、删除源条目：新档 root 和保存调用零改变。无关即时记忆追加仍保留。模型结束后、保存入队前切档零提交；已构建 payload 入队后切档只能取消或仍指向原档，不能绑定新档元数据。持久化抛错显示 applied-but-unsaved，不显示成功；重试只保存原提交，不重发模型。重复 run 只一份任务，cancel 不触发主回合 controller.abort。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryMaintenanceSession.test.tsx tests/unit/memoryMaintenanceSave.test.ts`；测试真实 React runtime 更新与合成 DB adapter，禁止只测试一个永真 guard mock。
- [x] **3. Implement:** 独立 controller/任务租约在开始时绑定 session、来源与当前存档身份；无存档元信息的新开局绑定 session，首次保存后只允许采用同一 session 的根。resume 校验原任务身份与消息材料。用 `updateGameState` 同一次 updater 更新 `withLegacyMemory(current, result.memory)` 与世界树，先在该 updater 中比较 live 源值，不依赖旧 `s.记忆`。失败草稿、retry/ignore 和落盘入口均守卫；尚未持久化时保存提示真实。入口用动态 import 加载整理模块，保持类型 import-only，避免把整套重建加入 app-core。卸载、会话切换取消租约。
- [x] **4. Verify GREEN:** 本任务测试及 `tests/unit/liveGameStateRead.test.ts`、`tests/unit/saveStatusIntegration.test.ts`、`tests/unit/postNarrativeMemoryStage.test.ts`；执行 `pnpm test:save-isolation`。证明已有主回合中止/存档目标行为未改。
- [x] **5. Commit:** `fix: guard memory maintenance commits by live session and source identity`。

### Task 6: 所有入口迁移到共享整理规则

**Files:** Modify `hooks/useGame.ts`, `hooks/useGame/postNarrativeMemoryStage.ts`, `hooks/useGame/variableCalibrationStage.ts`, `hooks/useGame/memoryUtils.ts`, `components/features/GameSystems/MemoryPanel.tsx`, `App.tsx`; Create `tests/unit/memoryMaintenanceEntryPoints.test.tsx`。

**Interfaces:** `UseGameReturn.actions` 增加 `handleCompressMemory(layer?: MemorySourceLayer): Promise<void>`、`handleCompressIrminsul(): Promise<void>`、`handleCancelMemoryMaintenance(): void`。MemoryPanel 新增 `onCompress?: (layer: MemorySourceLayer) => Promise<void>`；已有三个压缩按钮统一委托，不能留绕过世界树的本地数组替换路径。自动路径消费 Task 5 的 registry API，在 `finally` 释放自己的租约，不释放别的任务租约。

- [x] **1. RED tests:** 手动、自动、世界树相同阈值/材料得到一致来源与晋升；pending 不再自动请求；档案独立来源与绑定数组同 ID 只请求一次；来源不足零请求。手动压缩运行时自动入口仅新增本回合原文并提示暂缓，不同时整理同一批。旧手动撤销入口若仍保留，必须原子恢复记忆＋世界树且核对未被更改；不能只恢复文字数组留下错误档案。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryMaintenanceEntryPoints.test.tsx tests/unit/memoryUpdateStageCommitted.test.ts`。
- [x] **3. Implement:** 将原按钮的同步本地压缩改为 Task 5 委托并真实显示状态；不强制压缩不足阈值余量。自动路径使用同一 session 租约的短期占用机制，手动运行时保留当前原文而暂缓整理。自动反馈明确区分未达阈值、关闭 API、本地模式、配置缺失、失败待重试、来源变化。手动 API 分支替换为取消/失败保留，不沿用仅文字数组的撤销；本地模式如提供撤销必须携带双状态 delta，并在来源已变时拒绝。
- [x] **4. Verify GREEN:** 本任务测试和任务 3、5 的关联测试；`node scripts/memory-compression-threshold-regression.mjs`、`node scripts/memory-tier-regression.mjs`、`node scripts/memory-failure-draft-regression.mjs`。
- [x] **5. Commit:** `refactor: route memory maintenance entrypoints through shared rules`。

### Task 7: 世界树一键压缩、逐回合进度与弹窗覆盖层

**Files:** Modify `components/ui/Modal.tsx`, `components/layout/AppPanels.tsx`, `components/features/GameSystems/IrminsulPanel.tsx`, `components/features/GameSystems/MemoryPanel.tsx`, `App.tsx`; Create `tests/unit/memoryRebuildModal.test.tsx`; Modify `tests/unit/irminsulPanel.test.tsx`, `tests/unit/modalFocusBehavior.test.ts`。

**Interfaces:** Modal 新增可选 `portal?: boolean`、`layer?: 'default' | 'nested'`，默认保持现状；nested 为 body portal、z-60，高于 z-50 系统面板，低于既有 z-130 确认窗。IrminsulPanel 新增 `onCompress?: () => Promise<void>`、`onCancelCompression?: () => void`、`maintenanceProgress?: MemoryMaintenanceProgress | null`、`maintenanceStatus?: string`。MemoryRebuildModal 保留原 onRun 入口，onAbort 改接本任务取消。

- [x] **1. RED tests:** MemoryRebuildModal 位于 body 且高于 SystemDrawer；Tab 留在栈顶，Esc 不关闭下方记忆面板，关闭后返回入口；连点开始只调用一次 onRun。15 回合显示基础 15 次请求及逐回合进度、缺失列表；取消没有已保存成功文案。世界树按钮调用一次协调器，忙时禁用、可以取消；无候选显示原因。普通 Modal 仍保持原层级和挂载方式。
- [x] **2. Verify RED:** `pnpm exec vitest run tests/unit/memoryRebuildModal.test.tsx tests/unit/irminsulPanel.test.tsx tests/unit/modalFocusBehavior.test.ts`。
- [x] **3. Implement:** 重建开启 portal/nested，复用可访问性栈和恢复逻辑；文案改为逐回合总结、局部范围合并，不声称四层全覆盖。展示实际 phase、当前回合、processedTurns、基础调用数、warnings、保存结果与范围保留提醒。世界树绑定 Task 6 入口，显示一键压缩/取消/反馈；失败提示与原失败草稿页保持关联。
- [x] **4. Verify GREEN:** 上述 UI 测试、`tests/unit/memoryWorldMomentUi.test.tsx` 与 `node scripts/memory-panel-mobile-regression.mjs`；使用本地合成状态分别在 390×844 和 1440×900 浏览器视口检查覆盖、点击、滚动、Esc 和焦点，不使用真实玩家数据库。若没有浏览器环境，保留自动化证据并明确标注视觉验收未完成，不能用 jsdom 冒充真实布局。
- [x] **5. Commit:** `feat: expose safe irminsul compression and accessible rebuild progress`。

### Task 8: 整体复审、回归与交付证据

**Files:** Create `docs/reviews/2026-10-11-memory-integrity-repair.md`；其余文件只修复上述任务引入且有失败用例的缺陷，不扩展其它子项目。

- [x] **1. Confirm scope:** `git status --short`、逐文件 diff 与计划勾选核对；保留手机改动，不能把其它工作区改动当作本计划提交。
- [x] **2. Focused verification:** 运行全部新增记忆测试及既有 WorldMoment、coverage、promotion、postNarrative、saveStatus、Modal 测试；修改文件执行 ESLint 和 `git diff --check`。
- [x] **3. Full verification:** PowerShell 设置 `$env:TEMP='C:/Users/zhong/Desktop/KaiTuoYiShi-main/yuanshen/.tmp-regression'`、`$env:TMP=$env:TEMP` 后运行 `pnpm test`；必须等待最终退出码，记录单测、回归、资源、构建与体积实际数字。不可放宽 app-core 门禁，应按边界按需加载消除增量体积问题。
- [x] **4. Independent review:** 使用 requesting-code-review 技能完成一次全分支只读复审；先修 Critical/Important 并回归，再报告。审阅跨档、来源覆盖、重复请求、残留控制器和小屏弹窗，不能以模型的“应该没问题”代替测试。
- [x] **5. Report/commit evidence:** 报告 RED→GREEN、恢复/保存/浏览器证据、真实供应商与不可恢复旧数据限制。文档单独提交 `docs: record memory integrity verification and residual risks`；不自动合并、不推送。

## 自查与执行交接

设计的来源完整性对应任务 1–2，重建/断点对应任务 4，三类整理与世界树对应任务 3、6–7，会话与落盘对应任务 5，覆盖层与交互对应任务 7，全量验收对应任务 8。所有 Review Focus 均有指定测试。新增函数返回类型和 DTO 以上述 Interfaces 为准，禁止绕开它们重新实现第二份压缩/提交循环。

建议选择 **Native：在当前任务逐项实施**。这些任务共享来源与提交接口，由同一执行者按顺序维护接口更省上下文成本；最后进行独立整体复审。若用户选择子代理驱动，则逐任务交由新的实现者和审阅者执行。用户先审阅此计划并确认执行方式，然后才进入产品代码修改。
