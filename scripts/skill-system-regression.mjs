import fs from 'node:fs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const character = fs.readFileSync('models/teyvat/character.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/SkillPanel.tsx', 'utf8');
const promptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const generator = fs.readFileSync('services/ai/skillGenerator.ts', 'utf8');

assert(!fs.existsSync('models/skill.ts'), 'legacy skill model must be removed.');
assert(character.includes("export type TalentCategory = 'normal_attack' | 'elemental_skill' | 'elemental_burst' | 'passive'"), 'Talent categories must be canonical.');
assert(character.includes("关联元素: ElementId | ''"), 'Talent must use validated element linkage.');
assert(panel.includes('traveler.天赋') && panel.includes('关联元素: element'), 'Talent panel must read/write formal talent fields.');
assert(panel.includes('unlockedElements.map'), 'Talent panel must only offer elements the Traveler has actually unlocked.');
assert(!panel.includes('战技列表') && !panel.includes('关联命途'), 'Talent panel must not retain legacy skill/path fields.');
assert(promptBuilder.includes('function buildSkillSection') && promptBuilder.includes('traveler.天赋'), 'Main prompt must inject traveler talents.');
assert(generator.includes('generateTalentDraft') && generator.includes('不要输出数值伤害、冷却、槽位或与提瓦特无关的力量体系'), 'AI helper must generate Teyvat-native talents.');

console.log('skill system regression ok');
