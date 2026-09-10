import fs from 'node:fs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const opening = fs.readFileSync('models/teyvat/opening.ts', 'utf8');
const world = fs.readFileSync('models/world.ts', 'utf8');
const wizard = fs.readFileSync('components/features/NewGame/NewGameWizard.tsx', 'utf8');
const openingPrompt = fs.readFileSync('prompts/narrative/openingPrompt.ts', 'utf8');
const builtinModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');

assert(!fs.existsSync('models/journey.ts'), 'legacy journey model must be removed.');
assert(opening.includes('recommendedEntryAngles') && opening.includes('openingPressure'), 'opening contract must preserve flexible story anchors.');
assert(world.includes("原著主角?: '荧' | '空' | '空荧双主角'"), 'world must preserve canonical traveler selection.');
assert(wizard.includes("setCanonicalTraveler") && wizard.includes("'空荧双主角'"), 'wizard must preserve Aether/Lumine coexistence.');
assert(wizard.includes('不锁定剧情路线'), 'wizard must state that presets do not force one route.');
assert(openingPrompt.includes('地区、具体地点、玩家身份种子') && openingPrompt.includes('当前压力'), 'native opening must consume the selected location, identity seed, and current pressure.');
assert(openingPrompt.includes('自定义旅行者') && openingPrompt.includes('空、荧'), 'native opening must preserve the custom traveler alongside Aether and Lumine.');
assert(openingPrompt.includes('CanonDeviation 高于原著锚点'), 'native opening must prioritize established canon deviations.');
assert(openingPrompt.includes('可立即行动的钩子') && openingPrompt.includes('choices'), 'native opening must end on an actionable hook with useful choices only.');
assert(builtinModules.includes("id: 'builtin_narrative_opening'") && builtinModules.includes("id: 'builtin_narrative_opening_preset'") && builtinModules.includes("id: 'builtin_narrative_opening_free'"), 'all native opening modules must be registered.');
assert(!fs.existsSync('prompts/cot/openingCot.ts'), 'retired opening CoT entry must be deleted.');

console.log('opening story alignment regression ok');
