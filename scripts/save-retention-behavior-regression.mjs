import assert from 'node:assert/strict';

import {
  MAX_AUTO_SAVE_ROUNDS_PER_TREE,
  MAX_MANUAL_SAVE_NODES_PER_TREE,
  selectSaveNodeRotationCandidates,
} from '../services/storage/saveRetention.ts';

function save(id, type, rootId, timestamp = id) {
  return {
    id,
    type,
    timestamp,
    turnCount: id,
    turnCountSource: 'explicit',
    saveTree: rootId ? { rootId, nodeId: `node-${id}`, createdAt: timestamp } : undefined,
  };
}

assert.equal(MAX_MANUAL_SAVE_NODES_PER_TREE, 5, '每棵树必须最多保留 5 个手动节点');
assert.equal(MAX_AUTO_SAVE_ROUNDS_PER_TREE, 10, '每棵树必须保留最新 10 个不同自动回合');

const unlimitedTrees = Array.from({ length: 20 }, (_, index) => save(index + 1, 'auto', `root-${index + 1}`));
assert.deepEqual(
  selectSaveNodeRotationCandidates(unlimitedTrees),
  [],
  '存档树数量必须无限，不能因为 rootId 数量增加而轮转整棵树',
);

const autoOverflow = Array.from({ length: 11 }, (_, index) => save(index + 1, 'auto', 'root-auto'));
assert.deepEqual(
  selectSaveNodeRotationCandidates(autoOverflow).map((item) => item.id),
  [1],
  '同一棵树写入第 11 个不同自动回合后必须只清理最旧回合',
);

const manualOverflow = Array.from({ length: 6 }, (_, index) => save(index + 11, 'manual', 'root-manual'));
assert.deepEqual(
  selectSaveNodeRotationCandidates(manualOverflow).map((item) => item.id),
  [11],
  '同一棵树写入第 6 个手动节点后必须只清理最旧手动节点',
);

const mixedTree = [
  ...Array.from({ length: 11 }, (_, index) => save(index + 21, 'auto', 'root-mixed')),
  ...Array.from({ length: 6 }, (_, index) => save(index + 41, 'manual', 'root-mixed')),
  save(50, 'imported', 'root-mixed'),
  save(51, 'backup', 'root-mixed'),
];
assert.deepEqual(
  selectSaveNodeRotationCandidates(mixedTree).map((item) => item.id).sort((left, right) => left - right),
  [21, 41],
  '同一棵树的手动和自动额度必须分别计算，导入与历史恢复点不占额度',
);

const independentTrees = [
  ...Array.from({ length: 11 }, (_, index) => save(index + 61, 'auto', 'root-a')),
  ...Array.from({ length: 11 }, (_, index) => save(index + 81, 'auto', 'root-b')),
];
assert.deepEqual(
  selectSaveNodeRotationCandidates(independentTrees).map((item) => item.id).sort((left, right) => left - right),
  [61, 81],
  '不同存档树必须独立轮转各自最旧节点',
);

const sameTimestamp = Array.from({ length: 11 }, (_, index) => save(index + 101, 'auto', 'root-tie', 1000));
assert.deepEqual(
  selectSaveNodeRotationCandidates(sameTimestamp).map((item) => item.id),
  [101],
  '时间相同时必须使用 ID 判断新旧并保留更大的新 ID',
);

const legacyNodes = [save(91, 'auto'), save(92, 'auto'), save(93, 'manual'), save(94, 'manual')];
assert.deepEqual(
  selectSaveNodeRotationCandidates(legacyNodes),
  [],
  '缺少 rootId 的旧节点必须各自隔离，不能猜测归属后跨节点清理',
);

const revisitedRound = { ...save(200, 'auto', 'root-auto', 1000), turnCount: 1 };
const sameRoundBranch = { ...save(201, 'auto', 'root-auto', 1001), turnCount: 11 };
assert.deepEqual(selectSaveNodeRotationCandidates([...autoOverflow, revisitedRound, sameRoundBranch]).map(item => item.id), [2], '重访旧分支必须按实际保存时间刷新回合；同回合的所有节点保留');
const unknownRounds = Array.from({ length: 20 }, (_, i) => ({ ...save(i + 300, 'auto', 'unknown-rounds'), turnCountSource: undefined }));
assert.deepEqual(selectSaveNodeRotationCandidates(unknownRounds), [], '无法证明来源的旧回合不能当同一回合 0 或按节点额度误删');

console.log('[save-retention-behavior-regression] ok');
