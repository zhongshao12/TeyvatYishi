import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const apiSettings = fs.readFileSync('components/features/Settings/ApiSettings.tsx', 'utf8');
const settingsModal = fs.readFileSync('components/features/Settings/SettingsModal.tsx', 'utf8');

assert(apiSettings.includes("kind: 'api-profile'"), 'API 配置包必须有独立 kind 标识。');
assert(apiSettings.includes("const API_PROFILE_SLOTS_KEY = 'apiProfileSlots'"), '本机 API 方案槽位必须有独立 settings key。');
assert(apiSettings.includes('interface API方案槽位'), '必须定义本机 API 方案槽位结构。');
assert(apiSettings.includes('includeApiKeys'), 'API 配置包必须标记是否包含 API Key。');
assert(apiSettings.includes('enableClaudeMode: gameSettings.enableClaudeMode === true'), 'API 配置包必须保存 Claude 专用模式开关。');
assert(apiSettings.includes('enableClaudeMode: profile.enableClaudeMode'), '导入 API 配置包必须恢复 Claude 专用模式开关。');
assert(apiSettings.includes('cloneWithoutKeys'), '安全导出必须走清理 API Key 的副本。');
assert(apiSettings.includes("(target as { apiKey?: string }).apiKey = ''"), '安全导出必须清空 apiKey。');
// 迁移: 旧 assert(apiSettings.includes('window.confirm')) -> 改为断言导出路径走样式化确认弹窗。
// 理由: 原生 window.confirm 无法换主题/读屏标注，B6 把私人包导出收敛到 useConfirmDialog
// （tone:'danger' + API Key 警告文案）。断言意图不变：私人 API 配置包导出必须二次确认。
assert(
  apiSettings.includes('私人 API 配置包会包含 API Key') && apiSettings.includes('tone: \'danger\''),
  '私人 API 配置包导出必须二次确认。',
);
assert(apiSettings.includes('请勿分享') || apiSettings.includes('不要发给别人'), '私人 API 配置包必须提示不要分享。');
assert(apiSettings.includes('loadSetting<API方案槽位[]>'), 'API 页必须读取本机 API 方案槽位。');
assert(apiSettings.includes('handleSaveProfileSlot'), 'API 页必须能保存当前方案到本机槽位。');
assert(apiSettings.includes('handleLoadProfileSlot'), 'API 页必须能一键读取本机方案。');
assert(apiSettings.includes('handleDeleteProfileSlot'), 'API 页必须能删除本机方案。');
assert(apiSettings.includes('slice(0, 12)'), '本机 API 方案槽位应限制数量，避免无限增长。');
assert(apiSettings.includes('buildApiProfile(settings, gameSettings, true)'), '本机 API 方案应保留 Key，方便一键切换。');
assert(apiSettings.includes('handleApplyAuxModel'), 'API 页必须提供其他 API 模型一键套用功能。');
assert(apiSettings.includes('handleFetchAuxModels'), '其他 API 模型设置必须支持获取模型列表。');
assert(apiSettings.includes('setAuxModelOptions(list)'), '其他 API 模型设置必须从接口返回列表中选择模型。');
assert(apiSettings.includes('其他 API 模型设置'), 'API 页必须显示其他 API 模型设置面板。');
assert(apiSettings.includes('auxForm.provider'), '其他 API 模型设置必须支持单独选择供应商。');
assert(apiSettings.includes('auxForm.baseUrl'), '其他 API 模型设置必须支持单独填写 Base URL。');
assert(apiSettings.includes('auxForm.apiKey'), '其他 API 模型设置必须支持单独填写 API Key。');
assert(apiSettings.includes('const auxApiPatch = { provider, baseUrl, apiKey, model }'), '其他 API 一键套用必须同时覆盖 provider/baseUrl/apiKey/model。');
assert(apiSettings.includes('overflow-y-auto'), 'API 设置页大窗口必须提供内部滚动。');
assert(!apiSettings.includes('flex-1 flex-col gap-3 overflow-y-auto'), 'API 配置详情区不得再单独滚动，应让整个 API 页滚动。');
assert(apiSettings.includes('安全包：不会保存 Key 数据'), 'API 设置页顶部必须提示安全包不会保存 Key。');
assert(apiSettings.includes('私人包：会保存 Key 数据'), 'API 设置页顶部必须提示私人包会保存 Key。');
assert(apiSettings.includes('主剧情和变量推荐使用智商高一点的模型'), 'API 设置页顶部必须提示主剧情和变量模型建议。');
assert(apiSettings.includes('variableApi: { ...gameSettings.variableApi, ...auxApiPatch }'), '其他 API 模型设置必须覆盖变量 API。');
assert(apiSettings.includes('蒸汽鸟报系统: { ...gameSettings.蒸汽鸟报系统, api: { ...gameSettings.蒸汽鸟报系统.api, ...auxApiPatch } }'), '其他 API 模型设置必须覆盖蒸汽鸟报 API。');
assert(apiSettings.includes('手机系统: { ...gameSettings.手机系统, api: { ...gameSettings.手机系统.api, ...auxApiPatch } }'), '其他 API 模型设置必须覆盖手机消息 API。');
assert(apiSettings.includes('图鉴系统: { ...gameSettings.图鉴系统, api: { ...gameSettings.图鉴系统.api, ...auxApiPatch } }'), '其他 API 模型设置必须覆盖图鉴 API。');
assert(apiSettings.includes('剧情编织系统: { ...gameSettings.剧情编织系统, api: { ...gameSettings.剧情编织系统.api, ...auxApiPatch } }'), '其他 API 模型设置必须覆盖剧情编织 API。');
assert(apiSettings.includes('记忆总结API: { ...gameSettings.记忆系统.记忆总结API, ...auxApiPatch }'), '其他 API 模型设置必须覆盖记忆总结 API。');
assert(apiSettings.includes('世界树召回API: { ...gameSettings.记忆系统.世界树召回API, ...auxApiPatch }'), '其他 API 模型设置必须覆盖世界树召回 API。');
assert(apiSettings.includes('世界树归档API: { ...gameSettings.记忆系统.世界树归档API, ...auxApiPatch }'), '其他 API 模型设置必须覆盖世界树归档 API。');
assert(apiSettings.includes('不影响文生图'), '其他 API 模型设置必须声明不改文生图。');
assert(!apiSettings.includes("['gemini-2.5-flash', 'gemini-2.0-flash', 'deepseek-chat', 'gpt-4o-mini']"), '其他 API 模型设置不得提供写死的快捷模型列表。');

