import fs from 'node:fs';
import path from 'node:path';

/**
 * 面向回归脚本的「主剧情工作流源码视图」。
 *
 * 背景：`executeSendWorkflow` 及相关阶段会被拆分到多个模块（M6）。拆分只搬运代码，
 * 不改变行为，但回归脚本原本直接 `readFileSync('hooks/useGame/sendWorkflow.ts')`
 * 做文本断言——代码一搬到别的文件，断言就红，而它们保护的是**行为**，不是**文件位置**。
 *
 * 所以统一走这里读取：搬代码时只需调整 WORKFLOW_FILES，
 * 不用改几十个脚本，也不用删断言。
 *
 * ⚠️ WORKFLOW_FILES 的顺序是有语义的：
 *    1. 它决定拼接后的文本顺序，而部分脚本用 `indexOf(a) < indexOf(b)` 断言执行先后；
 *    2. 因此必须按「编排器在前，阶段模块按实际调用顺序在后」排列。
 *
 * ⚠️ 列在 WORKFLOW_FILES 里的文件必须存在。缺失时抛错而不是跳过：
 *    静默跳过会让 `assert(!text.includes(...))` 这类负断言变成空转，
 *    从而假装还在保护行为。
 *
 * ⚠️ 拼接是「尾部相接」的：文本里没有文件边界标记。
 *    因此**禁止**写 `text.slice(text.indexOf(X))` 这种「一路切到结尾」的切片——
 *    它会静默吞掉后面新登记的文件，把断言范围悄悄放大或缩小。
 *    需要切片时用 `sliceWorkflowFile()`（限定在单个文件内，标记缺失即抛错），
 *    或用 `workflowFileSpans()` + `assertSpanWithinSingleFile()` 校验区间不跨文件。
 *    该不变量由 `scripts/workflow-sources-integrity-regression.mjs` 强制检查。
 */
export const WORKFLOW_FILES = [
  // 编排器
  'hooks/useGame/sendWorkflow.ts',
  // 发送前置阶段（M6 阶段 1：步骤 0-1）
  'hooks/useGame/sendPreparationStage.ts',
  // 主剧情提示词装配阶段（M6 阶段 3：步骤 2）
  'hooks/useGame/mainPromptAssembly.ts',
  // 变量模型校准阶段（M6 阶段 2：步骤 8.5）
  'hooks/useGame/variableCalibrationStage.ts',
  // 请求装配阶段
  'hooks/useGame/systemPromptBuilder.ts',
  'hooks/useGame/promptModuleMessageInjection.ts',
  'hooks/useGame/historyWindow.ts',
  'hooks/useGame/mainRecallStage.ts',
  'hooks/useGame/contextSnapshot.ts',
  // Tavern V2 消息链装配（发送前）
  'hooks/useGame/tavernMessageChainBuilder.ts',
  'hooks/useGame/tavernFormatGuard.ts',
  'hooks/useGame/tavernRegexProcessor.ts',
  // 主叙事请求与流式
  'services/ai/activeApiConfig.ts',
  'hooks/useGame/mainNarrativeRequestStage.ts',
  'services/ai/mainNarrativeRetryPolicy.ts',
  'services/ai/mainNarrativeValidation.ts',
  'services/ai/mainNarrativeAttemptRunner.ts',
  'hooks/useGame/mainNarrativeStreamingSession.ts',
  'hooks/useGame/narrativeWorldStage.ts',
  'hooks/useGame/openingSteambirdStage.ts',
  // 结算与落库
  'hooks/useGame/postSettlementCommitStage.ts',
  'hooks/useGame/postSettlementRecoveryWorkflow.ts',
  'hooks/useGame/variableSettlementWorkflow.ts',
  'hooks/useGame/turnDebugContext.ts',
  'hooks/useGame/turnDiagnostics.ts',
  'hooks/useGame/turnSnapshot.ts',
  'hooks/useGame/memoryUtils.ts',
  'hooks/useGame/recoveryResume.ts',
  // 后台任务
  'hooks/useGame/postTurnBackgroundTasks.ts',
  'hooks/useGame/postTurnIrminsulTask.ts',
  'hooks/useGame/postTurnNarrativeImageTask.ts',
  'hooks/useGame/postTurnAutosaveTask.ts',
  'hooks/useGame/postTurnElementalStage.ts',
  'hooks/useGame/postNarrativeMemoryStage.ts',
  'hooks/useGame/npcPresence.ts',
  'hooks/useGame/courierWorkflow.ts',
  'hooks/useGame/courierBackgroundJobs.ts',
  'hooks/useGame/questWorkflow.ts',
  'hooks/useGame/steambirdWorkflow.ts',
  'hooks/useGame/narrativeImageWorkflow.ts',
  'hooks/useGame/workflowQueue.ts',
];

/**
 * 被 WORKFLOW_FILES 中的模块 import、但**有意**不纳入本视图的工作流层文件。
 *
 * 存在这个清单的原因：漏登记一个文件会让断言范围悄悄缩小（本项目已经因此吃过一次亏——
 * `mainNarrativeRetryPolicy.ts` / `mainNarrativeAttemptRunner.ts` 曾被漏掉）。
 * 所以「不在视图里」必须是一个**显式决定**，而不是一次遗漏。
 * 未列入此表、又未登记进 WORKFLOW_FILES 的工作流层依赖，会被完整性门禁判为失败。
 */
