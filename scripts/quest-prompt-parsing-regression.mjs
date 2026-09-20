import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const questNarrative = fs.readFileSync('prompts/subsystems/questPrompt.ts', 'utf8');
const questFactFormat = fs.readFileSync('prompts/subsystems/questFactFormat.ts', 'utf8');
const questWorldbook = fs.readFileSync('data/questWorldbook.ts', 'utf8');
const questService = fs.readFileSync('services/questService.ts', 'utf8');
const systemPromptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const builtinModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');
const parser = fs.readFileSync('services/ai/responseParser.ts', 'utf8');
const narrativeModel = fs.readFileSync('models/teyvat/narrativeTurn.ts', 'utf8');
// 迁移: 主剧情工作流读取改走 readWorkflowSources()（WORKFLOW_FILES 登记文件的拼接视图）。
// 理由: 这些断言保护的是行为，不是文件位置；阶段模块拆分后代码一搬走就不再假红。
// 注: systemPromptBuilder 仍按单文件读取，保持「任务注入就在该模块内」的精度。
const sendWorkflow = readWorkflowSources();
assert(questNarrative.includes('NarrativeTurn') && questNarrative.includes('factCandidates'), 'quest narrative rules must keep updates inside NarrativeTurn fact candidates.');
assert(questNarrative.includes('evidence') && questNarrative.includes('body.text'), 'quest candidates must require body evidence.');
assert(questFactFormat.includes('接取:') && questFactFormat.includes('完成:'), 'quest fact format must define accept/complete facts.');
assert(questFactFormat.includes('进展:') && questFactFormat.includes('放弃:'), 'quest fact format must define progress/abandon facts.');
assert(questWorldbook.includes('QUEST_WORLD_BOOK_PROMPT'), 'quest worldbook must be exported.');
assert(questService.includes('解析任务更新命令'), 'quest service must parse update commands.');
assert(systemPromptBuilder.includes('buildQuestSection'), 'system prompt builder must inject quest section.');
assert(systemPromptBuilder.includes('settings.任务系统?.enabled'), 'quest injection must respect the enabled toggle.');
assert(builtinModules.includes('builtin_quest_narrative_rules') && builtinModules.includes('builtin_quest_fact_format') && builtinModules.includes('builtin_quest_worldbook'), 'native quest prompt modules must be registered.');
assert(!builtinModules.includes("id: 'builtin_quest_cot'") && !builtinModules.includes("id: 'builtin_quest_output_format'"), 'retired quest IDs must not be registered or emitted.');
assert(!fs.existsSync('prompts/cot/questCot.ts') && !fs.existsSync('prompts/cot/questOutputFormat.ts'), 'retired quest prompt entry files must be deleted.');
assert(questWorldbook.includes('domain 固定为 "quest"') && questWorldbook.includes('evidence'), 'quest worldbook must describe evidenced quest fact candidates.');
assert(!questWorldbook.includes('<任务更新>'), 'quest worldbook must not add a tagged sidecar outside NarrativeTurn.');
assert(narrativeModel.includes("'quest'"), 'formal fact candidates must whitelist the quest domain.');
assert(sendWorkflow.includes("candidate.domain === 'quest'"), 'quest settlement must consume formal quest fact candidates.');
assert(parser.includes('parseStoredLegacyResponse'), 'old tagged quest history may only pass through explicit stored compatibility.');
console.log('quest prompt parsing regression ok');
