import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const settings = fs.readFileSync('models/settings.ts', 'utf8');
const settingsModal = fs.readFileSync('components/features/Settings/SettingsModal.tsx', 'utf8');
const extraTab = fs.readFileSync('components/features/Settings/ExtraFeaturesSettingsTab.tsx', 'utf8');
// 迁移: 主剧情工作流读取改走 readWorkflowSources()（WORKFLOW_FILES 登记文件的拼接视图）。
// 理由: 这些断言保护的是行为，不是文件位置；阶段模块拆分后代码一搬走就不再假红。
// 注: hooks/useGameState.ts 与 hooks/useGame/saveLoadWorkflow.ts 不在登记表内，保持各自的显式读取。
const sendWorkflow = readWorkflowSources();
const useGameState = fs.readFileSync('hooks/useGameState.ts', 'utf8');
const saveLoadWorkflow = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const sanitizer = fs.readFileSync('utils/textSanitizer.ts', 'utf8');

assert(settings.includes('额外功能: 额外功能设置'), '游戏设置必须包含额外功能设置。');
assert(settings.includes("words: ['极其']"), '污染词清理默认必须包含“极其”。');
assert(settings.includes('归一化额外功能设置'), '旧存档必须能归一化额外功能设置。');
assert(settingsModal.includes("'extra'"), '设置弹窗必须新增额外功能 tab。');
assert(settingsModal.includes('ExtraFeaturesSettingsTab'), '设置弹窗必须渲染额外功能页。');
assert(extraTab.includes('污染词清理') && extraTab.includes('极其'), '额外功能页必须提供污染词清理配置。');
assert(useGameState.includes('额外功能: 归一化额外功能设置(savedGame.额外功能)'), '启动加载旧设置时必须补齐额外功能。');
assert(saveLoadWorkflow.includes('replaceGameState: state.replaceGameState'), '正式读档必须只替换提瓦特游戏根。');
assert(!saveLoadWorkflow.includes('state.setGameSettings('), '正式读档不得用存档覆盖本地额外功能偏好。');
assert(sendWorkflow.includes('sanitizeParsedResponse(result.parsed, state.gameSettings.额外功能)'), '主回复落地前必须清理 parsedResponse。');
assert(sendWorkflow.includes('sanitizeContaminatedText(parsedBody, state.gameSettings.额外功能)'), '正文进入历史前必须清理污染词。');
assert(sendWorkflow.includes('parsedForDisplay.factCandidates'), '正式候选事实必须读取清理后的 NarrativeTurn。');
assert(sendWorkflow.includes('parsedForDisplay.continuation.summary'), '记忆与世界进度必须读取清理后的延续摘要。');
assert(sanitizer.includes('next = next.split(word).join'), '污染词清理必须从文本中删除命中的词。');
assert(sanitizer.includes('if (!config?.enabled) return text'), '关闭污染词清理时不得改写文本。');
for (const field of ['body', 'choices', 'factCandidates', 'continuation', 'summary', 'unresolved']) {
  assert(sanitizer.includes(field), `sanitizeParsedResponse 必须清理正式 NarrativeTurn 字段 ${field}。`);
}

console.log('extra features regression ok');