export const WORKFLOW_OUT_OF_SCOPE = {
  'hooks/useGame/saveLoadWorkflow.ts': '存档/读档工作流，独立于主剧情发送链路，由存储层脚本单独断言',
  'hooks/useGame/useKeyboardShortcuts.ts': 'UI 快捷键绑定，不参与主剧情发送链路',
  'hooks/useGameState.ts': '状态容器（工作流的宿主），不是工作流阶段模块；需要的脚本显式读取',
  'hooks/useGame/contextSnapshotTypes.ts':
    '纯类型声明（接口/联合类型），不承载行为；纳入只会扩大负断言的匹配面而无保护价值',
};

function readRequired(relativePath, root) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `workflowSources: 缺少工作流源文件 ${relativePath}（WORKFLOW_FILES 与实际文件不同步）`,
    );
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

/**
 * 读取主剧情工作流的全部源码并拼接。
 *
 * @param {string} [root] 仓库根目录，默认当前工作目录（回归脚本均从仓库根启动）。
 * @returns {string} 拼接后的源码文本。
 */
export function readWorkflowSources(root = process.cwd()) {
  return WORKFLOW_FILES.map((relativePath) => readRequired(relativePath, root)).join('\n');
}

/** 允许脚本按需读取单个工作流源文件（例如需要精确切片时）。 */
export function readWorkflowFile(relativePath, root = process.cwd()) {
  if (!WORKFLOW_FILES.includes(relativePath)) {
    throw new Error(
      `workflowSources: ${relativePath} 不在 WORKFLOW_FILES 中；新增文件请先登记，避免断言范围悄悄缩小`,
    );
  }
  return readRequired(relativePath, root);
}

/**
 * 拼接文本里每个文件占据的区间，用于校验切片没有跨文件。
 *
 * @returns {{file: string, start: number, end: number}[]}
 */
export function workflowFileSpans(root = process.cwd()) {
  const spans = [];
  let cursor = 0;
  for (const file of WORKFLOW_FILES) {
    const text = readRequired(file, root);
    spans.push({ file, start: cursor, end: cursor + text.length });
    cursor += text.length + 1; // join('\n')
  }
  return spans;
}

/**
 * 在**单个**工作流文件内按标记切片。
 *
 * 与 `sources.slice(sources.indexOf(a))` 的区别：标记缺失时**抛错**而不是返回 -1 起点的怪东西，
 * 并且切片不会越过文件边界，因此新增文件不会静默改变断言范围。
 *
 * @param {string} relativePath 必须是 WORKFLOW_FILES 中的文件
 * @param {string} fromMarker 起始标记（包含在结果里）
 * @param {string} [toMarker] 结束标记（不含在结果里）；省略则切到该文件末尾
 */
export function sliceWorkflowFile(relativePath, fromMarker, toMarker, root = process.cwd()) {
  const text = readWorkflowFile(relativePath, root);
  const start = text.indexOf(fromMarker);
  if (start < 0) {
    throw new Error(`workflowSources: ${relativePath} 中找不到起始标记 ${JSON.stringify(fromMarker)}`);
  }
  let end = text.length;
  if (toMarker) {
    end = text.indexOf(toMarker, start);
    if (end < 0) {
      throw new Error(`workflowSources: ${relativePath} 中找不到结束标记 ${JSON.stringify(toMarker)}`);
    }
  }
  return { file: relativePath, start, end, text: text.slice(start, end) };
}

/**
 * 按标记在**已登记文件**中自动定位并切片：抗搬迁，且拒绝歧义。
 *
 * 与 `sliceWorkflowFile(文件, ...)` 的区别：不需要写死文件名，因此代码在阶段模块之间搬迁后
 * 断言不会失效（M6 拆分反复出现的问题）。代价是必须能唯一确定归属，所以：
 *   - 0 个文件包含起始标记 -> 抛错（代码被删除或改名）
 *   - ≥2 个文件包含起始标记 -> 抛错并要求改用 `sliceWorkflowFile` 显式指定
 * 这样"自动定位"不会退化成"随便命中一个就算过"。
 */
export function sliceWorkflowMarker(fromMarker, toMarker, root = process.cwd()) {
  const hits = WORKFLOW_FILES.filter((file) => readRequired(file, root).includes(fromMarker));
  if (hits.length === 0) {
    throw new Error(
      `workflowSources: 没有任何登记文件包含起始标记 ${JSON.stringify(fromMarker)}（代码被删除或改名？）`,
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `workflowSources: 起始标记 ${JSON.stringify(fromMarker)} 在 ${hits.length} 个登记文件里出现` +
        `（${hits.join(', ')}），无法确定归属；请改用 sliceWorkflowFile(文件, ...) 显式指定。`,
    );
  }
  return sliceWorkflowFile(hits[0], fromMarker, toMarker, root);
}

/**
 * 校验拼接文本中的 [start, end) 落在同一个文件内。
 * 供仍在使用 `indexOf` 手动切片的脚本显式声明「我不跨文件」。
 */
export function assertSpanWithinSingleFile(start, end, root = process.cwd()) {
  const spans = workflowFileSpans(root);
  const hit = spans.find((span) => start >= span.start && start <= span.end);
  if (!hit) {
    throw new Error(`workflowSources: 起点 ${start} 不在任何工作流文件区间内`);
  }
  if (end > hit.end) {
    throw new Error(
      `workflowSources: 切片 [${start}, ${end}) 跨出了 ${hit.file}（该文件区间结束于 ${hit.end}）；` +
        '这通常意味着「切到结尾」的写法吞掉了后续登记的文件，请改用 sliceWorkflowFile()。',
    );
  }
  return hit.file;
}
