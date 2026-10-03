import fs from 'node:fs';

/**
 * 好感度优先级 + 时间跨度门禁（2026-09-29 第二轮，用户报的两件事）。
 *
 * 行为细节由 `tests/unit/userReportedAffinityAndTime.test.ts`（18 条）覆盖；这里钉承重结构：
 * - 好感度：增量必须优先于「模型回显成绝对值」的覆盖；生死挚友（>100）不得被一次结算压低；
 * - 时间：正文跨日短语必须真推进（数日/几日/周/半个月/月/年），且正文与模型的跨度上限分开。
 */

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^[ \t]*\/\/.*$/gmu, '');
const facts = stripComments(fs.readFileSync('utils/variableFacts.ts', 'utf8'));

// ── 好感度 ──
assert(/typeof fact\.affinityDelta === 'number' && typeof fact\.affinitySet === 'number'/.test(facts),
  '同时出现增量与绝对值时必须走「增量优先」分支（模型回显成 affinitySet 是常见写法）。');
assert(facts.includes('已忽略 ${existing.姓名} 的绝对值'), '忽略绝对值时必须留下可查警告，不得静默吞掉。');
assert(facts.includes('生死挚友不因一次变量结算下降'),
  '生死挚友（>100）不得被一次绝对值覆盖压低（实测过 140 → 20）。');
assert(/currentAffinity > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD && fact\.affinitySet < currentAffinity/.test(facts),
  '递减护栏必须按「>100 且新值更低」判定。');

// ── 时间 ──
assert(facts.includes('跨日短语天数'), '正文跨日短语表必须存在（否则「数日后」会退回凭空 3 分钟）。');
for (const token of ['(?:天|日)(?:之)?后', '周|星期|礼拜', '月(?:之)?后', '年(?:之)?后']) {
  assert(facts.includes(token), `跨日短语表必须覆盖 ${token} 这类表达。`);
}
assert(facts.includes('(?:数|几|好几|好|许多|很多)'), '「数日/几日/好几天」这类模糊跨日表达必须识别。');
assert(facts.includes('const 最大跨日天数 = 365'), '正文跨度上限应为 365 天。');
assert(/const dayCap = source === 'model' \? 7 : 最大跨日天数/.test(facts),
  '正文与模型的跨度上限必须分开：模型仍收紧在 7 天，正文按 365 天。');
assert(!/Math\.min\(7,\s*fact\.days/.test(facts),
  '命令层不得再出现 Math.min(7, fact.days) —— 它会把「半个月后」压成 7 天。');
assert(/超出可结算范围/.test(facts), '超出上限的正文跨度必须拦下并给出可查原因，不得静默乱跳。');

console.log('affinity and world-time regression ok');
