import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const settings = fs.readFileSync('models/settings.ts', 'utf8');
const aiProviderOptions = fs.readFileSync('data/aiProviderOptions.ts', 'utf8');
const client = fs.readFileSync('services/ai/chatCompletionClient.ts', 'utf8');
const providerRouting = fs.readFileSync('services/ai/providerRouting.ts', 'utf8');
const apiTools = fs.readFileSync('services/ai/apiTools.ts', 'utf8');
const apiSettings = fs.readFileSync('components/features/Settings/ApiSettings.tsx', 'utf8');
const opencodeProxy = fs.readFileSync('functions/api/opencode.ts', 'utf8');
const opencodeProxyCore = fs.readFileSync('services/ai/opencodeProxyCore.ts', 'utf8');
const openCodeEndpointPolicy = fs.readFileSync('services/ai/openCodeEndpointPolicy.ts', 'utf8');
const viteConfig = fs.readFileSync('vite.config.ts', 'utf8');

const settingTabs = [
  'components/features/Settings/ApiSettings.tsx',
  'components/features/Settings/ImageGenerationSettingsTab.tsx',
  'components/features/Settings/MemorySystemSettings.tsx',
  'components/features/Settings/SteambirdSystemSettingsTab.tsx',
  'components/features/Settings/CourierSystemSettingsTab.tsx',
  'components/features/Settings/StoryWeavingSettingsTab.tsx',
  'components/features/Settings/VariableUpdateSettings.tsx',
  'components/features/Settings/IrminsulSettingsTab.tsx',
  'components/features/Settings/CodexSettingsTab.tsx',
];

assert(settings.includes("'opencode'"), 'AI 提供商必须包含 opencode。');
assert(apiSettings.includes("from '@/data/aiProviderOptions'") && apiSettings.includes('AI_PROVIDER_OPTIONS'), '主 API 设置必须复用统一提供商选项。');
assert(aiProviderOptions.includes("value: 'opencode'") && aiProviderOptions.includes('OpenCode Zen'), '统一提供商选项必须包含 OpenCode Zen。');
assert(aiProviderOptions.includes("defaultBaseUrl: 'https://opencode.ai/zen/v1'"), 'OpenCode Zen 默认 Base URL 必须是 Zen v1。');
assert(aiProviderOptions.includes("defaultModel: 'deepseek-v4-flash'"), 'OpenCode Zen 必须提供稳定的默认模型。');

for (const file of settingTabs) {
  const text = fs.readFileSync(file, 'utf8');
  assert(text.includes("from '@/data/aiProviderOptions'") && text.includes('AI_PROVIDER_OPTIONS'), `${file} 必须复用统一提供商选项。`);
}

