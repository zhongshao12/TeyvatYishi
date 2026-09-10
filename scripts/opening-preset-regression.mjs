import fs from 'node:fs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const opening = fs.readFileSync('models/teyvat/opening.ts', 'utf8');
const factory = fs.readFileSync('services/teyvatOpeningFactory.ts', 'utf8');
const wizard = fs.readFileSync('components/features/NewGame/NewGameWizard.tsx', 'utf8');
const presets = fs.readFileSync('data/journeyPresets.ts', 'utf8');
const promptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');

for (const id of [
  'official_mondstadt_dragon', 'official_liyue_ritual', 'official_inazuma_decree',
  'official_sumeru_dream', 'official_fontaine_prophecy', 'official_natlan_war',
]) assert(opening.includes(id), `missing official opening preset ${id}`);

assert(opening.includes('OFFICIAL_OPENING_PRESETS'), 'formal opening module must own six presets.');
assert(factory.includes('createEmptyTeyvatGameState') && factory.includes('normalizeTeyvatGameState'), 'factory must build and normalize formal state.');
assert(factory.includes("throw new Error('UNKNOWN_OPENING_PRESET')"), 'factory must reject unknown presets.');
assert(wizard.includes('createTeyvatGameFromOpeningPreset(effectivePresetId)'), 'wizard payload builder must consume the effective formal opening preset (canonical travelers force Mondstadt).');
assert(wizard.includes('world.当前地区 = openingGame.世界.当前地区'), 'wizard payload must bridge the formal region.');
assert(wizard.includes("const [identity, setIdentity] = useState('')"), 'empty identity must allow the preset seed to apply.');
assert(wizard.includes('ELEMENT_IDS.map') && wizard.includes('空与荧并存'), 'wizard must offer seven elements and dual canonical travelers.');
assert(presets.includes("from '@/models/teyvat/opening'"), 'compat data module must use neutral opening contract.');
assert(!presets.includes('export const paths') && !presets.includes('命途:'), 'preset data must not retain path semantics.');
assert(promptBuilder.includes("import type { 开局来源 } from '@/models/teyvat/opening';"), 'prompt boundary must use formal opening source.');

console.log('opening preset regression ok');
