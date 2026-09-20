import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const variableFacts = fs.readFileSync('utils/variableFacts.ts', 'utf8');
const variableRegistry = fs.readFileSync('utils/variableRegistry.ts', 'utf8');
// 迁移: 主剧情工作流已拆分为多阶段模块，改按登记表整体读取（只换读取源，断言语义不变）。
const sendWorkflow = readWorkflowSources();
const systemPromptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const codexRetrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
const variableModel = fs.readFileSync('services/ai/variableModel.ts', 'utf8');
const domainOutputFormat = fs.readFileSync('prompts/subsystems/domainCommandOutputFormat.ts', 'utf8');
const domainRules = fs.readFileSync('prompts/subsystems/domainCommandPrompt.ts', 'utf8');
const variableWorldbook = fs.readFileSync('data/variableWorldbook.ts', 'utf8');
const promptModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');
const worldbookConfig = fs.readFileSync('data/builtinWorldbookConfig.ts', 'utf8');
const canonicalCharacters = fs.readFileSync('data/canonicalCharacters.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const memoryCompression = fs.readFileSync('services/memoryCompression.ts', 'utf8');
const irminsulPrompt = fs.readFileSync('prompts/subsystems/irminsulPrompt.ts', 'utf8');

const protectedFields = [
  '姓名',
  '别名',
  '性别',
  '年龄',
  '生日',
  '身高',
  '身份',
  '外貌',
  '性格',
  '背景',
  '专长知识',
  '能力',
  '头像',
  '图像档案',
  '主元素',
  '元素共鸣',
  '天赋',
];

assert(variableFacts.includes("if (fact.type === 'traveler_profile')"), '事实层必须显式处理 traveler_profile。');
assert(variableFacts.includes('已静默忽略 traveler_profile'), 'traveler_profile 必须被静默忽略并写入报告。');
assert(!variableFacts.includes("key: '旅人.身份'"), 'traveler_profile 不得再转换为 set 旅人.身份。');
assert(!variableFacts.includes("key: '旅人.外貌'"), 'traveler_profile 不得再转换为 set 旅人.外貌。');
assert(!variableFacts.includes("key: '旅人.性格'"), 'traveler_profile 不得再转换为 set 旅人.性格。');
assert(!variableFacts.includes("key: '旅人.背景'"), 'traveler_profile 不得再转换为 set 旅人.背景。');
assert(!variableFacts.includes("key: '旅人.能力'"), 'traveler_profile 不得再 push 旅人.能力。');
assert(!variableFacts.includes("key: '旅人.专长知识'"), 'traveler_profile 不得再 push 旅人.专长知识。');

assert(variableRegistry.includes('TRAVELER_PLAYER_AUTHORED_FIELDS'), '变量登记表必须有旅人玩家手写字段保护名单。');
for (const field of protectedFields) {
  assert(variableRegistry.includes(`'${field}'`), `保护名单必须包含 旅人.${field}。`);
}
assert(variableRegistry.includes('isTravelerPlayerAuthoredPath'), '变量校验必须识别旅人玩家手写路径。');
assert(variableRegistry.includes('isTravelerPlayerAuthoredVariablePath'), '变量校验必须导出旅人玩家手写路径过滤 helper。');
assert(variableRegistry.includes('变量模型不得 ${cmd.action}'), '变量校验拒绝原因必须阻止旧命令修改玩家档案。');
assert(variableRegistry.includes("path !== '旅人' && !isTravelerPlayerAuthoredPath(path)"), '变量登记表不得暴露旅人根路径和玩家手写字段。');
assert(variableRegistry.includes('旅人根对象包含玩家手写核心档案'), 'set 旅人 整根必须被拒绝，避免绕过字段保护。');
assert(variableRegistry.includes("path: '背包.items'"), '正式 root 背包 schema 必须保留，运行时物品不能被误伤。');
assert(!variableRegistry.includes("path: '旅人.背包'"), '旅人档案不得保留背包镜像。');
assert(variableRegistry.includes("'元素共鸣'"), '旅人元素共鸣必须在玩家/服务维护字段保护名单中。');
assert(variableRegistry.includes("'天赋'"), '旅人天赋必须在玩家维护字段保护名单中。');
assert(variableRegistry.includes('export function validateCommand') && variableRegistry.includes('isTravelerPlayerAuthoredVariablePath(cmd.key)'), '变量执行前必须通过统一登记表校验过滤旅人核心档案旧命令。');
assert(variableFacts.includes('已静默忽略 traveler_profile'), '事实转换报告必须说明旧旅人档案事实已静默忽略。');

assert(variableModel.includes('DOMAIN_COMMAND_RULES_PROMPT') && domainRules.includes('不得输出 traveler_profile'), '变量模型提示词必须禁止 traveler_profile。');
assert(domainRules.includes('旅行者核心档案只读'), '领域事实规则必须说明旅行者核心档案由玩家维护。');
assert(domainRules.includes('剧情中获得的新身份称呼、临时伪装、别人对玩家能力的认知'), '领域事实规则必须给出替代落库方向。');
assert(domainOutputFormat.includes('不输出调试过程、内部推理'), '领域事实输出契约不得请求隐藏推理。');
assert(variableWorldbook.includes('只读玩家档案'), '变量世界书必须说明玩家档案只读。');
assert(variableWorldbook.includes('traveler_profile'), '变量世界书禁止清单必须覆盖 traveler_profile。');
assert(!promptModules.includes('const RESPONSE_FORMAT_CONTENT') && !promptModules.includes('<变量草稿>'), '主剧情不得恢复可诱导旅人档案更新的旧变量草稿 sidecar。');

assert(variableFacts.includes('isCanonicalNpcPersonalityProtected'), '事实层必须保护原著 NPC 长期性格字段。');
assert(variableFacts.includes('原著角色长期性格由图鉴人物主体资料校准'), '原著 NPC 性格保护必须写入变量报告说明。');
assert(variableFacts.includes('性格: canonical?.personality ?? fact.personality'), '新建原著 NPC 时必须优先使用原著库性格而不是变量事实临时性格。');
assert(domainRules.includes('原著 NPC 的长期 personality/性格由图鉴人物主体资料保护'), '变量模型提示词必须禁止改写原著角色长期性格。');
assert(domainRules.includes('单回合的沉默、紧张、冷淡、受伤或戒备只能写进'), '变量模型必须禁止把单回合状态固化成人格。');
assert(variableWorldbook.includes('原著角色的长期性格必须由图鉴人物主体资料保护'), '变量世界书必须说明原著 NPC 性格由图鉴主体资料保护。');
assert(canonicalCharacters.includes('安柏') && canonicalCharacters.includes('凯亚'), '原著角色库必须保留代表性提瓦特 NPC。');
// 批次1(2026-07-26): 静态角色性格清单压缩为原则句,具体锚点改由智库人物资料动态提供(D7);
// 世界书副本(下一条断言)保留至批次5,过渡期规则无真空。
assert(promptModules.includes('原著角色必须保留原作性格与职责；具体性格、口吻与行为锚点以本回合注入的图鉴人物资料为准'), '主提示词必须把原著角色锚点指向图鉴人物资料。');
assert(promptModules.includes('不得临时脑补或写成沉默工具人'), '主提示词必须禁止把原著角色写成沉默工具人。');
assert(worldbookConfig.includes('自定义旅行者、空与荧是独立个体'), '默认世界书必须让自定义旅行者与空、荧并存且身份独立。');
assert(worldbookConfig.includes('安柏、凯亚、琴等原著人物'), '默认叙事规则必须以代表性提瓦特 NPC 约束角色表现。');
assert(!/舰队|命途|神选者|星穹|空间站/u.test(worldbookConfig), '默认 worldbook 源不得保留舰队、命途、神选或星穹身份语义。');
assert(systemPromptBuilder.includes('图鉴人物主体人格优先校准长期口吻与行为边界'), '主提示词必须声明原著角色长期人格以图鉴主体资料为准。');
assert(systemPromptBuilder.includes('临时/旧档案性格参考') && systemPromptBuilder.includes('长期人格以图鉴人物主体资料为准'), '主提示词中原著 NPC 档案性格必须降级为临时/旧档案参考。');
assert(codexRetrieval.includes('buildCodexEntryInjectionPreview') && systemPromptBuilder.includes('retrieveCodexEntries'), '图鉴人物注入必须通过正式检索校准角色资料。');
assert(settings.includes('单回合沉默、紧张、冷淡、受伤、戒备或少话只能作为当时状态'), '默认记忆系统提示词必须禁止把单回合状态压缩成长期人格。');
assert(settings.includes('长期人格、口吻和 OOC 边界以图鉴人物主体资料为准'), '默认 NPC 记忆压缩提示词必须以图鉴主体资料为长期人格来源。');
assert(settings.includes('原著角色的长期人格不要由世界树归档改写'), '默认世界树归档提示词必须禁止改写原著角色长期人格。');
assert(memoryCompression.includes('不得压缩成长期人格') && memoryCompression.includes('图鉴人物主体资料为准'), '记忆压缩运行时额外要求必须保护原著角色长期人格。');
assert(irminsulPrompt.includes('原著角色的长期人格与口吻由图鉴主体资料保护') && irminsulPrompt.includes('世界树只记录共同经历、关系事实、承诺、冲突和后果'), '世界树精炼运行时额外要求必须保护原著角色长期人格。');

console.log('traveler profile guard regression ok');
