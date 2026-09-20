import type { SaveUniverse, 存档数据 } from '@/models/settings';
import {
  fingerprintCloudBackupNode,
  type CloudBackupMergeResult,
  type CloudBackupNodeMeta,
  type CloudBackupPointerV2,
} from '@/services/cloudBackupPackage';
import {
  buildCloudBackupNodePlan,
  cloudBackupNodeIdentity,
  type CloudBackupNodePlan,
  type CloudBackupNodePlanInput,
} from '@/services/cloudBackupMergePlan';
import { CloudBackupWorkerClient } from '@/services/cloudBackupWorkerClient';
import {
  clearCloudMergeStaging,
  commitCloudMergeStaging,
  deleteCloudMergeStagedRecord,
  getSaveCatalogSnapshot,
  loadCloudMergeStagedRecord,
  loadSaveForCloudTransfer,
  stageCloudMergeRecord,
} from '@/services/dbService';
import { sanitizeTeyvatSaveForExport } from '@/services/savePackage';
import { deleteCloudBackupTransfer, getCloudBackupTransferPart } from '@/services/storage/cloudBackupTransferStore';
import {
  stripSaveAssetPayloadForStorage,
  type SaveAssetRecord,
} from '@/utils/saveAssetStorage';
import { dataUrlToBlob } from '@/utils/albumObjectUrl';

export interface CloudBackupMergeProgress {
  phase: 'analyzing-local' | 'reading-legacy' | 'planning' | 'unpacking-part' | 'staging-node' | 'committing' | 'completed';
  current: number;
  total: number;
  label: string;
}

export interface CloudBackupMergeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: CloudBackupMergeProgress) => void;
}

export { buildCloudBackupNodePlan } from '@/services/cloudBackupMergePlan';

export interface LegacyCloudBackupItem {
  cloudId: string;
  localSaveId?: number;
  saveType?: string;
  timestamp: number;
}

interface LocalMergeIndex extends CloudBackupNodePlanInput {
  universe?: SaveUniverse;
  schemaVersion?: number;
  usedAssetIds: Set<string>;
  assetIdToHash: Map<string, string>;
  assetHashToId: Map<string, string>;
}

interface AssetMergePlan {
  originalIdToTargetId: Map<string, string>;
  originalIdToHash: Map<string, string>;
  targetIdByHash: Map<string, string>;
  newHashes: Set<string>;
  reusedHashes: Set<string>;
}

