import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[deepseek-format] ${message}`);
    process.exit(1);
  }
}

const settings = read('models/settings.ts');
const gameSettings = read('components/features/Settings/GameSettings.tsx');
const sendWorkflow = read('hooks/useGame/sendWorkflow.ts');
const textService = read('services/ai/text/index.ts');
const client = read('services/ai/chatCompletionClient.ts');
const recovery = read('services/ai/deepSeekRecovery.ts');
const modelPolicy = read('services/ai/deepSeekModelPolicy.ts');
const modelCatalog = read('services/ai/openAICompatibleModels.ts');
const repair = read('services/ai/structuredOutputRepair.ts');
const variableFacts = read('utils/variableFacts.ts');
const courierService = read('services/ai/courierService.ts');
const codex = read('services/codexRetrieval.ts');
const codexAiRetrievalIndex = read('services/codexAiRetrievalIndex.ts');
const storyWeaving = read('services/storyWeaving.ts');
const gameState = read('hooks/useGameState.ts');
const saveLoad = read('hooks/useGame/saveLoadWorkflow.ts');
const apiSettings = read('components/features/Settings/ApiSettings.tsx');
const chatModel = read('models/chat.ts');
const turnItem = read('components/features/Chat/TurnItem.tsx');
const variableModel = read('services/ai/variableModel.ts');
const domainOutputFormat = read('prompts/subsystems/domainCommandOutputFormat.ts');
const variableWorldbook = read('data/variableWorldbook.ts');
const domainRules = read('prompts/subsystems/domainCommandPrompt.ts');

assert(settings.includes("export type DeepSeek主剧情模式 = 'off' | 'standard' | 'lock_format'"), '游戏设置必须声明 DeepSeek 主剧情模式枚举。');
assert(settings.includes('deepSeekMainMode: DeepSeek主剧情模式'), '游戏设置必须保存 deepSeekMainMode。');
assert(settings.includes("deepSeekMainMode: 'off'"), 'DeepSeek 主剧情模式默认必须关闭。');
assert(gameState.includes('deepSeekMainMode: savedGame.deepSeekMainMode ?? defaults.deepSeekMainMode'), '旧设置读取必须归一化 deepSeekMainMode。');
assert(saveLoad.includes('deepSeekMainMode: defaults.deepSeekMainMode'), '保存存档前必须清理 DeepSeek 本机模式。');
assert(saveLoad.includes('deepSeekMainMode: localSettings.deepSeekMainMode ?? 创建默认游戏设置().deepSeekMainMode'), '读档必须保留本机 DeepSeek 模式。');

assert(gameSettings.includes('DeepSeek 主剧情模式'), '游戏设置页必须提供 DeepSeek 主剧情模式按钮。');
assert(gameSettings.includes("'lock_format'") && gameSettings.includes('JSON 严格'), '游戏设置页必须提供 DeepSeek JSON 严格选项。');
assert(gameSettings.includes('追加 NarrativeTurn JSON 校验'), 'DeepSeek 标准模式 UI 必须说明会追加正式 JSON 校验。');
assert(gameSettings.includes('禁用 prefill 并校验完整 JSON'), 'DeepSeek JSON 严格模式必须说明不使用 prefill。');
assert(gameSettings.includes('仅当主 API 供应商或 Base URL 命中 DeepSeek 时生效'), 'DeepSeek 模式 UI 必须说明只影响 DeepSeek 主 API。');

assert(sendWorkflow.includes('isDeepSeekMainConfig'), '主剧情必须有 DeepSeek 主 API 检测。');
assert(!sendWorkflow.includes('resolveMainStoryConfig'), 'DeepSeek reasoner 适配不得继续局限在主剧情局部逻辑。');
assert(sendWorkflow.includes('sendChatMessage(mainStoryConfig'), '主剧情发送必须使用共享请求层。');
assert(sendWorkflow.includes('!deepSeekMainActive'), 'DeepSeek 专用模式必须跳过 CoT 伪装历史。');
assert(sendWorkflow.includes('const usePresetPrefill = false'), '正式主剧情不得使用预设 assistant prefill 截断 JSON。');
assert(sendWorkflow.includes("const effectivePrefixContent = ''"), 'NarrativeTurn 主剧情必须禁用 assistant prefill。');
assert(sendWorkflow.includes('prefixContent: effectivePrefixContent'), '主剧情请求必须透传最终 assistant prefill 内容。');
assert(!sendWorkflow.includes("prefixContent: '<正文>\\n'"), 'DeepSeek 主剧情不得锁到旧正文标签。');
assert(sendWorkflow.includes('DEEPSEEK_MAIN_FORMAT_GUARD'), 'DeepSeek 标准/锁格式必须追加专属格式守卫。');
assert(sendWorkflow.includes('apiMessages.push(创建聊天消息(\'user\', DEEPSEEK_MAIN_FORMAT_GUARD))'), 'DeepSeek 格式守卫必须作为最后 user 消息进入主请求。');
assert(sendWorkflow.includes('getDeepSeekMainProtocolIssues'), 'DeepSeek 主剧情必须校验 NarrativeTurn JSON 协议。');
assert(sendWorkflow.includes('buildDeepSeekProtocolRetryGuard'), 'DeepSeek 协议失败时必须追加重试守卫。');
assert(sendWorkflow.includes('Math.max(2, configuredMaxAttempts)'), 'DeepSeek 专用模式至少要保留一次协议失败重试。');
assert(sendWorkflow.includes('deepSeekMainMode: deepSeekMainActive ? deepSeekMainMode : \'off\''), 'debugContext 必须记录本轮 DeepSeek 模式。');
assert(sendWorkflow.includes('result.deepSeekRecovery?.originalModel') && sendWorkflow.includes('result.deepSeekRecovery?.fallbackModel'), 'debugContext 必须记录共享 DeepSeek 恢复的原模型和回退模型。');
assert(sendWorkflow.includes('isNonRetryableAIError(innerErr)'), '共享恢复耗尽后主剧情不得重新运行完整恢复链。');
assert(sendWorkflow.includes('deepSeekProtocolIssues: deepSeekProtocolIssuesForTurn'), 'debugContext 必须记录 DeepSeek 协议校验失败项。');
assert(sendWorkflow.includes('const shouldStreamMainRequest = state.gameSettings.enableStreaming && !isPageHidden()'), '主剧情真实请求是否流式只能由流式设置和页面可见性决定。');
assert(sendWorkflow.includes('streaming: shouldStreamMainRequest'), '主剧情必须把真实流式开关传给 text service。');
assert(sendWorkflow.includes('requestMode: mainRequestMode'), '主剧情错误报告必须记录真实请求模式。');
assert(sendWorkflow.includes('mainRequestMode,') && chatModel.includes("mainRequestMode?: 'stream' | 'non-stream'"), 'debugContext 必须保存本轮主剧情真实请求模式。');
assert(!sendWorkflow.includes('forcePreviewStream'), 'DeepSeek 不得再通过 forcePreviewStream 把主剧情强制改为非流式。');
assert(!sendWorkflow.includes('enableStreaming && !forcePreviewStream'), '主剧情流式判断不得再被 DeepSeek 供应商整体压掉。');
assert(textService.includes('prefixMode?: boolean') && textService.includes('prefixContent?: string'), '主剧情 text service 必须传递 prefixMode/prefixContent。');

assert(client.includes('normalizeDeepSeekPrefixBaseUrl'), '请求层必须把 DeepSeek prefix 请求切到 beta baseUrl。');
assert(client.includes('withDeepSeekPrefixMessages'), '请求层必须构造 DeepSeek prefix assistant 消息。');
assert(client.includes('prefix: true'), 'DeepSeek prefix assistant 消息必须带 prefix:true。');
assert(client.includes("request.prefixContent ?? ''"), 'DeepSeek prefix 请求层不得默认注入 hidden reasoning 起点。');
assert(client.includes('isDeepSeekPrefixUnsupportedError'), 'DeepSeek prefix 不支持时必须可识别并降级。');
assert(client.includes('prefixMode === true && isDeepSeekConfig(config)'), 'prefixMode 必须只作用于 DeepSeek。');
assert(client.includes('已自动降级为标准模式'), 'DeepSeek prefix 不支持时必须自动降级标准模式。');
assert(client.includes('executeWithDeepSeekRecovery'), '流式和非流式客户端必须接入共享 DeepSeek 恢复协调器。');
assert(client.includes('hasReasoningPayload') && client.includes('sawReasoning'), 'OpenAI 兼容解析必须记录 reasoning 活动而不展示内容。');
assert(recovery.includes('DEEPSEEK_FINAL_CONTENT_GUARD'), 'DeepSeek 空正文必须有定向最终正文守卫。');
assert(recovery.includes('Math.max(options.maxTokens ?? config.maxTokens ?? 2048, 8192)'), 'Reasoner 推理耗尽重试必须保留至少 8192 输出预算。');
assert(recovery.includes('fetchOpenAICompatibleModelsCached') && recovery.includes('selectDeepSeekFallbackModel'), '连续空正文必须查询同接口并选择非推理 DeepSeek 模型。');
assert(recovery.includes('DeepSeekRecoveryExhaustedError') && recovery.includes('readonly nonRetryable = true'), '恢复耗尽必须抛出不可重复执行的类型化错误。');
assert(modelPolicy.includes('DeepSeekConfidence') && modelPolicy.includes('DeepSeekCapability'), '共享策略必须区分 DeepSeek 证据和模型能力。');
assert(modelPolicy.includes("? 'strong' : reasoning ? 'weak' : 'none'"), 'R1 弱别名不得在没有响应证据时被当作强 DeepSeek。');
assert(modelPolicy.includes("normalized === 'deepseek-chat'") && modelPolicy.includes("return 1;"), '回退候选必须优先 DeepSeek Chat/V3。');
assert(modelCatalog.includes('MODEL_CACHE_TTL_MS = 5 * 60 * 1000'), '模型目录必须使用五分钟内存缓存。');
assert(chatModel.includes('deepSeekProtocolIssues?: string[]'), '聊天 debugContext 类型必须保存 DeepSeek 协议失败项。');
assert(chatModel.includes('deepSeekMainOriginalModel?: string') && chatModel.includes('deepSeekMainAdaptedModel?: string'), '聊天 debugContext 类型必须保存 DeepSeek 主剧情模型适配信息。');
assert(turnItem.includes('【DeepSeek 主剧情诊断】') && turnItem.includes('协议校验失败项'), '请求上下文必须展示 DeepSeek 主剧情诊断。');
assert(turnItem.includes('主剧情模型适配：'), '请求上下文必须展示 DeepSeek 主剧情模型适配。');
assert(turnItem.includes('主剧情请求模式：'), '请求上下文必须展示本轮真实主剧情请求模式。');

assert(repair.includes('extractJsonLikeText') && repair.includes('repairLooseJsonText') && repair.includes('parseNumberedRecallLines'), '必须提供结构化输出修复工具。');
assert(variableFacts.includes('parseJsonWithRepair') && variableFacts.includes('extractJsonLikeText(block'), '变量事实解析必须使用 JSON 修复。');
assert(variableModel.includes('checkVariableModelProtocol'), '变量模型必须校验单一 facts JSON 协议完整性。');
assert(variableModel.includes('buildVariableProtocolRepairPrompt'), '变量模型协议不完整时必须追加修复提示重试。');
assert(variableModel.includes('ensureVariableProtocolFallback') && variableModel.includes('{"facts":[]}'), '变量模型协议重试仍失败时必须兜底为空 facts。');
assert(domainOutputFormat.includes('不输出调试过程、内部推理') && !domainOutputFormat.includes('<thinking>'), '领域事实模型不得请求隐藏推理。');
assert(variableModel.includes('reviewVariableModelContent') && variableModel.includes('buildVariableContentReviewPrompt'), '变量模型必须在空 facts 且疑似漏掉重要 NPC 日常轻记忆时触发内容复审。');
assert((variableModel.includes('低风险 npc 轻记忆') || domainRules.includes('低风险')) && domainRules.includes('提瓦特煎蛋'), '变量模型提示必须允许重要 NPC 共同日常写入轻记忆。');
assert(variableWorldbook.includes('共同日常也属于低风险有效互动') && variableWorldbook.includes('memory/recentInteraction/sharedExperiences'), '变量世界书必须明确重要 NPC 共同日常可写轻记忆。');
assert(domainRules.includes('有效互动产生可承接结果') && domainRules.includes('共同日常'), '领域事实规则必须审计重要 NPC 日常轻记忆。');
assert(courierService.includes('appendCourierMessage') && courierService.includes('calculateCourierUnread'), '信使结构化状态必须通过正式不可变服务更新。');
assert(
  codex.includes('retrieveCodexEntries') &&
    codexAiRetrievalIndex.includes('compileCodexAiSelection') &&
    codexAiRetrievalIndex.includes('selectedIds'),
  '图鉴 AI 选择必须通过正式候选索引解析选择编号。',
);
assert(storyWeaving.includes('parseJsonWithRepair') && storyWeaving.includes("extractJsonLikeText(raw, 'object')"), '剧情编织 JSON 解析必须使用结构化输出修复。');

assert(apiSettings.includes('deepSeekMainMode: gameSettings.deepSeekMainMode ??'), 'API 配置包必须导出 DeepSeek 主剧情模式。');
assert(apiSettings.includes('deepSeekMainMode: profile.deepSeekMainMode ??'), 'API 配置包导入必须恢复 DeepSeek 主剧情模式。');

console.log('[deepseek-format] ok');
