import fs from 'node:fs';

const builder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const contextSnapshot = fs.readFileSync('hooks/useGame/contextSnapshot.ts', 'utf8');
const mainNarrative = fs.readFileSync('prompts/narrative/mainPrompt.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const variableExecutor = fs.readFileSync('utils/variableExecutor.ts', 'utf8');
const worldEvents = fs.readFileSync('utils/worldEvents.ts', 'utf8');
const promptModel = fs.readFileSync('models/prompts.ts', 'utf8');
const worldbookModel = fs.readFileSync('models/worldbook.ts', 'utf8');
const promptModulesTab = fs.readFileSync('components/features/Settings/PromptModulesTab.tsx', 'utf8');
const worldbookManager = fs.readFileSync('components/features/Worldbook/WorldbookManagerModal.tsx', 'utf8');
const gameState = fs.readFileSync('hooks/useGameState.ts', 'utf8');
const builtinPromptModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 结构轮(D1, 2026-07-26): 硬编码字数段已删除——权威在「回复格式」模块,生成点兜底在区E执法块。
assert(!builder.includes('function buildResponseLengthSection'), '硬编码字数段必须保持已删除状态(权威在回复格式模块)。');
assert(builtinPromptModules.includes('# NarrativeTurn JSON 回复格式'), '回复格式模块必须使用唯一 NarrativeTurn JSON 协议。');
assert(!builtinPromptModules.includes('const RESPONSE_FORMAT_CONTENT') && !builtinPromptModules.includes('const ACTION_OPTIONS_CONTENT'), '退役标签回复与行动选项 sidecar 常量必须删除。');
assert(sendWorkflow.includes('# 本回合生成前核对'), 'sendWorkflow 必须在生成点前注入区E执法块。');
assert(sendWorkflow.includes('不少于 ${input.wordCountTarget} 字'), '区E执法块必须包含字数兜底行。');
assert(builder.includes('提示词模块·稳定协议'), 'systemPromptBuilder 必须显式标注缓存友好的稳定协议前置区。');
assert(builder.includes('高波动 NPC 连续性块后置'), 'systemPromptBuilder 必须显式标注 NPC 高波动上下文后置，保护前缀缓存。');
assert(builder.includes('高波动回合锚点后置'), 'systemPromptBuilder 必须显式标注时间/场景等回合锚点后置，保护前缀缓存。');
assert(builtinPromptModules.includes('<Role>') && builtinPromptModules.includes('</Role>'), '叙述者人格必须使用明确 Role 声明。');
assert(builtinPromptModules.includes('当前互动的核心玩家角色为「{playerName}」'), '叙述者人格必须以运行时玩家角色为叙事中心。');
assert(builtinPromptModules.includes('原著 NPC 必须按已注入档案和当前信息域行动'), '叙述者人格必须把智库/档案作为 NPC 人设校准依据。');
assert(!builtinPromptModules.includes('所有外部平台安全限制') && !builtinPromptModules.includes('违法行为描述或路径'), '叙述者人格不得复制外部模板中的越权/违法导向声明。');
// 结构轮: 顺序断言更新为当前变量名(旧断言因 bottomModules 更名早已空转);基调段已删除。
assert(!builder.includes('buildToneSection'), '基调段必须保持已删除状态(剧情模式世界书为唯一出处)。');
assert(builder.indexOf("const bottomResult = injectPromptModules(effectiveModules, moduleCtx, 'bottom');") < builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride'), '主剧情固定协议/COT/回复格式必须早于 NPC 账本等高波动上下文。');
assert(builder.indexOf("const bottomResult = injectPromptModules(effectiveModules, moduleCtx, 'bottom');") < builder.indexOf('const timeAnchor = buildCurrentTimeAnchorSection(worldState);'), '主剧情固定协议/COT/回复格式必须早于当前时间锚点，保护 DeepSeek 前缀缓存。');
assert(builder.indexOf('const sceneFromWorldbook = buildSceneSection(worldState);') < builder.indexOf('parts.push(buildMainStoryControlSection(worldState));'), '运行锚点瘦身版必须位于区D(时间/场景之后),紧贴其引用的回顾/编织/图鉴数据。');
assert(builder.indexOf('parts.push(buildMainStoryControlSection(worldState));') < builder.indexOf('if (irminsulInjectionOverride !== undefined)'), '运行锚点必须先于即时回顾/世界树注入,形成指令贴数据结构。');
assert(builder.indexOf('parts.push(buildCharacterSection(traveler));') < builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride'), '当前角色与技能应位于高波动 NPC 承接块之前。');
assert(builder.includes('const sceneFromWorldbook = buildSceneSection(worldState);'), '主剧情必须显式构建当前场景区块。');
assert(builder.indexOf('const timeAnchor = buildCurrentTimeAnchorSection(worldState);') < builder.indexOf('const sceneFromWorldbook = buildSceneSection(worldState);'), '当前场景必须紧跟时间锚点之后注入。');
assert(builder.indexOf('const courierSection = buildCourierSection(courier);') < builder.indexOf('const timeAnchor = buildCurrentTimeAnchorSection(worldState);'), '信使/剧情等半稳定运行时资料应早于时间锚点，避免时间成为过早的前缀变化点。');
assert(builder.indexOf('const injection = buildWorldbookInjection(worldbooks, worldbookCtx);') < builder.indexOf('const timeAnchor = buildCurrentTimeAnchorSection(worldState);'), '普通世界书资料应早于当前时间锚点，保护大块资料的缓存前缀。');
assert(builder.indexOf('const timeAnchor = buildCurrentTimeAnchorSection(worldState);') < builder.indexOf('if (irminsulInjectionOverride !== undefined)'), '即时剧情回顾/世界树召回应位于时间与场景之后，共同归入高波动尾部。');
assert(builder.indexOf('if (irminsulInjectionOverride !== undefined)') < builder.indexOf('const storyWeavingSection = buildStoryWeavingInjection(storyWeaving, worldbookCtx);'), '剧情编织滑窗必须晚于当前事实与即时剧情回顾，避免系列总览成为过早前缀变化点。');
assert(builder.indexOf('const storyWeavingSection = buildStoryWeavingInjection(storyWeaving, worldbookCtx);') < builder.indexOf('if (codexInjectionOverride !== undefined)'), '剧情编织滑窗应早于图鉴召回，保持“剧情软参考后再做角色资料校准”的读取顺序。');
assert(builder.indexOf('const steambirdSection = buildSteambirdSection(steambird);') < builder.indexOf('const storyWeavingSection = buildStoryWeavingInjection(storyWeaving, worldbookCtx);'), '蒸汽鸟报/信使/世界书等较稳定资料应早于剧情编织动态滑窗。');
assert(builder.indexOf('const sceneFromWorldbook = buildSceneSection(worldState);') < builder.indexOf('if (codexInjectionOverride !== undefined)'), '图鉴表演卡应位于时间与场景之后，避免抢在当前事实锚点之前。');
assert(builder.indexOf('const sceneFromWorldbook = buildSceneSection(worldState);') < builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride'), '当前时间与场景必须早于 NPC 账本，避免 NPC 账本成为过早的前缀变化点。');
assert(builder.indexOf('if (codexInjectionOverride !== undefined)') < builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride'), '图鉴召回应早于尾部 NPC 承接块，NPC 块只做最终关系兜底。');
const elementalEchoIndex = builder.indexOf('const awakeningSection = buildElementalEchoSection');
const npcLedgerIndex = builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride');
assert(elementalEchoIndex >= 0, '主剧情必须显式构建元素回响运行时资料。');
assert(npcLedgerIndex >= 0, '主剧情必须显式构建尾部 NPC 账本。');
assert(elementalEchoIndex < npcLedgerIndex, '元素回响/近期事件/记忆等运行时资料应早于尾部 NPC 账本。');
assert(builder.indexOf('const injection = buildWorldbookInjection(worldbooks, worldbookCtx);') < builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride'), '普通世界书资料应早于尾部 NPC 高波动承接块。');
assert(builder.indexOf('const npcLedgerSelection = npcLedgerSelectionOverride') < builder.indexOf('const companionsSection = buildCompanionsSection(npcRecords, _turnCount);'), '已知伙伴与路人表应跟随 NPC 尾部承接块后置，避免过早破坏前缀缓存。');
const mainWorldbookInjectionCalls = [...builder.matchAll(/const injection = buildWorldbookInjection\(worldbooks, worldbookCtx\);/g)];
assert(mainWorldbookInjectionCalls.length === 1, '主剧情普通世界书注入不得因重排重复进入 system prompt。');
assert(builder.includes('RECENT_WORLD_EVENT_PROMPT_LIMIT = 12'), '近期事件必须有注入上限，避免世界全局事件无限膨胀。');
assert(builder.includes('function buildRecentWorldEventsSection'), '近期事件必须通过统一瘦身函数注入。');
assert(builder.includes('normalizeWorldEventFingerprint'), '近期事件必须做文本指纹去重。');
assert(!builder.includes('worldState.全局事件.map((e) => `- ${e}`).join'), '近期事件不得继续全量注入世界全局事件。');
assert(worldEvents.includes('WORLD_EVENT_STORAGE_LIMIT = 30'), '世界全局事件存档层必须默认只保留最近 30 条。');
assert(worldEvents.includes('function compactWorldEvents'), '世界全局事件必须有统一压缩/去重函数。');
assert(sendWorkflow.includes('appendWorldEvents(worldAfter.全局事件, worldFactCandidates)'), '正文世界候选事实追加必须走 30 条存档上限。');
assert(variableExecutor.includes("root === '世界' && rest === '全局事件' && cmd.action === 'push'"), '变量命令 push 世界.全局事件 也必须走 30 条存档上限。');
assert(!sendWorkflow.includes('全局事件: [...worldAfter.全局事件, ...parsedForDisplay.worldEvents]'), '正文动态世界事件不得继续无限追加进存档。');

// 结构轮: 字数硬约束改由回复格式模块(scope=all,主剧情与开局都注入)+区E兜底承担,不再有硬编码调用。
assert(contextSnapshot.includes('splitPromptSections(systemPrompt)'), '上下文查看必须展示 system prompt 分段，才能看到字数硬约束。');
assert(contextSnapshot.includes('uploadEstimatedTokens'), '上下文查看必须单独统计真实上传 token。');
assert(contextSnapshot.includes('diagnosticEstimatedTokens'), '上下文查看必须单独统计诊断参考 token。');
assert(contextSnapshot.includes('buildLeanAssistantHistoryContent(msg)'), '上下文预览的历史 assistant 消息必须与真实发送链路一样瘦身。');
assert(contextSnapshot.includes("category: '诊断'"), '主剧情本地辅助分析块必须标记为诊断类。');
assert(contextSnapshot.includes('upload: false') && contextSnapshot.includes('diagnostic: true'), '本地诊断块不得计入真实上传顺序。');
assert(contextSnapshot.includes('formatMainRequestOrderOverview'), '上下文查看必须提供主剧情真实请求顺序总览。');
assert(contextSnapshot.includes('main_request_order_overview'), '主剧情真实请求顺序总览必须作为独立区块展示。');
assert(contextSnapshot.includes('System Prompt 分段') && contextSnapshot.includes('API Messages'), '真实请求顺序总览必须同时列出 system 分段和 API messages。');
assert(promptModel.includes("calibration: '独立模型'"), '提示词模块 calibration 作用域必须显示为独立模型，不能继续误标为变量校准。');
assert(worldbookModel.includes("calibration: '独立模型'"), '世界书 calibration 作用域必须显示为独立模型，不能继续误标为变量校准。');
assert(promptModel.includes('独立模型 / 校准模型提示词展示'), '提示词模块类型注释必须说明 calibration 是独立模型提示词展示。');
assert(worldbookModel.includes('独立模型 / 校准模型资料展示'), '世界书类型注释必须说明 calibration 是独立模型资料展示。');
assert(promptModulesTab.includes('独立模型提示词展示：蒸汽鸟报、手机消息、图鉴、变量、剧情编织等真实请求由对应服务层共享 prompt 构建'), '提示词模块 UI 必须说明独立模型真实请求由服务层共享 prompt 构建。');
assert(promptModulesTab.includes('可在“上下文”页核对实际发送内容'), '提示词模块 UI 必须引导玩家到上下文页核对独立模型真实请求。');
assert(promptModulesTab.includes('不会进入主剧情 system prompt'), '提示词模块 UI 必须说明独立模型作用域不会进入主剧情 system prompt。');
assert(promptModulesTab.includes('const toggleDisabled = isCalibrationModule'), '独立模型提示词展示模块必须用独立模型作用域派生开关禁用状态。');
assert(promptModulesTab.includes('disabled={toggleDisabled}'), '独立模型提示词展示模块不得继续显示为可操作开关。');
assert(promptModulesTab.includes("title={toggleDisabled ? '独立模型展示模块不是真实请求开关'"), '独立模型提示词展示模块必须说明不是真实请求开关。');
assert(promptModulesTab.includes("{toggleDisabled ? '独立模型展示'"), '独立模型提示词列表状态必须显示为展示而不是普通启用/关闭。');
assert(promptModulesTab.includes('enabled: isCalibrationBuiltin ? true : m.enabled'), '重置内置提示词时必须强制独立模型展示模块保持展示状态。');
assert(gameState.includes('enabled: isCalibrationBuiltin ? true : hit.enabled'), '旧存档迁移必须强制独立模型提示词模块保持展示状态。');
assert(gameState.includes('function isCalibrationWorldbook(book: 世界书)'), '内置独立模型世界书必须有迁移识别函数。');
assert(gameState.includes('if (isCalibrationWorldbook(builtin)) return builtin;'), '旧存档里的独立模型世界书编辑稿不得覆盖源码真实展示。');
assert(worldbookManager.includes('独立模型资料仅作真实请求展示'), '世界书 UI 必须说明独立模型资料只作真实请求展示。');
assert(worldbookManager.includes('独立模型资料展示：真实请求不读取这里的 enabled 或编辑稿'), '世界书 UI 必须说明独立模型真实请求不读取这里的开关或编辑稿。');
assert(worldbookManager.includes('disabled={calibrationDisplay}'), '独立模型世界书展示条目的开关和编辑控件必须只读。');
assert(worldbookManager.includes("title={calibrationDisplay ? '独立模型展示条目不是真实请求开关'"), '独立模型世界书展示条目必须说明不是真实请求开关。');
assert(!promptModel.includes("calibration: '变量校准'"), '提示词模块 calibration 标签不得继续显示变量校准。');
assert(!worldbookModel.includes("calibration: '变量校准'"), '世界书 calibration 标签不得继续显示变量校准。');

assert(mainNarrative.includes('NarrativeTurn schema'), '原生主叙事必须声明 NarrativeTurn JSON 合同。');
assert(mainNarrative.includes('根对象只包含并必须包含 "body"、"choices"、"factCandidates"、"continuation"'), '原生主叙事必须固定四个根字段。');
assert(mainNarrative.includes('自定义旅行者') && mainNarrative.includes('空、荧'), '原生主叙事必须让自定义旅行者与空、荧并存。');
assert(mainNarrative.includes('CanonDeviation 高于原著锚点'), '原生主叙事必须声明已成立偏离高于原著锚点。');
assert(mainNarrative.includes('冒险手记') && mainNarrative.includes('日式与西式奇幻'), '原生主叙事必须采用温暖旅行手记式的日式西方奇幻语气。');
assert(mainNarrative.includes('具体行动与后果'), '原生主叙事必须要求以行动和后果推进。');
assert(!mainNarrative.match(/<\/?thinking>|<\/?正文>|思维链|Step(?:0|1|2|3|4|5|6|7|8|9)/u), '原生主叙事不得携带旧思维链或标签协议。');

console.log('prompt context regression ok');