export async function mergeDownloadedCloudBackup(
  transferId: string,
  pointer: CloudBackupPointerV2,
  options: CloudBackupMergeOptions = {},
): Promise<CloudBackupMergeResult> {
  assertNotAborted(options.signal);
  const incomingVersion = assertCloudBackupNodeVersions(pointer.nodes);
  const localPreflight = await preflightLocalMergeTarget();
  assertMergeTargetVersion(incomingVersion, localPreflight.version ?? {});
  const worker = new CloudBackupWorkerClient();
  const stageTransferId = `merge-${transferId}`;
  try {
    await clearCloudMergeStaging(stageTransferId).catch(() => {});
    const local = await buildLocalMergeIndex(worker, options, localPreflight);
    assertNotAborted(options.signal);
    options.onProgress?.({ phase: 'planning', current: 0, total: 1, label: '正在分析重复节点和冲突树' });
    const nodePlan = buildCloudBackupNodePlan(pointer.nodes, local);
    const assetPlan = buildAssetMergePlan(pointer, local);
    const expectedNodes = new Map(pointer.nodes.map((node) => [node.entryPath, node]));
    if (expectedNodes.size !== pointer.nodes.length) throw new Error('云备份包含重复的节点条目路径。');
    const assetsByHash = groupAssetsByHash(pointer);
    const processedNodes = new Set<string>();
    const processedAssets = new Set<string>();
    const usedOriginalAssetIds = new Set<string>();
    let stagedNodes = 0;

    for (let partPosition = 0; partPosition < pointer.parts.length; partPosition += 1) {
      assertNotAborted(options.signal);
      const part = pointer.parts[partPosition];
      if (!part) throw new Error(`云备份分卷清单第 ${partPosition + 1} 项无效。`);
      options.onProgress?.({
        phase: 'unpacking-part',
        current: partPosition,
        total: pointer.parts.length,
        label: `正在解析分卷 ${partPosition + 1}/${pointer.parts.length}`,
      });
      const stored = await getCloudBackupTransferPart(transferId, part.index);
      if (!stored) throw new Error(`已下载分卷 ${partPosition + 1}/${pointer.parts.length} 不存在，本地存档没有改变。`);
      const bytes = new Uint8Array(await stored.blob.arrayBuffer());
      const entries = await worker.unpack(bytes, part.compression, options.signal);

      for (const [contentHash, aliases] of assetsByHash) {
        const primary = aliases[0];
        if (!primary) throw new Error(`云备份资源 ${contentHash} 缺少主记录。`);
        if (primary.partIndex !== part.index || processedAssets.has(contentHash)) continue;
        const assetBytes = entries.get(primary.entryPath);
        if (!assetBytes) throw new Error(`云备份分卷缺少资源条目：${primary.entryPath}`);
        if (await worker.hash(assetBytes, options.signal) !== contentHash) {
          throw new Error(`云备份资源内容校验失败：${primary.originalId}`);
        }
        processedAssets.add(contentHash);
        if (assetPlan.newHashes.has(contentHash)) {
          const targetId = assetPlan.targetIdByHash.get(contentHash);
          if (!targetId) throw new Error(`云备份资源 ${primary.originalId} 缺少本地映射。`);
          const record: SaveAssetRecord = {
            id: targetId,
            blob: new Blob([Uint8Array.from(assetBytes)], { type: primary.mimeType || 'application/octet-stream' }),
            mimeType: primary.mimeType || 'application/octet-stream',
            size: assetBytes.byteLength,
            updatedAt: Date.now(),
          };
          await stageCloudMergeRecord(stageTransferId, assetStageKey(contentHash), {
            kind: 'asset',
            createdAt: Date.now(),
            record,
          });
        }
      }

      for (const meta of pointer.nodes) {
        if (meta.partIndex !== part.index || processedNodes.has(meta.entryPath)) continue;
        const nodeBytes = entries.get(meta.entryPath);
        if (!nodeBytes) throw new Error(`云备份分卷缺少节点条目：${meta.entryPath}`);
        let save: 存档数据;
        try {
          save = JSON.parse(new TextDecoder().decode(nodeBytes)) as 存档数据;
        } catch {
          throw new Error(`云备份节点 JSON 无法解析：${meta.entryPath}`);
        }
        validateCloudSaveNode(save, meta);
        const actualFingerprint = await fingerprintCloudBackupNode(save);
        if (actualFingerprint !== meta.fingerprint) throw new Error(`云备份节点内容校验失败：${meta.entryPath}`);
        processedNodes.add(meta.entryPath);
        if (nodePlan.skippedEntryPaths.has(meta.entryPath)) continue;

        collectAssetReferences(save, usedOriginalAssetIds);
        const remapped = remapCloudSaveNode(save, meta, nodePlan, assetPlan.originalIdToTargetId);
        options.onProgress?.({
          phase: 'staging-node',
          current: stagedNodes,
          total: pointer.nodeCount - nodePlan.skippedEntryPaths.size,
          label: `正在暂存云端节点 ${stagedNodes + 1}/${pointer.nodeCount - nodePlan.skippedEntryPaths.size}`,
        });
        await stageCloudMergeRecord(stageTransferId, nodeStageKey(stagedNodes), {
          kind: 'node',
          createdAt: Date.now(),
          save: remapped,
        });
        stagedNodes += 1;
      }

      options.onProgress?.({
        phase: 'unpacking-part',
        current: partPosition + 1,
        total: pointer.parts.length,
        label: `已解析分卷 ${partPosition + 1}/${pointer.parts.length}`,
      });
      await yieldToMainThread();
    }

    if (processedNodes.size !== pointer.nodes.length) throw new Error('云备份并未包含清单声明的全部节点。');
    if (processedAssets.size !== assetsByHash.size) throw new Error('云备份并未包含清单声明的全部资源。');

    const usedHashes = new Set(Array.from(usedOriginalAssetIds, (id) => assetPlan.originalIdToHash.get(id)).filter(Boolean) as string[]);
    for (const contentHash of assetPlan.newHashes) {
      if (!usedHashes.has(contentHash)) {
        await deleteCloudMergeStagedRecord(stageTransferId, assetStageKey(contentHash));
      }
    }

    options.onProgress?.({
      phase: 'committing',
      current: stagedNodes,
      total: stagedNodes,
      label: '正在原子合并到本地存档',
    });
    const committed = await commitCloudMergeStaging(stageTransferId);
    if (committed.saveIds.length !== stagedNodes) {
      throw new Error('云备份合并提交的节点数量不一致。');
    }
    const result: CloudBackupMergeResult = {
      addedNodes: committed.saveIds.length,
      skippedDuplicateNodes: nodePlan.skippedEntryPaths.size,
      remappedConflictTrees: nodePlan.conflictRoots.size,
      addedAssets: Array.from(assetPlan.newHashes).filter((hash) => usedHashes.has(hash)).length,
      reusedAssets: Array.from(assetPlan.reusedHashes).filter((hash) => usedHashes.has(hash)).length,
    };
    await deleteCloudBackupTransfer(transferId).catch(() => {});
    options.onProgress?.({ phase: 'completed', current: stagedNodes, total: stagedNodes, label: '云备份合并完成' });
    return result;
  } catch (error) {
    await clearCloudMergeStaging(stageTransferId).catch(() => {});
    await deleteCloudBackupTransfer(transferId).catch(() => {});
    throw error;
  } finally {
    worker.dispose('云备份合并任务已结束。');
  }
}

