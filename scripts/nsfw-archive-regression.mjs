import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const variableCommand = fs.readFileSync('models/variableCommand.ts', 'utf8');
const variableFacts = fs.readFileSync('utils/variableFacts.ts', 'utf8');
const variableModel = fs.readFileSync('services/ai/variableModel.ts', 'utf8');
const domainRules = fs.readFileSync('prompts/subsystems/domainCommandPrompt.ts', 'utf8');
const variableWorldbook = fs.readFileSync('data/variableWorldbook.ts', 'utf8');
const nsfwWorldbook = fs.readFileSync('data/nsfwWorldbook.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const enrichment = fs.readFileSync('utils/npcArchiveEnrichment.ts', 'utf8');
const companionPanel = fs.readFileSync('components/features/GameSystems/CompanionPanel.tsx', 'utf8');
const variableManager = fs.readFileSync('components/features/Settings/VariableManager.tsx', 'utf8');
const nsfwPolicy = fs.readFileSync('utils/nsfwArchivePolicy.ts', 'utf8');

// ─── 基础事实类型与字段 ───
assert(variableCommand.includes("'nsfw_archive'"), '变量事实类型必须包含 nsfw_archive。');
assert(variableCommand.includes('NSFW档案变量事实'), '必须定义 NSFW 档案变量事实结构。');
assert(variableFacts.includes("NSFW档案: 'nsfw_archive'"), '事实解析必须识别中文 NSFW档案。');
assert(variableFacts.includes("nsfw_archive: 'nsfw_archive'"), '事实解析必须识别 nsfw_archive。');
assert(variableFacts.includes("fact.type === 'nsfw_archive'"), '事实转命令必须处理 nsfw_archive。');
assert(variableFacts.includes('NPC[id=${existing.id}].NSFW档案'), 'nsfw_archive 必须转为 NPC NSFW档案写入。');
assert(variableFacts.includes('男性身体档案'), 'nsfw_archive 必须支持男性身体档案字段。');
assert(variableFacts.includes('女性身体档案'), 'nsfw_archive 必须支持女性身体档案字段。');

// ─── 硬禁名单：提瓦特幼态角色、机械与非人形 ───
assert(variableFacts.includes('getNsfwArchiveBlockReason'), '事实层必须调用集中 NSFW 资格策略。');
assert(enrichment.includes('getNsfwArchiveBlockReason'), '补档层必须调用集中 NSFW 资格策略。');
assert(sendWorkflow.includes('getNsfwArchiveBlockReason'), '旧命令层必须调用集中 NSFW 资格策略。');
assert(nsfwPolicy.includes('BLOCKED_CANONICAL_NAMES'), '集中策略必须维护原著名屏蔽名单。');
assert(nsfwPolicy.includes('派蒙') && nsfwPolicy.includes('七七') && nsfwPolicy.includes('可莉'), '集中策略必须覆盖提瓦特幼态角色。');
assert(nsfwPolicy.includes('怪物') && nsfwPolicy.includes('魔物'), '集中策略必须屏蔽怪物和魔物。');
assert(nsfwPolicy.includes('机械') && nsfwPolicy.includes('机器人') && nsfwPolicy.includes('人偶'), '集中策略必须屏蔽机械、机器人和普通人偶。');
assert(!/帕姆|史瓦罗|isHertaIdentity/u.test(nsfwPolicy), '集中策略不得保留旧世界角色例外。');

// ─── 年龄门禁解除 ───
// buildConservativeNsfwArchive 已改名为 buildNsfwArchiveUpdate，不再写保守基线。
assert(variableFacts.includes('buildNsfwArchiveUpdate'), 'nsfw_archive 必须使用 buildNsfwArchiveUpdate 合并档案。');
assert(!variableFacts.includes('buildConservativeNsfwArchive'), '不得再使用旧的 buildConservativeNsfwArchive 名称。');
// 检查 buildNsfwArchiveUpdate 函数体不再写入保守基线专属文案（允许注释里出现说明文字）。
{
  const fnStart = variableFacts.indexOf('function buildNsfwArchiveUpdate');
  const fnEnd = variableFacts.indexOf('\n}', fnStart);
  const fnBody = variableFacts.slice(fnStart, fnEnd);
  assert(!fnBody.includes("'保守基线'"), 'buildNsfwArchiveUpdate 函数体不得再写入保守基线标签。');
  assert(!fnBody.includes("'等待剧情事实补充'"), 'buildNsfwArchiveUpdate 函数体不得再写入等待剧情事实补充标签。');
  assert(!fnBody.includes('不代表已发生亲密剧情'), 'buildNsfwArchiveUpdate 函数体不得再写保守基线长期事实文案。');
}
// enrichment 的 buildNsfwBaseline 函数体不再写入保守基线文案（允许注释说明）。
{
  const fnStart = enrichment.indexOf('function buildNsfwBaseline');
  const fnEnd = enrichment.indexOf('\n}', fnStart);
  const fnBody = enrichment.slice(fnStart, fnEnd);
  assert(!fnBody.includes("'保守基线'"), 'buildNsfwBaseline 函数体不得再写入保守基线标签。');
  assert(!fnBody.includes("'等待剧情事实补充'"), 'buildNsfwBaseline 函数体不得再写入等待剧情事实补充标签。');
  assert(!fnBody.includes('不代表已发生亲密剧情'), 'buildNsfwBaseline 函数体不得再写保守基线长期事实文案。');
  assert(!fnBody.includes('未确认成人、明确同意与关系边界前'), 'buildNsfwBaseline 函数体不得再写保守基线边界文案。');
}
// 年龄门禁解除：年龄确认降级为纯展示信息。
assert(variableFacts.includes('年龄门禁已解除') || variableFacts.includes('不再限制'), 'variableFacts 必须标注年龄门禁已解除。');
assert(enrichment.includes('年龄门禁已解除') || enrichment.includes('不再限制'), 'enrichment 必须标注年龄门禁已解除。');

// ─── 变量模型提示词：原生领域事实与独立档案边界 ───
assert(variableModel.includes('DOMAIN_COMMAND_RULES_PROMPT'), '变量模型必须装配原生领域事实规则。');
assert(domainRules.includes('nsfw_archive'), '领域事实规则必须说明 nsfw_archive。');
assert(domainRules.includes('与普通档案隔离'), '领域事实规则必须隔离普通记忆与私密档案。');
assert(domainRules.includes('角色确认成人'), '领域事实规则必须保留成人确认边界。');
assert(!/帕姆|史瓦罗|黑塔|Herta|星穹/u.test(variableModel + domainRules), '变量模型原生提示不得保留旧宇宙角色例外或禁写名单。');

// ─── NSFW 空档案复审 ───
assert(variableModel.includes('nsfwCue'), 'EmptyFactsReview 必须支持 NSFW 空事实复审标记。');
assert(variableModel.includes('正文命中成人关系长期事实') && variableModel.includes('审计 nsfw_archive'), '复审提示必须指向 nsfw_archive。');

// ─── NSFW 世界书：提瓦特禁写名单 ───
assert(nsfwWorldbook.includes('派蒙') && nsfwWorldbook.includes('可莉') && nsfwWorldbook.includes('七七') && nsfwWorldbook.includes('纳西妲'), 'NSFW 世界书必须列出提瓦特幼态/非目标角色。');
assert(nsfwWorldbook.includes('丘丘人') && nsfwWorldbook.includes('深渊法师'), 'NSFW 世界书必须屏蔽提瓦特怪物。');
assert(!nsfwWorldbook.includes('帕姆') && !nsfwWorldbook.includes('史瓦罗') && !nsfwWorldbook.includes('黑塔 / 大黑塔'), 'NSFW 世界书不得保留星穹角色例外或禁写名单。');

// ─── 变量世界书：NSFW 规则同步 ───
assert(variableWorldbook.includes('NSFW'), '变量世界书必须保留 NSFW 隔离规则。');

// ─── 伙伴补档 NSFW 基线 ───
assert(enrichment.includes('if (!baseline) return false') === false, '伙伴补档的 NSFW 基线不能只覆盖少数手写 baseline。');
assert(enrichment.includes('shouldCreateNsfwBaseline'), '必须保留 NSFW 基线创建门禁。');

// ─── 旧命令屏蔽 ───
assert(sendWorkflow.includes('getNsfwBlockedCommandReason'), '旧 NSFW 变量命令也必须经过目标屏蔽。');
assert(nsfwPolicy.includes('机械或非人形对象'), '集中策略的旧命令屏蔽原因必须覆盖机械与非人形对象。');
assert(!sendWorkflow.includes('非人/生物形态/怪物/机械'), '旧命令屏蔽文案不得再引用过宽词。');

// ─── 显示层文案中性化 ───
assert(companionPanel.includes('未标注'), 'formatNsfwAge 必须用中性文案「未标注」。');
assert(!companionPanel.includes("'禁止写入'"), 'formatNsfwAge 不得再用「禁止写入」文案。');

// ─── 变量管理 NSFW 专用编辑器 ───
assert(variableManager.includes('NsfwArchiveEditor'), '变量管理必须提供 NSFW 档案专用编辑器。');
assert(variableManager.includes("label === 'NSFW档案'"), 'TreeNode 必须在 NSFW档案 字段处渲染专用编辑器。');
assert(variableManager.includes('NsfwTagEditor'), 'NSFW 编辑器必须提供标签编辑器。');
assert(variableManager.includes('NsfwSelectField'), 'NSFW 编辑器必须提供年龄下拉。');
assert(variableManager.includes('NsfwBodyArchiveSection'), 'NSFW 编辑器必须提供身体档案分组表单。');

console.log('nsfw archive regression ok');