assert(providerRouting.includes("case 'opencode': return 'opencode'"), 'OpenCode Zen 必须作为独立 provider 检测。');
assert(providerRouting.includes("return 'opencode'"), 'OpenCode Zen 检测不能落回 OpenAI 兼容。');
assert(client.includes("from './providerRouting'") && client.includes('detectChatProvider(config)'), 'OpenCode 客户端分支必须消费独立 provider routing。');
assert(client.includes('function inferOpenCodeEndpoint'), 'OpenCode Zen 必须按模型族推断 endpoint。');
assert(client.includes("from './openCodeEndpointPolicy'") && client.includes('normalizeOpenCodeBaseUrl(config.baseUrl)'), 'OpenCode Zen 主请求必须复用统一地址策略。');
assert(client.includes("return 'responses'"), 'GPT 系列 OpenCode Zen 模型必须走 /responses。');
assert(client.includes("if (/^(claude|qwen)/.test(id)) return 'messages';"), 'Claude/Qwen 系列 OpenCode Zen 模型必须走 /messages。');
assert(client.includes("return 'gemini'"), 'Gemini 系列 OpenCode Zen 模型必须走 Gemini 风格 endpoint。');
assert(client.includes("return 'chat'"), 'DeepSeek/Kimi/GLM/MiniMax 等 OpenCode Zen 模型必须默认走 /chat/completions。');
assert(client.includes("replace(/^opencode\\//i, '')"), 'OpenCode Zen 必须兼容玩家复制 opencode/model 写法。');
assert(client.includes('streamOpenCode(config, msgs, request, callbacks)'), '主剧情流式补全必须接入 OpenCode Zen。');
assert(client.includes('completionOpenCodeNonStream(config, msgs, request)'), '变量/智库等非流式补全必须接入 OpenCode Zen。');
assert(client.includes("fetchWithApiErrorReport(config, 'OpenCode Zen Chat 补全', '/api/opencode'"), 'OpenCode Zen 流式 chat 请求必须走同源代理。');
assert(client.includes("fetchWithApiErrorReport(config, 'OpenCode Zen Messages 补全', '/api/opencode'"), 'OpenCode Zen 流式 messages 请求必须走同源代理。');
assert(client.includes("fetchWithApiErrorReport(config, 'OpenCode Zen Responses 补全', '/api/opencode'"), 'OpenCode Zen 流式 responses 请求必须走同源代理。');
assert(client.includes("fetchWithApiErrorReport(config, 'OpenCode Zen Gemini 补全', '/api/opencode'"), 'OpenCode Zen 流式 Gemini 请求必须走同源代理。');
assert(client.includes('OpenCode Zen API Error'), 'OpenCode Zen 失败时必须提供专用错误诊断。');
assert(client.includes('OpenCode Zen 工作区余额不足'), 'OpenCode Zen 余额不足必须给出直白错误提示。');
assert(client.includes('GPT 走 /responses，Claude/Qwen 走 /messages，Gemini 走 /models/{model}:generateContent，其余模型走 /chat/completions'), 'OpenCode Zen 错误提示必须说明路由规则。');
assert(client.includes('openCodeHeaders'), 'OpenCode Zen 必须使用自己的请求头构造。');
assert(client.includes('Authorization: `Bearer ${config.apiKey}`'), 'OpenCode Zen 必须支持 Bearer Key。');
assert(!client.includes("if (provider === 'opencode') {\n    return streamOpenAICompatible"), 'OpenCode Zen 不得直接退回 OpenAI 兼容请求分支。');

assert(apiTools.includes("config.provider === 'opencode'"), '模型列表必须支持 OpenCode Zen provider。');
assert(apiTools.includes('fetchOpenCodeModels(baseRaw, apiKey, signal)'), 'OpenCode Zen 模型列表必须使用专用函数并转发取消信号。');
assert(apiTools.includes('https://opencode.ai/zen/v1/models'), 'OpenCode Zen 模型列表必须指向官方 Zen v1 models。');
assert(apiTools.includes("fetch('/api/opencode'"), 'OpenCode Zen 模型列表必须走同源代理，避免浏览器 CORS Failed to fetch。');
assert(apiTools.includes("from './openCodeEndpointPolicy'") && apiTools.includes('normalizeOpenCodeBaseUrl(baseRaw)'), 'OpenCode Zen 模型列表必须复用统一地址策略。');
assert(apiTools.includes('OpenCode Zen 模型列表'), 'OpenCode Zen 模型列表失败必须记录专用来源。');

assert(opencodeProxy.includes('handleOpenCodeProxyRequest'), 'Cloudflare OpenCode Zen 代理必须复用共享代理核心。');
assert(opencodeProxyCore.includes('opencode.ai/zen/v1'), 'OpenCode Zen 代理必须限制只能转发到 opencode.ai/zen/v1。');
assert(opencodeProxyCore.includes("from './openCodeEndpointPolicy'") && opencodeProxyCore.includes('normalizeOpenCodeBaseUrl(baseUrl)'), 'OpenCode Zen 代理必须复用统一地址策略。');
assert(openCodeEndpointPolicy.includes("replace(/\\/zen\\/go\\/v1/i, '/zen/v1')"), '统一地址策略必须兼容 /zen/go/v1 误填。');
assert(opencodeProxyCore.includes("endpoint?: 'chat' | 'messages' | 'responses' | 'gemini'"), 'OpenCode Zen 代理必须支持各模型族 endpoint。');
assert(viteConfig.includes("server.middlewares.use('/api/opencode'"), '本地 Vite 开发模式必须支持 /api/opencode 代理。');
assert(viteConfig.includes('handleOpenCodeProxyRequest'), '本地 Vite OpenCode 代理必须复用同一套代理核心。');

console.log('opencode api adaptation regression ok');