export async function mergeLegacyCloudBackup(
  items: LegacyCloudBackupItem[],
  loadCloudSave: (item: LegacyCloudBackupItem, index: number, signal?: AbortSignal) => Promise<存档数据>,
  options: CloudBackupMergeOptions = {},
): Promise<CloudBackupMergeResult> {
  void items;
  void loadCloudSave;
  void options;
  throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
}
async function buildLocalMergeIndex(
  worker: CloudBackupWorkerClient,
  options: CloudBackupMergeOptions,
  preflight: Awaited<ReturnType<typeof preflightLocalMergeTarget>>,
): Promise<LocalMergeIndex> {
  const summaries = [...preflight.snapshot.items, ...preflight.snapshot.legacyBackups]
    .sort((left, right) => left.timestamp - right.timestamp || left.id - right.id);
  const fingerprints = new Set<string>();
  const nodeFingerprints = new Map<string, string>();
  const usedAssetIds = new Set<string>();
  const assetIdToHash = new Map<string, string>();
  const assetHashToId = new Map<string, string>();

  for (let index = 0; index < summaries.length; index += 1) {
    assertNotAborted(options.signal);
    const summary = summaries[index];
    if (!summary) throw new Error(`本地存档目录第 ${index + 1} 项无效。`);
    options.onProgress?.({
      phase: 'analyzing-local',
      current: index,
      total: summaries.length,
      label: `正在分析本地节点 ${index + 1}/${summaries.length}`,
    });
    const bundle = await loadSaveForCloudTransfer(summary.id);
    if (!bundle) throw new Error(`读取本地存档 #${summary.id} 失败，合并尚未开始。`);
    const save = bundle.save;
    const runtimeFingerprint = readCloudOriginFingerprint(save);
    if (runtimeFingerprint) fingerprints.add(runtimeFingerprint);
    const portable = sanitizeTeyvatSaveForExport(
      stripSaveAssetPayloadForStorage(save) as unknown as import('@/models/teyvat').TeyvatSaveData,
    ) as unknown as 存档数据;
    const fingerprint = await fingerprintCloudBackupNode(portable);
    fingerprints.add(fingerprint);
    const tree = getSaveTree(save);
    if (tree?.rootId && tree.nodeId) nodeFingerprints.set(cloudBackupNodeIdentity(tree.rootId, tree.nodeId), fingerprint);

    for (const asset of save.相册?.assets ?? []) {
      if (asset.id) usedAssetIds.add(asset.id);
    }
    for (const rawRecord of bundle.assetRecords) {
      if (!rawRecord.id || assetIdToHash.has(rawRecord.id)) continue;
      const blob = resolveRecordBlob(rawRecord);
      if (!blob) continue;
      const hash = await worker.hash(new Uint8Array(await blob.arrayBuffer()), options.signal);
      assetIdToHash.set(rawRecord.id, hash);
      if (!assetHashToId.has(hash)) assetHashToId.set(hash, rawRecord.id);
    }
    options.onProgress?.({
      phase: 'analyzing-local',
      current: index + 1,
      total: summaries.length,
      label: `已分析本地节点 ${index + 1}/${summaries.length}`,
    });
    await yieldToMainThread();
  }
  return {
    ...preflight.version,
    fingerprints,
    nodeFingerprints,
    usedAssetIds,
    assetIdToHash,
    assetHashToId,
  };
}

