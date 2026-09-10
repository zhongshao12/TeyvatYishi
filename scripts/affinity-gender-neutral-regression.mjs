import fs from 'node:fs';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const read = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8');

const variableWorldbook = read('data/variableWorldbook.ts');
const domainRules = read('prompts/subsystems/domainCommandPrompt.ts');
const variableModel = read('services/ai/variableModel.ts');
const domainOutputFormat = read('prompts/subsystems/domainCommandOutputFormat.ts');
const builtinWorldbook = read('data/builtinWorldbookConfig.ts');
const storyModeWorldbooks = read('data/storyModeWorldbooks.ts');

assert(variableWorldbook.includes('不看玩家性别、NPC 性别、同性/异性线路或 NSFW 开关'), '变量世界书应明确好感审计性别中性。');
assert(variableWorldbook.includes('男性 NPC 的感谢、信任、并肩作战、兑现承诺、主动袒露等正向证据'), '变量世界书应补充男性 NPC 正向好感同权重。');
assert(domainRules.includes('好感审计性别中立') && domainRules.includes('男性、女性、其他性别'), '领域事实规则应明确好感审计不受性别影响。');
assert(domainRules.includes('affinityDelta / affinitySet') || domainOutputFormat.includes('affinityDelta / affinitySet'), '领域事实协议应保留性别中性的好感字段审计。');
assert(domainRules.includes('同等互动强度') && domainRules.includes('门槛和权重'), '领域事实规则必须让各性别 NPC 的同等正向证据使用同等权重。');
assert(!builtinWorldbook.includes('女主规划'), '内置世界书不应再出现女主规划。');
assert(storyModeWorldbooks.includes('以事件驱动关系'), '故事模式规则必须以共同事件驱动关系变化。');
assert(storyModeWorldbooks.includes('不要凭空生出好感'), '故事模式规则必须禁止凭空生成好感。');

console.log('affinity-gender-neutral regression passed');
