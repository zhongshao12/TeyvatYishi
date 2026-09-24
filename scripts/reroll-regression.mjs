import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function readSource(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

// 迁移: 主剧情工作流读取源由单个 sendWorkflow.ts 收敛为 scripts/lib/workflowSources.mjs 登记的工作流视图。
// 理由: 断言保护的是「重roll 行为」，不是「代码在哪个文件」。原先手工追加新归属文件的做法
//       （mainNarrativeRequestStage.ts / mainNarrativeRetryPolicy.ts 等）每次搬迁都要再来一遍，
//       故改用统一登记表；WORKFLOW_FILES 已含这些文件，断言范围不会被搬迁悄悄缩小。
// 等价性: readWorkflowSources() 不做换行归一化，而 readSource() 会把 CRLF 归一为 LF；
//       已核实 WORKFLOW_FILES 全部 38 个文件均为纯 LF，故两者对本视图语义等价。
// 保留显式读取的非视图文件：useGame.ts / chat.ts / TurnItem.tsx / saveLoadWorkflow.ts / steambirdWorkflow.ts
//       （其中 steambirdWorkflow.ts 已登记但也在此精确读取）/ settings.ts / dbService.ts / saveRuntimeCompactor.ts。
const source = readWorkflowSources();
const useGameSource = readSource('hooks/useGame.ts');
const chatSource = readSource('models/chat.ts');
const turnItemSource = readSource('components/features/Chat/TurnItem.tsx');
const saveLoadSource = readSource('hooks/useGame/saveLoadWorkflow.ts');
const steambirdSource = readSource('hooks/useGame/steambirdWorkflow.ts');
const settingsSource = readSource('models/settings.ts');
const dbSource = readSource('services/dbService.ts');
const compactorSource = readSource('utils/saveRuntimeCompactor.ts');
// 迁移: 重roll 的相似度/守卫工具、重试预算与相似度阈值已从 sendWorkflow.ts 拆到请求装配阶段与策略模块。
// 为保住这些断言保护的「行为」而不是「文件位置」，把新归属文件一并纳入读取源（mainNarrativeRequestStage.ts
// 已在 scripts/lib/workflowSources.mjs 的 WORKFLOW_FILES 中登记，这里按脚本自身需要精确读取）。
const requestStageSource = readSource('hooks/useGame/mainNarrativeRequestStage.ts');
const retryPolicySource = readSource('services/ai/mainNarrativeRetryPolicy.ts');
const rerollValidationSource = readSource('services/ai/mainNarrativeValidation.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('const preTurnSnapshot = compactPreTurnSnapshot({'), 'sendWorkflow 必须先构建轻量回滚快照。');
assert(!source.includes('cloneForSnapshot(state.相册)'), 'sendWorkflow 不得在压缩前完整深拷贝相册图片。');
assert(compactorSource.includes('new WeakMap<object, unknown>()'), '快照压缩必须使用 WeakMap 隔离重复对象引用。');
assert(compactorSource.includes('const compacted = compactDataImages({'), '快照必须对整个初步状态递归移除大型运行数据。');
assert(!compactorSource.includes('structuredClone'), '快照压缩不得在递归独立复制后再次深拷贝。');
assert(compactorSource.includes('return compacted;'), '快照压缩必须直接返回一次性独立复制结果。');
assert(!source.includes('state.setPendingVariable(false);\n\n      const npcSource'), '变量模型结束后不得提前解除后台结算锁。');
assert(source.includes('const assertWorkflowActive = () =>'), '后台结算阶段必须有当前工作流闸门。');
// 迁移: 旧 `assertWorkflowActive();\n    mem = compression.memory`
//   -> 新 `assertWorkflowActive();\n    let mem = memorySettlement.memory;`，
//   理由: 记忆压缩已抽成 settlePostNarrativeMemory 阶段，返回值由 compression 改名为 memorySettlement，
//   且 mem 从「压缩前声明」改为「await 之后再声明」。改用正则匹配两者相邻，不再锁定固定缩进。
//   断言意图不变：记忆压缩 await 之后必须先检查当前工作流，避免旧记忆写回。
assert(/assertWorkflowActive\(\);\s*let mem = memorySettlement\.memory;/.test(source), '记忆压缩 await 后必须检查当前工作流，避免旧记忆写回。');
assert(source.includes('shouldCommit: isCurrentWorkflow'), '新闻/变量等子流程必须接收当前工作流提交闸门。');
// 迁移: 旧 `assertWorkflowActive(); const turnRecallEntry = buildIrminsulArchiveEntry({`
//   -> 新 `assertWorkflowActive(); const taskResult = runPostTurnIrminsulArchiveTask({`，
//   理由: 世界树归档已抽成 runPostTurnIrminsulArchiveTask 阶段（buildIrminsulArchiveEntry 移入 postTurnIrminsulTask.ts），
//   闸门仍紧贴在归档调用之前，且在归档返回后再次检查（见 runIrminsulArchiveJob）。
//   断言意图不变：世界树归档前必须检查当前工作流，避免重roll后旧纪要写回。
assert(/assertWorkflowActive\(\);\s*const taskResult = runPostTurnIrminsulArchiveTask\(\{/.test(source), '世界树归档前必须检查当前工作流，避免重roll后旧纪要写回。');
assert(source.includes("buildSavePayload(state, 'auto', undefined, readLiveGameState(state))"), '自动存档必须从活体根保存真实 turnCount。');
assert(source.includes('# 重roll生成约束'), '重roll请求必须注入避重复约束。');
assert(source.includes('重roll nonce'), '重roll请求必须带 nonce，避免同上下文确定性复刻。');
// 迁移: 这四个纯函数从 sendWorkflow.ts 搬到 hooks/useGame/mainNarrativeRequestStage.ts（只搬运，未改行为），
// 理由: 主叙事请求装配被拆成独立阶段。断言意图不变，改为在请求装配阶段的源码里检查同一批工具函数。
assert(requestStageSource.includes('function normalizeRerollCompareText'), '重roll必须规范化正文用于相似度检测。');
assert(requestStageSource.includes('function calculateRerollSimilarity'), '重roll必须计算上一版与新版的相似度。');
assert(requestStageSource.includes('function buildRerollGenerationGuard'), '重roll必须在消息尾部追加强避重复约束。');
assert(requestStageSource.includes('function buildRerollSimilarityRetryGuard'), '重roll相似时必须追加自动换写提示。');
assert(source.includes('apiMessages.push(创建聊天消息(\n        \'user\',\n        buildRerollGenerationGuard'), '重roll强约束必须作为最后 user 消息进入主请求。');
// 迁移: 旧 `calculateRerollSimilarity(candidateText, deps.rerollContext.previousResponse)` 在 sendWorkflow 内联
//   -> 新 同一调用在请求装配阶段使用 options.rerollContext（阶段入参由 deps 改名为 options）。
//   断言意图不变：主剧情必须对重roll候选正文做相似度校验。
assert(requestStageSource.includes('calculateRerollSimilarity(candidateText, options.rerollContext.previousResponse)'), '主剧情必须对重roll候选正文做相似度校验。');
// 迁移: 旧 sendWorkflow 内联 `rerollSimilarity >= 0.86`
//   -> 新 阈值收敛进 decideMainNarrativeValidation（services/ai/mainNarrativeValidation.ts）的 input.rerollSimilarity >= 0.86。
//   断言意图不变：重roll相似度阈值必须锁定，防止一模一样回复放行。
assert(rerollValidationSource.includes('input.rerollSimilarity >= 0.86'), '重roll相似度阈值必须锁定，防止一模一样回复放行。');
// 迁移: 旧 `buildRerollSimilarityRetryGuard(deps.rerollContext.previousResponse, rerollSimilarity)` 单行调用
//   -> 新 同名调用改为多行实参（options.rerollContext.previousResponse / nextRerollSimilarity）。
//   理由: 阶段内变量由 rerollSimilarity 改名为 nextRerollSimilarity，并拆行书写；改用正则匹配，不锁定换行。
//   断言意图不变：重roll过像时必须追加换写守卫后重试。
assert(
  /buildRerollSimilarityRetryGuard\(\s*options\.rerollContext\.previousResponse,\s*nextRerollSimilarity,?\s*\)/.test(requestStageSource),
  '重roll过像时必须追加换写守卫后重试。',
);
assert(source.includes('重roll结果与上一版过于相似，正在强制换写。'), '重roll过像时必须在队列中提示正在强制换写。');
// 迁移: 旧 sendWorkflow 内联 `const maxAttempts = (deepSeekMainActive || deps.rerollContext...) ? Math.max(2, configuredMaxAttempts)`
//   -> 新 sendWorkflow 把预算交给 resolveMainNarrativeMaxAttempts，并以
//      `requiresValidationRepair: Boolean(deepSeekMainActive || deps.rerollContext || hasRequiredParty)` 声明「重roll 需要校验修复」，
//      策略侧以 `return input.requiresValidationRepair ? Math.max(2, configured) : configured;` 保证至少 2 次尝试。
//   理由: 重试预算抽成纯策略函数，reroll 触发条件仍在 sendWorkflow 决定。断言意图不变：
//   重roll即使未开启自动重试，也必须至少保留一次换写重试机会。
assert(
  source.includes('requiresValidationRepair: Boolean(deepSeekMainActive || deps.rerollContext || hasRequiredParty),')
  && retryPolicySource.includes('return input.requiresValidationRepair ? Math.max(2, configured) : configured;'),
  '重roll即使未开启自动重试，也必须至少保留一次换写重试机会。',
);
assert(chatSource.includes('rerollSimilarity?: number') && chatSource.includes('rerollSimilarityRetried?: boolean'), '聊天 debugContext 必须保存重roll相似度诊断。');
assert(turnItemSource.includes('重roll相似度') && turnItemSource.includes('重roll自动换写'), '请求上下文必须展示重roll相似度与自动换写状态。');
assert(useGameSource.includes('rerollContextRef'), 'useGame 必须保存一次性重roll上下文。');
assert(useGameSource.includes('previousResponse'), 'reroll 必须记录上一版回复摘录供避重复。');
assert(useGameSource.includes('onAfterSend: () => {\n          rerollContextRef.current = null;'), '重roll上下文必须在发送结束后清空。');
assert(
  useGameSource.includes('state.loading || state.pendingVariable')
  || useGameSource.includes('s.loading || s.pendingVariable'),
  '重roll入口必须在后台结算期间硬阻止。',
);
assert(steambirdSource.includes('buildSteambirdWorkflowRequest(params.publicFacts)'), '蒸汽鸟报子流程必须只从公开事实 DTO 构造结果。');
// 迁移: 旧 `steambirdGenerationResult?.changed` -> 新 `taskResult.changed`，
//   理由: 蒸汽鸟报生成已抽成阶段任务对象，返回值由 steambirdGenerationResult 改名为 taskResult（见 runSteambirdJob）。
//   断言意图不变：蒸汽鸟报写入前必须先过当前工作流闸门，且只写入闸门通过后的结果。
assert(
  /assertWorkflowActive\(\);\s*steambirdAfterGeneration = taskResult\.news;[\s\S]*?if \(taskResult\.changed\) state\.set蒸汽鸟报\(steambirdAfterGeneration\)/.test(source),
  '蒸汽鸟报写入前必须检查当前工作流闸门。',
);
assert(settingsSource.includes('turnCount?: number'), '存档数据必须持久化真实 turnCount。');
assert(
  saveLoadSource.includes('const baseGame = explicitBaseGame ?? state.game;') &&
    saveLoadSource.includes('const legacyCompatible = applyLegacyGameStateOverrides(baseGame, legacyCompatibleOverrides);'),
  '保存负载必须在正式状态根上应用本回合覆盖，保留真实 turnCount。',
);
assert(!saveLoadSource.includes('delete clean.preTurnSnapshot'), '本地存档必须保留最新 preTurnSnapshot，读档后立即重roll才能完整回滚变量切片。');
assert(
  saveLoadSource.includes('const nextGame = normalizeTeyvatGameState(classified.state);') &&
    saveLoadSource.includes('dependencies.replaceGameState(nextGame);'),
  '读档必须通过正式状态归一化与原子替换恢复真实 turnCount。',
);
assert(dbSource.includes('turnCount: save.turnCount ?? ((save.chatHistory?.length ?? 0) + 1)'), '存档摘要必须优先显示真实 turnCount。');

// ── 主剧情生成失败后重 roll 不多回退一回合 ──
// user 消息必须携带 preTurnSnapshot，这样生成失败时重 roll 能只砍孤立 user
assert(source.includes('preTurnSnapshot,\n    });') || source.includes('preTurnSnapshot,'), 'sendWorkflow 创建 user 消息时必须携带 preTurnSnapshot，确保生成失败时重 roll 能找到快照。');
// assistant 成功后必须清掉 user 上的 snapshot，避免存档膨胀
assert(source.includes('assistant 消息已携带 preTurnSnapshot，清掉 user 消息上的'), 'assistant 成功后必须清掉 user 消息上的 preTurnSnapshot，避免存档膨胀。');
// handleReroll 必须检测末尾孤立 user 的情况
assert(useGameSource.includes('最后一条是 user 且没有对应的 assistant'), 'handleReroll 必须检测末尾孤立 user（主剧情生成失败）的情况。');
assert(useGameSource.includes('已回滚到本回合发送前'), '孤立 user 重 roll 提示必须是"本回合"，不能误写"上一回合"。');
assert(useGameSource.includes('rerollContextRef.current = null;'), '生成失败的重 roll 不需要 rerollContext（没有上一版回复可比对）。');

console.log('reroll regression ok');
