import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'affinity-intimacy-nsfw-'));

async function resolveWorkspaceImport(specifier) {
  const base = path.join(root, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return base;
}

async function bundle(name, entry) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'workspace-alias',
      setup(build) {
        build.onResolve({ filter: /^@\// }, async (args) => ({ path: await resolveWorkspaceImport(args.path) }));
      },
    }],
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const [npc, facts, transaction, teyvatState, enrichment, policy] = await Promise.all([
  bundle('npc', 'models/npc.ts'),
  bundle('facts', 'utils/variableFacts.ts'),
  bundle('transaction', 'services/teyvatTurnTransaction.ts'),
  bundle('teyvat-state', 'models/teyvat/state.ts'),
  bundle('enrichment', 'utils/npcArchiveEnrichment.ts'),
  bundle('policy', 'utils/nsfwArchivePolicy.ts'),
]);

const boundaryCases = [
  [-50, '敌对'], [-31, '敌对'], [-30, '陌生'], [-1, '陌生'],
  [0, '初见'], [19, '初见'], [20, '熟识'], [49, '熟识'],
  [50, '知己'], [100, '知己'], [101, '生死挚友'], [150, '生死挚友'],
];
for (const [value, expected] of boundaryCases) {
  assert(npc.获取NPC关系阶段(value) === expected, `${value} 应派生为 ${expected}`);
}
assert(npc.限制NPC好感度(-999) === -50, '好感度下限必须是 -50。');
assert(npc.限制NPC好感度(999) === 150, '好感度上限必须是 150。');

const [migrated] = npc.归一化NPC记录列表([{
  id: 'npc_old', 姓名: '旧档角色', 阶位: 'companion', 好感度: 75,
  关系: 'acquaintance', 当前关系阶段: '点头之交', 同行: false,
  初见回合: 1, 最近回合: 5, 备注: [],
}]);
assert(migrated.关系 === 'friend', '旧 +75 档案的兼容关系必须迁移为 friend。');
assert(migrated.当前关系阶段 === '知己', '旧 +75 档案必须显示知己。');

const raw = `<变量事实>{"facts":[{"type":"npc","id":"npc_enemy","name":"测试角色","affinityDelta":30,"intimateRelationship":true,"memory":"双方明确确认恋爱关系。","evidence":"正文明确确认"}]}</变量事实>`;
const parsed = facts.parseVariableFacts(raw);
assert(parsed.parseErrors.length === 0 && parsed.facts[0]?.intimateRelationship === true, '变量事实必须解析亲密关系。');

const initialState = teyvatState.normalizeTeyvatGameState({
  ...teyvatState.createEmptyTeyvatGameState(),
  NPC: [{
    id: 'npc_enemy', 姓名: '测试角色', roleTier: 'companion', affinity: -50,
    relationship: 'enemy', intimate: false, travelingTogether: false,
    firstSeenTurn: 1, lastSeenTurn: 1,
  }],
});
const generated = facts.factsToTeyvatDomainCommands(parsed.facts, initialState, 2, { courierSeedsEnabled: false });
assert(generated.commands.some((command) => command.root === 'NPC' && command.path === '[id=npc_enemy].intimate' && command.value === true), '亲密关系事实必须生成正式领域命令。');
let committedState = null;
const committed = transaction.commitTeyvatTurn(initialState, generated.commands, (nextState) => {
  committedState = nextState;
}, {
  factCandidates: parsed.facts.map((fact) => ({ domain: 'npc', fact: fact.evidence, evidence: fact.evidence })),
});
assert(committed.status === 'committed' && committedState, '正式 transaction 必须提交 NPC 根。');
const [committedNpc] = committedState.NPC;
assert(committedNpc.affinity === -20, '敌对角色应能正常增加好感度。');
assert(committedNpc.relationshipLedger.currentStage === '陌生', '跨过敌对边界后必须自动进入陌生。');
assert(committedNpc.relationship === 'stranger', '兼容关系必须随好感阶段同步。');
assert(committedNpc.intimate === true, '亲密关系必须经过正式 transaction 落库。');
assert(npc.格式化NPC关系(committedNpc.affinity, committedNpc.intimate) === '陌生 · 亲密关系', '关系展示必须组合阶段与亲密状态。');

// 边界行为：好感度是长期累计值，越界必须夹取到 -50 / 150，而不是让命令报错被丢掉。
// 之前 `next > 150` 直接返回 INVALID_NUMERIC_RESULT，被 variableSettlementWorkflow 的
// excludeRejectedSettlementCommands 剔掉后玩家只会看到「一直在互动但好感度不动」。
const boundsState = teyvatState.normalizeTeyvatGameState({
  ...teyvatState.createEmptyTeyvatGameState(),
  NPC: [{
    id: 'npc_bounds', 姓名: '边界角色', roleTier: 'companion', affinity: 148,
    relationship: 'close', intimate: false, travelingTogether: false,
    firstSeenTurn: 1, lastSeenTurn: 1,
  }],
});
const evidence = '边界角色认可了旅行者的判断';
const boundsFact = { domain: 'relationship', fact: evidence, evidence };
const boundsCommit = (value) => {
  const result = transaction.commitTeyvatTurn(boundsState, [{
    action: 'add', root: 'NPC', path: '[id=npc_bounds].affinity', value, evidence,
  }], () => undefined, { factCandidates: [boundsFact] });
  assert(result.status === 'committed', `好感度边界命令必须提交而不是被拒绝（value=${value}）。`);
  return result.nextState.NPC[0].affinity;
};
assert(boundsCommit(5) === 150, '越过上限的好感增量必须夹取到 150。');
assert(boundsCommit(1.5) === 149, '好感度必须取整，与旧路径 限制NPC好感度 保持一致。');
// 下限夹具必须用「尚未到生死挚友」的角色：148 已经受生死挚友保护，任何下调都会被忽略。
const floorState = teyvatState.normalizeTeyvatGameState({
  ...teyvatState.createEmptyTeyvatGameState(),
  NPC: [{
    id: 'npc_bounds', 姓名: '边界角色', roleTier: 'companion', affinity: 20,
    relationship: 'acquaintance', intimate: false, travelingTogether: false,
    firstSeenTurn: 1, lastSeenTurn: 1,
  }],
});
const floorResult = transaction.commitTeyvatTurn(floorState, [{
  action: 'sub', root: 'NPC', path: '[id=npc_bounds].affinity', value: 999, evidence,
}], () => undefined, { factCandidates: [boundsFact] });
assert(floorResult.status === 'committed', '越好感度下限的扣减命令必须提交而不是被拒绝。');
assert(floorResult.nextState.NPC[0].affinity === -50, '越过下限的好感扣减必须夹取到 -50。');

// 生死挚友（> 100）后不再掉好感度：不是夹到门槛值，而是完全不掉。
const dearestState = teyvatState.normalizeTeyvatGameState({
  ...teyvatState.createEmptyTeyvatGameState(),
  NPC: [{
    id: 'npc_dearest', 姓名: '挚友角色', roleTier: 'companion', affinity: 130,
    relationship: 'close', intimate: false, travelingTogether: false,
    firstSeenTurn: 1, lastSeenTurn: 1,
  }],
});
const dearestEvidence = '挚友角色与旅行者之间发生了分歧';
const dearestRun = (action, value) => {
  const result = transaction.commitTeyvatTurn(dearestState, [{
    action, root: 'NPC', path: '[id=npc_dearest].affinity', value, evidence: dearestEvidence,
  }], () => undefined, { factCandidates: [{ domain: 'relationship', fact: dearestEvidence, evidence: dearestEvidence }] });
  assert(result.status === 'committed', `生死挚友的下调命令必须提交（而不是报错），action=${action}。`);
  return result.nextState.NPC[0].affinity;
};
assert(dearestRun('sub', 20) === 130, '生死挚友级别不得因为扣减而降低好感度。');
assert(dearestRun('set', 50) === 130, '生死挚友级别不得被绝对覆盖降低好感度。');
assert(dearestRun('add', 5) === 135, '生死挚友级别仍然可以继续增加好感度。');
assert(npc.获取NPC关系阶段(npc.NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD) === '知己', '门槛值本身仍是知己。');
assert(npc.获取NPC关系阶段(npc.NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD + 1) === '生死挚友', '门槛值 +1 起才是生死挚友。');

// 玩家指定的亲密事件固定好感度 + 每日同行 +10。
const intimacyState = teyvatState.normalizeTeyvatGameState({
  ...teyvatState.createEmptyTeyvatGameState(),
  NPC: [{
    id: 'npc_lover', 姓名: '恋人角色', roleTier: 'companion', affinity: 0,
    relationship: 'friend', intimate: false, travelingTogether: true,
    firstSeenTurn: 1, lastSeenTurn: 1,
  }],
});
const intimacyRun = (body, options = { nsfwEnabled: true }) => {
  const derived = facts.deriveNarrativeIntimacyFacts(body, intimacyState.NPC, options);
  const translated = facts.factsToTeyvatDomainCommands(derived, intimacyState, 3);
  const result = transaction.commitTeyvatTurn(intimacyState, translated.commands, () => undefined, { lenientEvidence: true });
  assert(result.status === 'committed', `亲密事件结算必须提交：${body}`);
  return result.nextState.NPC[0].affinity;
};
assert(intimacyRun('恋人角色轻轻亲吻了旅行者。') === 5, '亲吻必须是 +5。');
assert(intimacyRun('恋人角色与旅行者发生了性爱关系。') === 30, '性爱事件必须是 +30。');
assert(intimacyRun('恋人角色说出了近似表白的话。') === 3, '暧昧/谈情说爱必须是 +3。');
assert(intimacyRun('恋人角色牵起旅行者的手，一路没有松开。') === 3, '肢体接触必须是 +3。');
assert(intimacyRun('恋人角色紧紧拥抱旅行者，随后亲吻了对方。') === 5, '同回合只能按命中的最高档结算一次。');
assert(intimacyRun('恋人角色与旅行者发生了性爱关系。', { nsfwEnabled: false }) === 0, 'NSFW 关闭时不得结算性爱档。');
assert(facts.deriveNarrativeIntimacyFacts('可莉亲吻了旅行者。', [
  { id: 'npc_klee', 姓名: '可莉', aliases: [] },
], { nsfwEnabled: true }).length === 0, '受保护的非成年角色不得结算任何亲密档位。');

// 每日同行：跨过一个自然日固定 +10（与固定好感度规则同一条链路结算）。
const dailyTranslated = facts.factsToTeyvatDomainCommands([
  { type: 'time', mode: 'next_day', targetTime: '08:00', evidence: '第二天早晨，众人再次出发。' },
], intimacyState, 3);
const dailyResult = transaction.commitTeyvatTurn(intimacyState, dailyTranslated.commands, () => undefined, { lenientEvidence: true });
assert(dailyResult.status === 'committed', '跨日结算必须提交。');
assert(dailyResult.nextState.NPC[0].affinity === 10, '每日同行每过一天必须是 +10。');

const canonicalAliasRecords = npc.归一化NPC记录列表([
  { id: 'raiden-a', 姓名: '雷电将军', 阶位: 'companion', 好感度: 20, 关系: 'acquaintance', 同行: false, 初见回合: 1, 最近回合: 2, 备注: [] },
  { id: 'raiden-b', 姓名: 'Raiden Shogun', 阶位: 'companion', 好感度: 50, 关系: 'friend', 同行: false, 初见回合: 1, 最近回合: 3, 备注: [] },
]);
assert(canonicalAliasRecords.length === 1 && canonicalAliasRecords[0].姓名 === '雷电将军', '提瓦特原著角色与英文别名必须合并为同一身份。');
const adultCanonicalRecords = npc.归一化NPC记录列表([
  { id: 'raiden-a', 姓名: '雷电将军', 阶位: 'companion', 好感度: 20, 关系: 'acquaintance', 同行: false, 初见回合: 1, 最近回合: 2, 备注: [] },
]);
assert(policy.getNsfwArchiveBlockReason(adultCanonicalRecords[0], 'Raiden Shogun') === null, '未命中屏蔽条件的成年提瓦特角色不得被误拦截。');
assert(policy.getNsfwArchiveBlockReason(undefined, '普通人偶', '机械投影') !== null, '机械或人偶对象仍必须被拦截。');
assert(policy.getNsfwArchiveBlockReason({ 姓名: '可莉' }, 'Klee') !== null, '非成人原著角色必须被拦截。');

const customNpc = {
  id: 'npc_custom', 姓名: '原创伙伴', 阶位: 'companion', 好感度: 20,
  关系: 'acquaintance', 亲密关系: true, 同行: false, 初见回合: 1, 最近回合: 3,
  性别: '女', 备注: [],
};
const enabled = enrichment.enrichNpcArchives([customNpc], { nsfwEnabled: true, maleNsfwArchiveEnabled: false });
assert(enabled.records[0].NSFW档案?.enabled === true, '非智库重要 NPC 在 NSFW 开启时必须获得档案基线。');
assert(enabled.records[0].NSFW档案?.亲密阶段.includes('已建立亲密关系'), '基线必须承接普通亲密关系状态。');
const disabled = enrichment.enrichNpcArchives([{ ...customNpc, NSFW档案: { enabled: true, 经历: ['保留数据'] } }], { nsfwEnabled: false, maleNsfwArchiveEnabled: false });
assert(disabled.records[0].NSFW档案?.经历?.[0] === '保留数据', 'NSFW 关闭时必须保留已有档案数据。');

const [adultCanonicalEnriched] = enrichment.enrichNpcArchives(adultCanonicalRecords, { nsfwEnabled: true, maleNsfwArchiveEnabled: false }).records;
assert(adultCanonicalEnriched.NSFW档案?.enabled === true, '未命中屏蔽条件的成年提瓦特角色必须能建立 NSFW 档案基线。');

await fs.rm(outDir, { recursive: true, force: true });
console.log('affinity intimacy nsfw regression ok');
