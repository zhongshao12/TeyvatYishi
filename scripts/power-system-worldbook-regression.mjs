import fs from 'node:fs';

// 批次5(D10, 2026-07-26): 力量体系总览由内置世界书迁移为提示词模块 builtin_rule_power_system。
// 本回归改为守卫迁移后的形态:内容常量仍在 builtinWorldbookConfig.ts,模块定义在 builtinPromptModules.ts,
// 旧世界书 id 必须进入清理黑名单且不再出现在内置书白名单。

const source = fs.readFileSync('data/builtinWorldbookConfig.ts', 'utf8');
const modules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');
const gameState = fs.readFileSync('hooks/useGameState.ts', 'utf8');
const promptModel = fs.readFileSync('models/prompts.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  source.includes('export const POWER_SYSTEM_OVERVIEW_CONTENT = `## 提瓦特力量边界'),
  'Power system overview must remain a single exported content block in builtinWorldbookConfig.',
);
assert(
  !source.includes("id: 'builtin_power_system_overview_scale'") && !source.includes('powerSystemOverviewBook'),
  'Power system overview must no longer be generated as a worldbook (migrated to prompt module).',
);
assert(
  modules.includes("id: 'builtin_rule_power_system'") &&
    modules.includes('content: POWER_SYSTEM_OVERVIEW_CONTENT') &&
    modules.includes("title: '力量体系总览'"),
  'Power system overview must be defined as builtin prompt module builtin_rule_power_system.',
);
assert(
  /id: 'builtin_rule_power_system'[\s\S]{0,400}scope: \['main', 'elementalEcho'\]/.test(modules.replace(/\r\n/g, '\n')),
  'Power system module must keep scope main + elementalEcho.',
);
assert(
  promptModel.includes("'builtin_rule_power_system'"),
  'builtin_rule_power_system must be whitelisted in BUILTIN_PROMPT_MODULE_IDS.',
);
assert(
  gameState.includes("'builtin_power_system_overview'"),
  'Legacy power system worldbook id must be listed in REMOVED_LEGACY_WORLDBOOK_IDS for old-save cleanup.',
);
assert(
  source.includes('七元素为风、岩、雷、草、水、火、冰'),
  'Power system must use the seven native Teyvat elements.',
);
assert(
  source.includes('元素深化来自个人记忆、感受、选择、代价与理解'),
  'Elemental deepening must come from the traveler’s own experience and choices.',
);
assert(
  source.includes('ELEMENTAL_ECHO_INVITE_MASTERY') &&
    source.includes('尚未达到 100') &&
    source.includes('共鸣深化') &&
    !source.includes('<元素回响邀请>'),
  'Power system overview must share the native elemental echo threshold without a tagged sidecar.',
);
assert(!/舰队|命途|神选者|星穹|空间站/u.test(source), 'Active power/worldbook source must not retain HSR identity or fleet semantics.');

console.log('power system worldbook regression ok');
