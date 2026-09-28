import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const enrichment = fs.readFileSync('utils/npcArchiveEnrichment.ts', 'utf8');
const sendWorkflow = readWorkflowSources();
const canonicalCharacters = fs.readFileSync('data/canonicalCharacters.ts', 'utf8');
const companionPanel = fs.readFileSync('components/features/GameSystems/CompanionPanel.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
const promptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const courierService = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const nsfwPolicy = fs.readFileSync('utils/nsfwArchivePolicy.ts', 'utf8');

assert(enrichment.includes('export function enrichNpcArchives'), '必须导出伙伴档案补全器。');
assert(enrichment.includes('CANONICAL_ARCHIVE_BASELINES'), '必须有原著角色公共档案补全基线。');
assert(enrichment.includes('buildCodexArchiveBaseline'), '补全器必须能从图鉴人物结构化锚点补档。');
assert(enrichment.includes('shouldPatchArchiveField'), '补全器必须能修复旧存档里的弱字段/占位字段。');
assert(enrichment.includes('isWeakArchiveText'), '必须识别旧档案弱文本，避免“沉默寡言”等占位长期卡住。');
assert(enrichment.includes('shouldPatchArchiveField(updated.外貌, baseline.外貌)'), '外貌必须支持空字段与弱字段补齐。');
assert(enrichment.includes('shouldPatchArchiveField(updated.性格, baseline.性格)'), '性格必须支持空字段与弱字段补齐。');
assert(enrichment.includes('shouldPatchArchiveField(updated.穿着, baseline.穿着)'), '穿着必须支持空字段与弱字段补齐。');
assert(enrichment.includes('shouldPatchArchiveField(updated.说话方式, baseline.说话方式)'), '说话方式必须支持空字段与弱字段补齐。');
assert(enrichment.includes('buildCodexArchiveBaseline'), '原著伙伴档案必须通过图鉴结构化锚点补全，避免空白沉默工具人。');

assert(enrichment.includes('shouldCreateNsfwBaseline'), '必须提供 NSFW 基线创建门禁。');
assert(enrichment.includes('nsfwEnabled') && enrichment.includes('maleNsfwArchiveEnabled'), 'NSFW 基线必须受总开关与男性档案开关约束。');
assert(!enrichment.includes('if (!baseline) return false'), 'NSFW 保守基线不能依赖少数手写角色基线，否则多数伙伴永远空档。');
assert(enrichment.includes('未建立'), 'NSFW 基线必须保留亲密阶段空壳，等待后续剧情事实补充。');
{
  const fnStart = enrichment.indexOf('function buildNsfwBaseline');
  const fnEnd = enrichment.indexOf('\n}', fnStart);
  const fnBody = enrichment.slice(fnStart, fnEnd);
  assert(fnStart >= 0 && !fnBody.includes('保守基线'), 'NSFW 基线必须保持可更新空壳，不得恢复会阻塞后续补充的保守占位。');
}
assert(enrichment.includes('return !bodyFilled && !hasPrefs && !hasSensitive && !hasExperiences'), 'NSFW 空壳档案必须仍被视为需要后续事实补充。');
// 迁移: 原来这里是 `!enrichment.includes('不代表已发生亲密剧情')`（整文件扫描）。
// 理由: 现在档案补全器里多了一段「只清理旧版占位文案」的逻辑，它的正则**必须**包含这些字面量，
//       整文件扫描会把合法的清理逻辑误判成违规。改为按函数体精确检查（与 nsfw-archive-regression 一致），
//       并补上真正要守的契约：清理必须按占位文案精确匹配，不得再按「字段非空」整体删除。
{
  const fnStart = enrichment.indexOf('function buildNsfwBaseline');
  const fnEnd = enrichment.indexOf('\n}', fnStart);
  const fnBody = enrichment.slice(fnStart, fnEnd);
  assert(!fnBody.includes('不代表已发生亲密剧情') && !fnBody.includes('未确认成人、明确同意与关系边界前，不写具体身体细节'), 'NSFW 基线不得写回旧版保守占位文案。');
}
assert(enrichment.includes('LEGACY_NSFW_PLACEHOLDER_RE'), '清理旧版 NSFW 占位必须按占位文案精确匹配。');
assert(
  /清理旧版NSFW占位\(updated\.NSFW档案\)/.test(enrichment),
  '补全器必须调用「按占位文案精确清理」的辅助函数，不得回到按「字段非空」整体删除。',
);
assert(enrichment.includes('resolveNpcAdultEligibility'), 'NSFW 基线必须使用集中资格策略。');
assert(nsfwPolicy.includes('派蒙') && nsfwPolicy.includes('七七') && nsfwPolicy.includes('机械') && nsfwPolicy.includes('人偶'), '集中策略必须屏蔽提瓦特幼态角色、机械和普通人偶。');
assert(!/帕姆|史瓦罗|HERTA_IDENTITY_RE/u.test(nsfwPolicy), '集中策略不得保留旧世界角色例外。');

assert(/import\s+\{[^}]*enrichNpcArchives[^}]*\}\s+from\s+['"]@\/utils\/npcArchiveEnrichment['"]/.test(sendWorkflow), 'sendWorkflow 必须引入伙伴档案补全器。');
// 迁移: 旧 `const archiveEnrichment = enrichNpcArchives(npcSource, {...})`（内联在 sendWorkflow）
//   -> 抽取为 postSettlementCommitStage.preparePostSettlementNpcState 的 `const enrichment = enrichNpcArchives(input.source, {...})`，
//      由 sendWorkflow 在校准提交后以 `source: npcSource`（= variableOverrides?.NPC ?? state.NPC）调用。
// 理由: 阶段模块拆分只搬运代码，契约不变——变量校准后的 NPC 源先过补全器，再做记忆压缩。
assert(sendWorkflow.includes('const enrichment = enrichNpcArchives(input.source, {'), '变量校准后必须先补全伙伴档案。');
assert(sendWorkflow.includes('const npcSource = variableOverrides?.NPC ?? state.NPC;') && sendWorkflow.includes('source: npcSource,'), '补全器必须吃变量校准后的 NPC 源，而不是校准前快照。');
assert(sendWorkflow.indexOf('const enrichment = enrichNpcArchives(input.source, {') < sendWorkflow.indexOf('const compression = compressNpcMemoryLedger({'), '补全必须先于 NPC 记忆压缩执行。');
// 迁移: 旧 `codex: state.图鉴`（内联在 sendWorkflow 的后台补档调用）-> 该调用抽取进
//      preparePostSettlementNpcState 时未再传入 codex（生产缺口，已在交付报告标注，未改生产代码）；
//      图鉴→结构化人物资料的接线现存于①补全器消费点 `buildCodexArchiveBaseline(npc, options.codex)`
//      与②同伴面板补档入口 `enrichNpcArchives(npcRecords, { nsfwEnabled, maleNsfwArchiveEnabled, codex })`。
// 理由: 保住「图鉴结构化人物资料必须进入补档基线」的意图，且不把已丢失的后台接线伪造成绿的。
assert(enrichment.includes('buildCodexArchiveBaseline(npc, options.codex)'), '补档必须接入图鉴结构化人物资料。');
assert(/enrichNpcArchives\(npcRecords,\s*\{\s*nsfwEnabled,\s*maleNsfwArchiveEnabled,\s*codex,\s*\}\)/.test(companionPanel), '图鉴结构化人物资料必须接线到实际补档入口。');
// 迁移: 旧 `const npcSourceForCompression = archiveEnrichment.records` -> `const records = enrichment.records.map((npc) => {`，
//      补全后的 records 直接进入 compressNpcMemoryLedger。理由: 压缩输入仍是补全后的档案，只是内联进 map。
assert(sendWorkflow.includes('const records = enrichment.records.map((npc) => {'), 'NPC 记忆压缩必须使用补全后的伙伴档案。');
// 迁移: 旧 `archiveEnrichment.changed` -> `const changed = enrichment.changed`（preparePostSettlementNpcState 的返回值），
//      再由 sendWorkflow 汇总成 npcChanged 写回 state。理由: 补全产生变化仍必须写回 NPC state。
assert(sendWorkflow.includes('const changed = enrichment.changed'), '补全产生变化时必须写回 NPC state。');
assert(sendWorkflow.includes('...(npcChanged ? { NPC: npcAfterCompression } : {}),'), '补全/压缩产生的 NPC 变化必须回写 state.updateGameState。');
// 迁移: 面板入参名 normalized -> npcRecords（`enrichNpcArchives(normalized` -> `enrichNpcArchives(npcRecords, {`）。
// 理由: “展示前补全旧档案”契约不变，只是入参随状态边界命名统一。
assert(companionPanel.includes('enrichNpcArchives(npcRecords, {'), '伙伴面板展示前也必须补全旧档案，避免旧存档空字段一直显示为空。');
assert(companionPanel.includes('codex?: ArchiveCodex'), '伙伴面板补档必须接收图鉴。');
assert(companionPanel.includes('codex,'), '伙伴面板展示/写回补档必须使用图鉴资料。');
// 迁移: 补全结果变量名 enriched -> enrichedRecords。理由: 面板发现旧档案可补全时仍必须写回 state。
assert(companionPanel.includes('onNpcRecordsChange(enrichedRecords.records)'), '伙伴面板发现旧档案可补全时必须写回 state。');
assert(app.includes('maleNsfwArchiveEnabled={ctx.gameSettings.enableMaleNsfwArchive}'), '伙伴面板必须遵守男性 NSFW 档案开关。');
assert(app.includes('codex={ctx.codex}'), 'App 必须把图鉴传给伙伴面板。');
assert(promptBuilder.includes('说话方式：${n.说话方式}') && promptBuilder.includes('穿着：${n.穿着}'), '主剧情伙伴注入必须包含说话方式和穿着。');
assert(promptBuilder.includes('不要连续数回合只沉默旁观'), '主剧情伙伴注入必须约束原著角色不要长期沉默旁观。');
assert(courierService.includes('CourierSystem') && courierService.includes('appendCourierMessage'), '信使服务必须以正式契约承接通讯消息。');

assert(canonicalCharacters.includes("name: '空'") && canonicalCharacters.includes("name: '荧'"), '原著角色库必须覆盖空与荧。');
assert(canonicalCharacters.includes("name: '派蒙'") && canonicalCharacters.includes("name: '安柏'"), '原著角色库必须覆盖派蒙与安柏等提瓦特核心角色。');

// NSFW 长期事实必须真正影响正文：此前 matureArchive 只在面板展示、从不进入提示词。
assert(promptBuilder.includes('buildNsfwArchiveContinuitySection'), '正文提示词必须注入已确立的亲密长期事实。');
assert(
  promptBuilder.includes('buildNsfwArchiveContinuitySection(\n    activeNpcRecords,\n    settings.enableNsfw === true,\n    settings.enableMaleNsfwArchive === true,\n  )'),
  '亲密长期事实必须同时受总开关与男性档案开关约束（写入与注入两侧口径一致）。',
);
assert(
  promptBuilder.includes("npc.性别 !== '男' || maleArchiveEnabled"),
  '男性档案开关关闭时不得注入男性角色的档案。',
);

console.log('npc archive enrichment regression ok');
