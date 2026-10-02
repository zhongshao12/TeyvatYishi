import fs from 'node:fs';

/**
 * 角色主动行为门禁（2026-09-29，用户第 4 项）。
 *
 * 规则来自仓库自己的规格 `docs/superpowers/specs/2026-09-29-world-moment-and-chapter-boundary-design.md:63`：
 * 只限**已有手机联系人**、好感度**至少 100**、**每完成 15 个游戏回合最多一位**、**全局冷却**。
 * 行为细节由 `tests/unit/proactiveContacts.test.ts` 覆盖，这里只钉「承重结构」不得被改回去。
 */

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^[ \t]*\/\/.*$/gmu, '');

const planner = stripComments(fs.readFileSync('services/proactiveContacts.ts', 'utf8'));
const stage = stripComments(fs.readFileSync('hooks/useGame/variableCalibrationStage.ts', 'utf8'));
const jobs = stripComments(fs.readFileSync('hooks/useGame/courierBackgroundJobs.ts', 'utf8'));

assert(planner.includes('PROACTIVE_CONTACT_MIN_AFFINITY = 100'),
  '主动联系的好感度门槛必须保持 100（规格硬门槛）。');
assert(planner.includes('PROACTIVE_CONTACT_INTERVAL_TURNS = 15'),
  '主动联系必须保持「每 15 个游戏回合最多一位」的全局节奏。');
assert(/npc\.关系 !== 'enemy'/.test(planner), '敌对关系不得主动联系。');
assert(/relatedEventId/.test(planner), '主动来信必须写 relatedEventId 作为幂等键（同一天不重复打扰）。');
assert(/seed\.relatedEventId\.startsWith\(今日前缀\)/.test(planner),
  '「同一天不重复打扰」必须按 日 + 角色 判定，不能只比对完整键（否则换个触发理由就能再打扰一次）。');

assert(stage.includes('planProactiveContacts('), '回合结算必须真的调用主动联系规划器。');
assert(stage.includes('proactiveSeeds: proactivePlan.seeds'), '规划结果必须交给投递任务。');
assert(/pushQueueTask\(state, 'courier', 'skipped', \{ detail: `本回合无角色主动联系/.test(stage),
  '主动联系未发生时必须留下可查原因（不得静默）。');

assert(/const proactiveSeeds = \(input\.proactiveSeeds \?\? \[\]\)/.test(jobs),
  '投递任务必须优先使用主动来信种子。');
assert(/if \(proactiveSeeds\.length\) \{/.test(jobs) && jobs.includes('buildFallbackCourierSeed({'),
  '主动来信与通用跟进兜底必须互斥（同回合只出一封）。');

console.log('proactive contact regression ok');