for (const key of [
  'variableApi',
  '蒸汽鸟报系统',
  '手机系统',
  '图鉴系统',
  '剧情编织系统',
  '记忆总结API',
  '世界树召回API',
  '世界树归档API',
  '文生图普通接口',
  '文生图NSFW接口',
  '文生图词组转化器API',
]) {
  assert(apiSettings.includes(key), `API 配置包必须覆盖 ${key}。`);
}
assert(apiSettings.includes('文生图场景接口'), 'API 配置包可保留文生图场景接口字段用于旧包兼容。');
assert(!apiSettings.includes('场景接口: profile.routes.文生图场景接口'), '导入 API 配置包不得再用场景接口覆盖运行配置。');

assert(apiSettings.includes("await saveSetting('apiSettings', nextApiSettings)"), '导入 API 配置包必须持久化主 API 设置。');
assert(apiSettings.includes("await saveSetting('gameSettings', nextGameSettings)"), '导入 API 配置包必须持久化独立系统 API 设置。');
assert(apiSettings.includes('await saveSetting(API_PROFILE_SLOTS_KEY, slots)'), '本机 API 方案槽位必须持久化。');
assert(settingsModal.includes('gameSettings={gameSettings}') && settingsModal.includes('onGameSettingsChange={persistGameSettingsChange}'), '设置弹窗必须把 gameSettings 和统一持久化入口传给 API 页。');

console.log('api profile regression ok');
