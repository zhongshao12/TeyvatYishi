import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const cot = fs.readFileSync('prompts/cot/rewriteCot.ts', 'utf8');
const service = fs.readFileSync('services/ai/rewriteService.ts', 'utf8');
const turn = fs.readFileSync('components/features/Chat/TurnItem.tsx', 'utf8');
const chat = fs.readFileSync('components/features/Chat/ChatList.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');

assert(cot.includes("export type 改写模式 = 'polish' | 'expand' | 'condense' | 'rephrase'"), 'cot must define four modes.');
assert(cot.includes('export function buildRewritePrompt'), 'cot must build prompt.');
assert(cot.includes('不改变任何既定事实'), 'cot must forbid fact changes.');
assert(cot.includes('不得新增设定'), 'cot must forbid new lore.');
assert(cot.includes('只输出改写后的正文本身'), 'cot must output body only.');

assert(service.includes('export async function rewriteBody'), 'service must export rewriteBody.');
assert(service.includes('chatCompletionNonStream'), 'service must use non-stream completion.');
assert(service.includes('buildRewritePrompt'), 'service must use rewrite prompt.');
assert(service.includes("mode: 改写模式 = 'polish'"), 'service must default to polish.');

assert(turn.includes("label=\"改写正文\""), 'TurnItem must show rewrite action.');
assert(turn.includes("type ToolKey = 'edit' | 'rewrite' | 'usage' | 'context'"), 'TurnItem must register rewrite alongside response and context tools.');
assert(turn.includes('const handleRewriteGenerate'), 'TurnItem must generate rewrite.');
assert(turn.includes('rewriteBody(rewriteConfig, bodyText, rewriteMode)'), 'TurnItem must call rewrite service with rendered NarrativeTurn body text.');
assert(turn.includes('onEditBody && rewriteDraft.trim()) onEditBody(message.id, rewriteDraft)'), 'confirm must write body only via edit handler.');
assert(turn.includes('不重跑回合副作用'), 'UI must state no side effects.');
assert(turn.includes('rewriteConfig?: API配置项'), 'TurnItem must accept rewrite config.');

assert(chat.includes('rewriteConfig?: API配置项'), 'ChatList must accept rewrite config.');
assert(chat.includes('rewriteConfig={rewriteConfig}'), 'ChatList must pass rewrite config down.');
// 迁移: 旧 App 内联 `rewriteConfig={state.apiSettings.activeConfigId...}`（在 App 里直接比对 activeConfigId 并回退首个配置）
//   -> 新 App 用 `resolveActiveApiConfig(state.apiSettings, ...)` 统一解析，再把 `rewriteConfig ?? undefined` 传给 ChatList。
//   理由: 执行路径与 UI 助手必须共用同一个「生效配置」解析器；activeConfigId 生效 + 回退到首个配置的逻辑收敛到
//   services/ai/activeApiConfig.ts。断言意图不变，因此把该解析器的读取源一并纳入本脚本。
const activeApiConfig = fs.readFileSync('services/ai/activeApiConfig.ts', 'utf8');
assert(
  app.includes('const rewriteConfig = useMemo(() => resolveActiveApiConfig(')
  && app.includes('rewriteConfig={rewriteConfig ?? undefined}')
  && activeApiConfig.includes('config.id === apiSettings.activeConfigId')
  && activeApiConfig.includes('?? apiSettings.configs[0]'),
  'App must wire the active config with first-config fallback to ChatList.',
);

console.log('rewrite service regression ok');
