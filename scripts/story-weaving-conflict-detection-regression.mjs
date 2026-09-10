import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const conflictService = fs.readFileSync('services/storyWeavingConflict.ts', 'utf8');
const conflictModel = fs.readFileSync('models/storyWeavingConflict.ts', 'utf8');
const plotPanel = fs.readFileSync('components/features/GameSystems/PlotPanel.tsx', 'utf8');
const canonPrompt = fs.readFileSync('prompts/subsystems/canonPrompt.ts', 'utf8');
const storyWeavingService = fs.readFileSync('services/storyWeaving.ts', 'utf8');
assert(conflictModel.includes('剧情编织冲突'), 'conflict model must exist.');
assert(conflictService.includes('生成冲突报告'), 'conflict service must expose a report generator.');
assert(conflictService.includes('multiple_active_segments'), 'conflict service must detect multiple active segments.');
assert(conflictService.includes('应用冲突修复'), 'conflict service must apply one-click fixes.');
assert(plotPanel.includes('生成冲突报告'), 'PlotPanel must render conflicts from the service.');
assert(plotPanel.includes('conflict') && plotPanel.includes('一键修复'), 'PlotPanel must offer conflict tab with one-click fix.');
assert(canonPrompt.includes('CANON_CONFLICT_RULES'), 'canon decomposition prompt must include conflict rules.');
assert(storyWeavingService.includes('CANON_CONFLICT_RULES'), 'story weaving system prompt must include canon conflict rules.');
