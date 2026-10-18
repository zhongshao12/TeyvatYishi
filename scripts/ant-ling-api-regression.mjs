import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const read = (path) => fs.readFileSync(path, 'utf8');

const core = read('services/ai/antLingProxyCore.ts');
const policy = read('services/ai/antLingPolicy.ts');
const client = read('services/ai/chatCompletionClient.ts');
const catalog = read('services/ai/openAICompatibleModels.ts');
const cloudflareFunction = read('functions/api/antling.ts');
const localProxy = read('build/antLingProxy.ts');
const viteConfig = read('vite.config.ts');
const apiSettings = read('components/features/Settings/ApiSettings.tsx');

// 1) 客户端策略：只放浏览器也需要的纯函数；代理核心只放服务端转发。
assert(policy.includes('export const ANT_LING_API_BASE = `${ANT_LING_ORIGIN}/v1`'), '蚂蚁百灵官方 Base 必须固定为 https://api.ant-ling.com/v1。');
assert(policy.includes('export function normalizeAntLingBaseUrl'), 'Base URL 归一化必须可复用。');
assert(policy.includes('export function isAntLingBaseUrl'), 'Base URL 检测必须可复用。');
assert(policy.includes('export function isAntLingThinkingModel'), '3.0/3.1 思考检测必须可复用。');
assert(policy.includes('export function clampAntLingTemperature'), 'temperature 收敛必须可复用。');
assert(policy.includes('export function buildAntLingProxyBody'), '代理请求体必须可复用。');
assert(!/from '\.\/upstreamProxy'/.test(policy), '客户端策略不得引入服务端转发实现，避免把上游代理打进主包。');
assert(/assertAntLingBaseUrl[\s\S]*?仅允许代理蚂蚁百灵/.test(core), '代理必须拒绝非官方主机，不能当开放中转。');
assert(core.includes("payload.kind === 'models' ? `${base}/models`"), '代理必须支持 /v1/models。');
assert(core.includes('chat/completions'), '代理必须支持 chat/completions。');
assert(core.includes('export function antLingLocalOriginAllowed'), '本机转发必须做同源校验。');

// 2) 客户端：流式与非流式都走同源转发。
assert(client.includes("from './antLingPolicy'"), '聊天客户端只能引入客户端策略，避免把转发实现打进主包。');
assert(/isAntLingBaseUrl\(config\.baseUrl\)\s*\n?\s*\? ANT_LING_PROXY_PREFIX/.test(client), '流式请求必须走 /api/antling。');
assert(/isAntLingBaseUrl\(deepSeekPayload\.config\.baseUrl\)\s*\n?\s*\? ANT_LING_PROXY_PREFIX/.test(client), '非流式请求必须走 /api/antling。');
assert(client.includes('buildAntLingProxyBody'), '两类请求都必须构造蚂蚁百灵代理请求体。');
assert(client.includes("body.thinking = { type: 'disabled' }"), '3.0/3.1 系列必须关闭思考，避免吃掉输出额度。');
assert(client.includes('clampAntLingTemperature'), 'temperature 必须收敛到官方 [0,1]。');
assert(/!isAntLingBaseUrl\(config\.baseUrl\)\s*\)\s*\{\s*\n\s*body\.stream_options/.test(client), '蚂蚁百灵不应发送非文档的 stream_options。');
assert(client.includes('蚂蚁百灵 API Error'), '必须提供蚂蚁百灵专用错误诊断。');
assert(client.includes('/api/antling 同源转发'), '404 诊断必须提示同源转发是否随包部署。');

// 3) 模型列表：同一转发，避免浏览器 CORS Failed to fetch。
assert(catalog.includes("from './antLingPolicy'"), '模型目录只引入客户端策略，避免把转发实现打进主包。');
assert(/isAntLingBaseUrl\(baseRaw\)\)\s*return fetchAntLingModelCatalog/.test(catalog), '模型目录必须改走同源转发。');
assert(catalog.includes("fetch(ANT_LING_PROXY_PREFIX"), '模型目录转发地址必须是 /api/antling。');
assert(catalog.includes('kind: \'models\''), '模型目录转发必须声明 kind=models。');

// 4) 部署：Cloudflare Pages + 本机 dev/preview 两条转发都必须在。
assert(cloudflareFunction.includes('handleAntLingProxyRequest'), 'Cloudflare 代理必须复用共享代理核心。');
assert(cloudflareFunction.includes('guardProxyEndpoint'), 'Cloudflare 代理必须经过来源校验与限流。');
assert(cloudflareFunction.includes("scope: 'antling'"), 'Cloudflare 代理必须使用独立限流作用域。');
assert(localProxy.includes('ANT_LING_PROXY_PREFIX'), '本机转发必须使用同一路径常量。');
assert(localProxy.includes('antLingLocalOriginAllowed'), '本机转发必须校验同源。');
assert(localProxy.includes('configurePreviewServer'), '本机预览也必须提供转发。');
assert(viteConfig.includes("from './build/antLingProxy'"), 'Vite 配置必须引入蚂蚁百灵转发插件。');
assert(viteConfig.includes('antLingProxyPlugin()'), 'Vite 配置必须注册蚂蚁百灵转发插件。');

// 5) 设置页：一键速填 + 官方模型提示。
assert(apiSettings.includes('蚂蚁百灵 Ling'), 'API 设置页必须提供蚂蚁百灵速填。');
assert(apiSettings.includes('ANT_LING_API_BASE'), '速填必须使用官方 Base URL 常量。');
assert(apiSettings.includes('functions/api/antling.ts'), '设置页必须说明线上部署需要随包带上转发函数。');
assert(apiSettings.includes('ANT_LING_MODELS'), '设置页必须列出官方模型。');

// 6) 其它供应商不受影响：非蚂蚁百灵仍然直连上游，并保留 Bearer 鉴权。
assert(/: upstreamUrl;/.test(client), '非蚂蚁百灵请求必须保留直连上游的分支。');
assert(/url\.startsWith\('\/api\/'\) \? \{\} : \{ Authorization/.test(client), '仅同源转发请求省略 Authorization，其它供应商仍带 Bearer。');

console.log('ant ling api regression ok');