async function preflightLocalMergeTarget(): Promise<{
  snapshot: Awaited<ReturnType<typeof getSaveCatalogSnapshot>>;
  version?: { universe: SaveUniverse; schemaVersion: number };
}> {
  const snapshot = await getSaveCatalogSnapshot();
  if (!snapshot.catalogComplete) {
    throw new Error(`本地存档目录尚未完整：待恢复 ${snapshot.pendingIds.length}，不可读 ${snapshot.unreadableIds.length}。请先修复存档索引。`);
  }
  const summaries = [...snapshot.items, ...snapshot.legacyBackups];
  return {
    snapshot,
    ...(summaries.length ? { version: assertCatalogSummaryVersions(summaries) } : {}),
  };
}

function buildAssetMergePlan(pointer: CloudBackupPointerV2, local: LocalMergeIndex): AssetMergePlan {
  const originalIdToTargetId = new Map<string, string>();
  const originalIdToHash = new Map<string, string>();
  const targetIdByHash = new Map<string, string>();
  const newHashes = new Set<string>();
  const reusedHashes = new Set<string>();
  const usedIds = new Set(local.usedAssetIds);
  const groups = groupAssetsByHash(pointer);

  for (const [hash, aliases] of groups) {
    let targetId = local.assetHashToId.get(hash);
    if (targetId) {
      reusedHashes.add(hash);
    } else {
      targetId = aliases.map((asset) => asset.originalId).find((id) => id && !usedIds.has(id));
      if (!targetId) targetId = nextAvailableAssetId(usedIds);
      usedIds.add(targetId);
      newHashes.add(hash);
    }
    targetIdByHash.set(hash, targetId);
    for (const alias of aliases) {
      const previousHash = originalIdToHash.get(alias.originalId);
      if (previousHash && previousHash !== hash) throw new Error(`云备份资源 ID 指向了不同内容：${alias.originalId}`);
      originalIdToHash.set(alias.originalId, hash);
      originalIdToTargetId.set(alias.originalId, targetId);
    }
  }
  return { originalIdToTargetId, originalIdToHash, targetIdByHash, newHashes, reusedHashes };
}

function groupAssetsByHash(pointer: CloudBackupPointerV2): Map<string, CloudBackupPointerV2['assets']> {
  const groups = new Map<string, CloudBackupPointerV2['assets']>();
  for (const asset of pointer.assets) {
    const group = groups.get(asset.contentHash) ?? [];
    group.push(asset);
    groups.set(asset.contentHash, group);
  }
  return groups;
}

