/**
 * ST V2 sendWorkflow 接入红线检查。
 *
 * 这是轻量静态回归：确保 V2 只作为旁路接入，且失败可回退 legacy。
 */

import fs from 'node:fs';
import path from 'node:path';
import { readWorkflowSources, sliceWorkflowFile, sliceWorkflowMarker } from './lib/workflowSources.mjs';

const root = process.cwd();
// 迁移: 主剧情工作流已拆分为多阶段模块，改按登记表整体读取（只换读取源，断言语义不变）。
const sendWorkflow = readWorkflowSources();
const contextSnapshot = fs.readFileSync(path.join(root, 'hooks/useGame/contextSnapshot.ts'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'models/settings.ts'), 'utf8');
const systemPromptBuilder = fs.readFileSync(path.join(root, 'hooks/useGame/systemPromptBuilder.ts'), 'utf8');
// 迁移: apiMessages 的 V2/legacy 分叉已从 sendWorkflow 内联代码搬到本装配模块，
// 因此把该模块纳入读取源（只扩大读取范围，不放宽断言）。
const apiMessagesBuilder = fs.readFileSync(path.join(root, 'hooks/useGame/promptModuleMessageInjection.ts'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(sendWorkflow.includes("import { buildTavernMessageChain } from './tavernMessageChainBuilder';"), 'sendWorkflow 应显式导入 ST V2 消息链构建器');
assert(sendWorkflow.includes("import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';"), 'sendWorkflow 应通过 helper 派生当前 V2 预设');
assert(sendWorkflow.includes('const currentPresetV2 = getCurrentSTPresetV2(state.gameSettings);'), 'sendWorkflow 应只从玩家导入的设置派生当前 V2 预设');
assert(!sendWorkflow.includes('getBuiltinPresetsV2'), 'sendWorkflow 不得重新引入内置酒馆预设');
assert(sendWorkflow.includes('state.gameSettings.enableStPreset !== false'), 'ST V2 分流必须与 UI 一致：旧存档缺省视为开启，只有显式 false 才关闭');
assert(sendWorkflow.includes('currentPresetV2?.preset?.prompts?.length'), 'ST V2 分流必须要求有效 prompts');
assert(sendWorkflow.includes('currentPresetV2?.preset?.prompt_order?.length'), 'ST V2 分流必须要求有效 prompt_order');
// 收紧：裸 `catch (error)` 在 9 个文件里都出现，等于空转。改为要求 catch 之后在有限跨度内
// 依次出现「置空消息链 -> 记录 tavernV2Error -> 打印构建失败回退日志」这一整套回退动作，
// 仍随代码整体搬迁，但只有真正的 ST V2 回退块能匹配。
assert(
  /catch \(error\) \{[\s\S]{0,200}?tavernV2Messages = null;[\s\S]{0,160}?console\.warn\('\[ST V2\] 消息链构建失败，已回退 legacy 主剧情路径'/.test(
    sendWorkflow,
  ),
  'ST V2 构建必须有 catch 回退',
);
assert(sendWorkflow.includes('已回退 legacy 主剧情路径'), 'ST V2 失败必须记录回退 legacy');
// 迁移: 旧 sendWorkflow 内联 `if (tavernV2Messages) { ... } else { ... }`
//   -> 新 装配收敛到 buildNarrativeApiMessages（hooks/useGame/promptModuleMessageInjection.ts），
//      形参名为 input.tavernMessages，sendWorkflow 以 `tavernMessages: tavernV2Messages` 接入该装配。
//   理由: 拆分只搬运代码、不改行为。断言意图不变：apiMessages 组装必须保留非 V2 的 legacy 分支，
//   因此扩大读取源到装配模块，并同时校验 sendWorkflow 侧的 V2 旁路接线仍然存在。
assert(sendWorkflow.includes('tavernMessages: tavernV2Messages'), 'apiMessages 组装必须保留非 V2 legacy 分支');
assert(apiMessagesBuilder.includes('if (input.tavernMessages)') && apiMessagesBuilder.includes('} else {'), 'apiMessages 组装必须保留非 V2 legacy 分支');
assert(sendWorkflow.includes('const recentHistory = getMainHistoryWindow(updatedHistory, state.gameSettings, state.记忆);'), 'ST V2 必须复用原生主剧情近期历史窗口');
assert(sendWorkflow.includes('const tavernHistory = recentHistory.filter((msg) => msg.id !== userMsg.id);'), 'ST V2 Tavern 历史必须排除本轮用户输入，避免 chatHistory 与 userInput 重复');
// 迁移: 切片改用 sliceWorkflowFile —— 标记缺失即抛错，且限定在单个文件内，
// 不再依赖「拼接视图里 indexOf 恰好命中本文件」这一隐含前提。
// 用 sliceWorkflowMarker：该段代码已从 sendWorkflow.ts 搬到 mainPromptAssembly.ts，
// 按标记自动定位后，后续阶段拆分不会再让这条断言失效（标记在 ≥2 个文件出现时会抛错，不会误判）。
const tavernBuildCall = sliceWorkflowMarker(
  'tavernV2Messages = buildTavernMessageChain({',
  '}).map((msg) => 创建聊天消息(msg.role, msg.content));',
).text;
assert(tavernBuildCall.includes('chatHistory: tavernHistory'), 'ST V2 buildTavernMessageChain 必须只接收排除本轮输入后的 tavernHistory');
assert(tavernBuildCall.includes('includeNativeContextInWorldbook: false'), 'ST V2 叠加模式不得在 Tavern worldbook 里重复注入原生底座模块');
assert(tavernBuildCall.includes('includeNativeNarrative: false'), 'ST V2 叠加模式必须由 systemPrompt 唯一承载原生主叙事，Tavern messages 不得重复注入');
assert(!tavernBuildCall.includes('worldbookExtraTexts: [天气片断]'), 'ST V2 不得重复把天气片段塞进 Tavern 消息链');
assert(!tavernBuildCall.includes('chatHistory: updatedHistory') && !tavernBuildCall.includes('chatHistory: state.chatHistory'), 'ST V2 禁止向 Tavern chatHistory 传全量历史');
// 迁移: 旧 在 sendWorkflow 内切片 `if (tavernV2Messages)`..`} else {`
//   -> 新 在装配模块内切片 `if (input.tavernMessages)`..`} else {`。
//   理由: 同上的拆分搬运，V2 分支现在只做纯追加。断言意图不变且更直接：
//   ST V2 只能叠加 Tavern messages，该分支内不得触碰 systemPrompt，更不能清空原生游戏 systemPrompt。
//   切片改用 sliceWorkflowFile：原先「先断言两个 indexOf 有效」由该 helper 的抛错语义承接
//   （标记缺失即失败），且切片不再可能跨出装配模块。
const tavernBranch = sliceWorkflowFile(
  'hooks/useGame/promptModuleMessageInjection.ts',
  'if (input.tavernMessages)',
  '} else {',
).text;
assert(
  tavernBranch.includes('messages.push(...input.tavernMessages)') && !tavernBranch.includes('systemPrompt'),
  'ST V2 只能叠加 Tavern messages，不能清空原生游戏 systemPrompt',
);
assert(contextSnapshot.includes("import { buildTavernMessageChain } from './tavernMessageChainBuilder';"), '主剧情上下文快照必须复用 Tavern V2 消息链构建器');
assert(contextSnapshot.includes("import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';"), '主剧情上下文快照必须通过 helper 派生当前 V2 预设');
assert(contextSnapshot.includes('const currentPresetV2 = getCurrentSTPresetV2(state.gameSettings);'), '主剧情上下文快照应只预览玩家导入的 V2 预设');
assert(!contextSnapshot.includes('getBuiltinPresetsV2'), '主剧情上下文快照不得重新引入内置酒馆预设');
assert(contextSnapshot.includes('state.gameSettings.enableStPreset !== false'), '主剧情上下文快照必须与真实发送保持相同的 V2 开关语义');
assert(contextSnapshot.includes('const recentHistory = getMainHistoryWindow(state.chatHistory, state.gameSettings, state.记忆);'), '主剧情上下文快照中的 Tavern V2 也必须复用原生近期历史窗口');
assert(contextSnapshot.includes('const tavernHistory = recentHistory.filter((msg, index) => {'), '主剧情上下文快照必须排除当前用户输入，避免 Tavern 预览重复');
assert(contextSnapshot.includes('chatHistory: tavernHistory'), '主剧情上下文快照禁止 Tavern V2 预览使用全量历史或未过滤窗口');
assert(contextSnapshot.includes('includeNativeContextInWorldbook: false'), '主剧情上下文快照必须标记 Tavern 叠加模式不重复注入原生底座模块');
assert(contextSnapshot.includes('includeNativeNarrative: false'), '主剧情上下文快照必须与真实发送一致，只让 systemPrompt 承载原生主叙事');
assert(contextSnapshot.includes('酒馆预设消息链') && contextSnapshot.includes('tavern_preset_message_chain'), '主剧情上下文快照必须把 Tavern V2 messages 单独显示为酒馆预设消息链');
assert(contextSnapshot.includes('额外 API messages') && contextSnapshot.includes('原生游戏底座 systemPrompt 仍会完整发送'), '主剧情上下文快照必须明确标记 V2 是叠加模式，原生游戏底座仍发送');
assert(contextSnapshot.includes('只使用原生近期历史窗口') && contextSnapshot.includes('排除当前用户输入'), '主剧情上下文快照必须说明 Tavern chatHistory 不再使用全量历史且不重复本轮输入');
assert(systemPromptBuilder.includes('settings.enableStPreset === false || Boolean(settings.currentStPresetIdV2)'), 'V2 选中时必须过滤 legacy st_import_* 模块，避免 V1/V2 重复注入');
assert(systemPromptBuilder.includes('避免同一份 ST 预设以 V1 模块和 V2 消息链两种形态重复注入'), 'systemPromptBuilder 必须记录 V2 与 legacy V1 模块隔离原因');
assert(settings.includes('currentStPresetIdV2: null'), '默认设置不得自动激活 ST V2 预设');
assert(!settings.includes('currentStPreset: null'), 'settings 不应持久化 currentStPreset 缓存');

console.log('✓ ST V2 sendWorkflow 旁路接入红线检查通过');
