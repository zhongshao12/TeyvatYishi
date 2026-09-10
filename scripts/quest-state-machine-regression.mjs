import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const questModel = fs.readFileSync('models/quest.ts', 'utf8');
const questService = fs.readFileSync('services/questService.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const questWorkflow = fs.readFileSync('hooks/useGame/questWorkflow.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/QuestPanel.tsx', 'utf8');
const gameMenu = fs.readFileSync('data/gameMenu.ts', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(questModel.includes("任务状态"), 'quest model must define quest states.');
assert(questModel.includes('归一化任务系统'), 'quest model must normalize task systems.');
assert(questService.includes('解析任务更新命令'), 'quest service must parse update commands.');
assert(questService.includes('结算任务进展'), 'quest service must settle progress.');
assert(questService.includes('完成任务并生成奖励命令'), 'quest service must award rewards.');
assert(questWorkflow.includes('deriveQuestSettlementPlan'), 'quest workflow must expose pure settlement command derivation.');
assert(panel.includes('QuestJournal') && panel.includes('abandonQuest'), 'quest panel must use the formal QuestJournal abandonment boundary.');
assert(panel.includes('quest.active') && panel.includes('quest.completed') && panel.includes('quest.abandoned'), 'quest panel must read formal quest journal fields.');
assert(app.includes('quest: state.game.任务') && app.includes('任务: updater(current.任务)'), 'App must connect the quest panel directly to formal Teyvat state.');
assert(!app.includes("import type { 任务系统 } from '@/models/quest'"), 'App must not depend on the Legacy quest model.');
assert(questService.includes('export function abandonQuest'), 'quest service must expose formal immutable abandonment.');
assert(questService.includes('export function 放弃任务'), 'quest service must export abandonment.');
assert(questWorkflow.includes('OPENING_MAIN_QUEST'), 'opening quest must be injected on first turn.');
assert(sendWorkflow.includes('composeQuestSettlementCommands'), 'send workflow must preview facts and derive quest commands before the root transaction.');
assert(questWorkflow.includes('commands: [...input.narrativeCommands, ...quest.commands]'), 'narrative and quest commands must share one immutable transaction batch.');
assert(sendWorkflow.includes("candidate.domain === 'quest'"), 'send workflow must read quest facts from NarrativeTurn.');
assert(!sendWorkflow.includes('runQuestSettlementStep'), 'live send must not invoke post-commit imperative quest settlement.');
for (const setter of ['set背包(', 'setNPC(', 'set任务(', 'set记忆(']) {
  assert(!questWorkflow.includes(setter), `quest workflow must not call fragmented ${setter} state writes.`);
}
assert(questWorkflow.includes('archiveCommittedQuestSettlement'), 'quest workflow must expose idempotent post-commit archive derivation.');
assert(sendWorkflow.includes('deriveCommittedQuestArchiveFacts'), 'live and recovery must derive quest archive facts from committed state.');
assert(panel.includes('进行中') && panel.includes('已放弃'), 'quest panel must show active and abandoned tabs.');
assert(gameMenu.includes("id: 'quest'"), 'game menu must expose quest entry.');
assert(app.includes('QuestPanel'), 'App must register QuestPanel.');
console.log('quest state machine regression ok');