function remapCloudSaveNode(
  source: 存档数据,
  meta: CloudBackupNodeMeta,
  plan: CloudBackupNodePlan,
  assetIdMap: Map<string, string>,
): 存档数据 {
  const rewritten = rewriteAssetReferences(source, assetIdMap) as 存档数据;
  const sourceTree = getSaveTree(rewritten);
  let saveTree: Record<string, unknown>;
  if (!meta.rootId || !meta.nodeId || !sourceTree) {
    saveTree = {
      ...(sourceTree ?? {}),
      rootId: createMergeId('save_root_cloud'),
      nodeId: createMergeId('save_node_cloud'),
      parentNodeId: undefined,
      branchName: sourceTree?.branchName ?? '云端导入节点',
      createdAt: sourceTree?.createdAt || meta.timestamp || Date.now(),
    };
  } else if (plan.conflictRoots.has(meta.rootId)) {
    saveTree = {
      ...sourceTree,
      rootId: plan.rootIdMap.get(meta.rootId) ?? createMergeId('save_root_cloud'),
      nodeId: plan.nodeIdMap.get(cloudBackupNodeIdentity(meta.rootId, meta.nodeId)) ?? createMergeId('save_node_cloud'),
      parentNodeId: meta.parentNodeId
        ? plan.nodeIdMap.get(cloudBackupNodeIdentity(meta.rootId, meta.parentNodeId))
        : undefined,
      branchName: sourceTree.branchName ?? '云端冲突副本',
    };
  } else {
    saveTree = {
      ...sourceTree,
      rootId: meta.rootId,
      nodeId: meta.nodeId,
      parentNodeId: meta.parentNodeId,
    };
  }
  const runtime = readSaveRuntime(rewritten);
  return {
    ...rewritten,
    id: 0,
    type: normalizeSaveType(meta.type || rewritten.type),
    timestamp: meta.timestamp || rewritten.timestamp || Date.now(),
    saveTree,
    saveRuntime: {
      ...runtime,
      cloudBackupOriginFingerprint: meta.fingerprint,
    },
  } as 存档数据;
}

function rewriteAssetReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('asset:')) {
    const originalId = value.slice('asset:'.length);
    return idMap.has(originalId) ? `asset:${idMap.get(originalId)}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteAssetReferences(item, idMap));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(source)) next[key] = rewriteAssetReferences(current, idMap);
  if (typeof source.id === 'string' && idMap.has(source.id) && ('dataUrl' in source || 'mimeType' in source || 'originalUrl' in source)) {
    next.id = idMap.get(source.id);
  }
  return next;
}

function collectAssetReferences(value: unknown, result: Set<string>): void {
  if (typeof value === 'string' && value.startsWith('asset:')) {
    if (value.length > 'asset:'.length) result.add(value.slice('asset:'.length));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetReferences(item, result);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const source = value as Record<string, unknown>;
  if (typeof source.id === 'string' && ('dataUrl' in source || 'mimeType' in source || 'originalUrl' in source)) result.add(source.id);
  for (const current of Object.values(source)) collectAssetReferences(current, result);
}

function validateCloudSaveNode(save: 存档数据, meta: CloudBackupNodeMeta): void {
  const version = normalizeCloudVersion(meta.universe, meta.schemaVersion);
  if (version.universe !== 'teyvat' || version.schemaVersion !== 2) throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  const raw = save as unknown as Record<string, unknown>;
  if (raw.universe !== 'teyvat' || raw.schemaVersion !== 2 || !raw.旅行者 || !raw.世界 || !Array.isArray(raw.NPC)) {
    throw new Error(`云备份 Teyvat 节点结构或版本无效：${meta.entryPath}`);
  }
}

function assertCloudBackupNodeVersions(
  nodes: CloudBackupNodeMeta[],
): { universe: SaveUniverse; schemaVersion: number } {
  if (!nodes.length) throw new Error('云备份节点清单为空。');
  const versions = nodes.map((node) => normalizeCloudVersion(node.universe, node.schemaVersion));
  const first = versions[0];
  if (!first) throw new Error('云备份节点清单为空。');
  if (versions.some((version) => version.universe !== first.universe)) {
    throw new Error('云备份包含跨宇宙节点，已在暂存写入前拒绝。');
  }
  if (versions.some((version) => version.schemaVersion !== first.schemaVersion)) {
    throw new Error('云备份包含不兼容的 schemaVersion，已在暂存写入前拒绝。');
  }
  if (first.universe !== 'teyvat' || first.schemaVersion !== 2) throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  return { universe: 'teyvat', schemaVersion: 2 };
}

function assertCatalogSummaryVersions(
  summaries: Array<{ universe?: SaveUniverse; schemaVersion?: number }>,
): { universe: SaveUniverse; schemaVersion: number } {
  const versions = summaries.map((summary) => normalizeCloudVersion(summary.universe, summary.schemaVersion));
  const first = versions[0];
  if (!first) throw new Error('本地存档目录为空。');
  if (versions.some((version) => version.universe !== first.universe)) {
    throw new Error('本地存档目录包含跨宇宙节点，不能执行云合并。');
  }
  if (versions.some((version) => version.schemaVersion !== first.schemaVersion)) {
    throw new Error('本地存档目录包含不兼容的 schemaVersion，不能执行云合并。');
  }
  if (first.universe !== 'teyvat' || first.schemaVersion !== 2) throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  return { universe: 'teyvat', schemaVersion: 2 };
}

function assertMergeTargetVersion(
  incoming: { universe: SaveUniverse; schemaVersion: number },
  local: Pick<LocalMergeIndex, 'universe' | 'schemaVersion'>,
): void {
  if (!local.universe) return;
  if (local.universe !== incoming.universe) {
    throw new Error('云备份宇宙与本地存档宇宙不一致，已在暂存写入前拒绝。');
  }
  if (local.schemaVersion !== incoming.schemaVersion) {
    throw new Error('云备份 schemaVersion 与本地存档不兼容，已在暂存写入前拒绝。');
  }
}

function normalizeCloudVersion(
  universe: unknown,
  schemaVersion: unknown,
): { universe: SaveUniverse; schemaVersion: number } {
  if (universe === undefined && schemaVersion === undefined) {
    return { universe: 'legacy-hsr', schemaVersion: 1 };
  }
  if (universe === 'teyvat' && schemaVersion === 2) return { universe, schemaVersion };
  if ((universe === 'legacy-hsr' || universe === 'hsr') && schemaVersion === 1) {
    return { universe: 'legacy-hsr', schemaVersion: 1 };
  }
  throw new Error('云备份节点的 universe/schemaVersion 不兼容。');
}

function resolveRecordBlob(record: SaveAssetRecord): Blob | null {
  if (record.blob instanceof Blob) return record.blob;
  return dataUrlToBlob(record.dataUrl || '') ?? dataUrlToBlob(record.originalUrl || '');
}

function getSaveTree(save: 存档数据): {
  rootId?: string;
  nodeId?: string;
  parentNodeId?: string;
  branchName?: string;
  createdAt?: number;
  [key: string]: unknown;
} | undefined {
  return (save as 存档数据 & { saveTree?: ReturnType<typeof getSaveTree> }).saveTree;
}

function readSaveRuntime(save: 存档数据): Record<string, unknown> {
  const runtime = (save as 存档数据 & { saveRuntime?: unknown }).saveRuntime;
  return runtime && typeof runtime === 'object' ? runtime as Record<string, unknown> : {};
}

function readCloudOriginFingerprint(save: 存档数据): string | null {
  const value = readSaveRuntime(save).cloudBackupOriginFingerprint;
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}

function normalizeSaveType(value: unknown): 存档数据['type'] {
  return value === 'auto' || value === 'backup' || value === 'imported' ? value : 'manual';
}

function nextAvailableAssetId(usedIds: Set<string>): string {
  let id = createMergeId('cloud_asset');
  while (usedIds.has(id)) id = createMergeId('cloud_asset');
  return id;
}

function createMergeId(prefix: string): string {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${Date.now()}_${random}`;
}

function assetStageKey(contentHash: string): string {
  return `asset.${contentHash}`;
}

function nodeStageKey(index: number): string {
  return `node.${String(index).padStart(8, '0')}`;
}

import { assertNotAborted, yieldToMainThread } from '@/utils/asyncControl';
