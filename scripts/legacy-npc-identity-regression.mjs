import fs from 'node:fs';

/**
 * D3/S5：legacy「id → 中文名」映射必须是**单一真源**。
 *
 * 这条门禁守的是"不要再复制一份"：三处曾各写一份逐字相同的 10 条映射，
 * 新增原著角色时漏改一处就会出现身份不一致（本轮拆「影」时正是先去核对这三处才敢动）。
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const shared = fs.readFileSync('utils/legacyNpcIdentity.ts', 'utf8');
const consumers = [
  'utils/variableRegistry.ts',
  'utils/variableFacts.ts',
  'utils/variableExecutor.ts',
];

assert(shared.includes('export const LEGACY_NPC_ID_TO_CHINESE_NAME'), '必须存在共享的 legacy id → 中文名映射。');
assert(shared.includes('export function normalizeLegacyNpcSelector'), '必须存在共享的选择器归一化函数。');

for (const file of consumers) {
  const source = fs.readFileSync(file, 'utf8');
  assert(
    source.includes("from '@/utils/legacyNpcIdentity'"),
    `${file} 必须从共享模块导入映射，而不是自己再写一份。`,
  );
  assert(
    !source.includes("aether: '空'"),
    `${file} 不得再内联 id → 中文名映射（会与共享真源分叉）。`,
  );
  assert(
    !source.includes("value.replace(/^npc[_-]/i, '').toLowerCase()"),
    `${file} 不得再内联选择器归一化（改用 normalizeLegacyNpcSelector）。`,
  );
}

console.log('legacy npc identity regression ok');
