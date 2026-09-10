import fs from 'node:fs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const opening = fs.readFileSync('models/teyvat/opening.ts', 'utf8');
const presets = fs.readFileSync('data/journeyPresets.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const wizard = fs.readFileSync('components/features/NewGame/NewGameWizard.tsx', 'utf8');

assert(opening.includes('export interface 开局模板'), 'opening contract must define 开局模板.');
assert(opening.includes("source: 'official' | 'player'"), 'template must have source union.');
assert(opening.includes('元素?: ElementId | string'), 'template must carry element seed.');
assert(opening.includes('天赋?: Talent[]'), 'template must carry talents.');
assert(opening.includes('tags: string[]'), 'template must carry tags.');

assert(presets.includes('officialOpeningTemplates: 开局模板[]'), 'official templates must exist.');
assert(presets.includes('official_mondstadt_dragon'), 'official template id must be Teyvat-native.');
assert(presets.includes('export function 归一化开局模板'), 'normalize fn must exist.');
assert(presets.includes("from '@/models/teyvat/opening'"), 'type import must use Teyvat opening contract.');
assert(!presets.includes('命途:'), 'template data must not retain path fields.');

assert(settings.includes("openingTemplates?: import('@/models/teyvat/opening').开局模板[]"), 'settings must carry openingTemplates.');
assert(settings.includes('openingTemplates: [],'), 'default settings must init openingTemplates.');
assert(wizard.includes('OFFICIAL_OPENING_PRESETS'), 'wizard must render official opening presets.');
assert(wizard.includes('createTeyvatGameFromOpeningPreset'), 'wizard must construct opening through Teyvat factory.');

console.log('opening template library regression ok');
