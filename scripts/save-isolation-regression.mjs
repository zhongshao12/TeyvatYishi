import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

const appSource = fs.readFileSync('App.tsx', 'utf8');
const saveLoadSource = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const codexPresetSource = fs.readFileSync('data/codexPreset.ts', 'utf8');
const savePackageSource = fs.readFileSync('services/savePackage.ts', 'utf8');
const dbServiceSource = fs.readFileSync('services/dbService.ts', 'utf8');
const useGameSource = fs.readFileSync('hooks/useGame.ts', 'utf8');
const sendWorkflowSource = readWorkflowSources();
const allSources = [
  appSource,
  saveLoadSource,
  useGameSource,
  sendWorkflowSource,
  fs.readFileSync('hooks/useGameState.ts', 'utf8'),
].join('\n');
const useGameStateSource = fs.readFileSync('hooks/useGameState.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(useGameStateSource.includes('useTeyvatRuntime()'), 'useGameState 必须委托唯一的 Teyvat 根状态 atom。');
assert(!/useState<[^>]*(?:角色数据结构|世界状态|记忆系统|忆庭系统|智库系统|手机系统|新闻条目)/.test(useGameStateSource), 'useGameState 不得继续声明领域 sidecar atom。');
assert(saveLoadSource.includes('classifyAndMigrateDbSaveRecord'), 'DB 读档必须先经过 compat raw-record 分类/迁移。');
assert(saveLoadSource.includes('dependencies.replaceGameState(nextGame)'), '成功读档必须只用事务依赖的 replaceGameState 提交完整 nextGame。');
assert(!/state\.set(?:旅人|世界|ChatHistory|记忆|忆庭|智库|手机|NPC|相册|新闻|剧情|剧情编织|VariableBatches|QueueTasks|任务|TurnCount)\(/.test(saveLoadSource), '读档不得顺序写入任何领域切片。');
assert(useGameSource.includes('updateGameState'), 'useGame 领域写入必须归约到 updateGameState。');
assert(appSource.includes('updateGameState'), 'App 新建游戏流程必须通过根状态更新提交。');
assert(saveLoadSource.includes('state.game'), '保存快照必须从当前 Teyvat 根状态构建。');
assert(saveLoadSource.includes('const legacyCompatible = applyLegacyGameStateOverrides(baseGame, legacyCompatibleOverrides);') && saveLoadSource.includes('const payload = normalizeTeyvatGameState({'), '保存快照必须在根状态上应用中立覆盖并完整归一化。');
assert((saveLoadSource.match(/dependencies\.replaceGameState\(nextGame\)/g) ?? []).length === 1, '成功读档必须且只能提交一次完整 nextGame。');
assert(saveLoadSource.indexOf('const nextGame = normalizeTeyvatGameState(classified.state)') < saveLoadSource.indexOf('dependencies.replaceGameState(nextGame)'), '读档必须在唯一提交前完成完整归一化。');
assert(saveLoadSource.indexOf('await dependencies.beforeReplace?.(nextGame)') < saveLoadSource.indexOf('dependencies.replaceGameState(nextGame)'), '所有可拒绝清理必须发生在唯一 replace 前。');
assert(dbServiceSource.includes("data.universe !== 'teyvat' || data.schemaVersion !== 2"), '数据库写入必须拒绝非 Teyvat schema-2 根快照。');
assert(dbServiceSource.includes('...normalizeTeyvatGameState(data)'), '数据库写入必须归一化 Teyvat schema-2 根快照。');
assert(dbServiceSource.includes('...data'), '数据库信封必须由当前 Teyvat 根快照构建。');

assert(!allSources.includes('phoneSystemState'), '手机运行时数据不得写入或读取全局 phoneSystemState，避免多存档聊天/通讯录互串。');
assert(!saveLoadSource.includes('mergePhoneSystems'), '读档不得把目标存档手机与外部手机状态合并。');
// 迁移: 旧 `onCourierChange={(手机) => state.updateGameState(...)}` -> 新 `onCourierChange={state.set手机}` /
//   `onCourierChange: (update) => state.set手机(update)`；
// 理由: 手机变更回调收敛为 useGameState 暴露的领域 setter，而 useGameState 的 set手机 内部依旧是
//   `updateGameState((current) => ({ ...current, 手机: applyStateAction(current.手机, action) }))` 写入 Teyvat 根。
// 意图不变——手机 UI 修改仍只进入当前正式运行态，不写全局 sidecar、不落到存档之外的状态。
const courierSetterWritesRuntimeRoot = useGameStateSource.includes(
  'updateGameState((current) => ({ ...current, 手机: applyStateAction(current.手机, action) }))',
);
assert(
  appSource.includes('onCourierChange={state.set手机}')
    && appSource.includes('onCourierChange: (update) => state.set手机(update)')
    && courierSetterWritesRuntimeRoot,
  '手机 UI 修改只能进入当前正式运行态。',
);

assert(!saveLoadSource.includes('state.setApiSettings(save.apiSettings)'), '读档不得用存档里的 apiSettings 覆盖本机 API 设置。');
assert(!saveLoadSource.includes('state.setCurrentTheme(save.theme)'), '读档不得用存档主题覆盖本机主题偏好。');
assert(!saveLoadSource.includes('state.setGameSettings('), '读档不得把持久化游戏配置写回本机设置。');
assert(!saveLoadSource.includes('state.setApiSettings('), '读档不得修改本机 API 设置。');
assert(savePackageSource.includes('const normalized = normalizeTeyvatGameState(source)'), '正式存档导出必须只保留归一化 Teyvat 根，排除本机 API 设置。');
assert(savePackageSource.includes('assertTeyvatSaveForWrite(save)'), '存档包导出必须拒绝旧宇宙写入。');

console.log('save isolation regression ok');
