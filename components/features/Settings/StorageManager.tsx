import { CLIP_MEDIUM, CLIP_SMALL } from '@/styles/clipPaths';
import { useEffect, useMemo, useState } from 'react';
import {
  backupDesktopStateBeforeOneTimeMigration,
  backupCurrentSavesToDesktop,
  cleanupUnreferencedDesktopAssets,
  deleteLegacyBackupSaves,
  deleteSave,
  deleteSaveTree,
  forceDeleteSave,
  exportSavePackage,
  exportSaveTreePackage,
  getSaveCatalogRepairState,
  getSaveCatalogSnapshot,
  getSaveList,
  importSaveFileAsMany,
  loadSave,
  loadSaveTree,
  repairSaveDatabase,
  previewDesktopStateBeforeOneTimeMigration,
  restoreSavesFromDesktopBackup,
  restoreSavesFromDesktopMirror,
  saveGame,
  startSaveCatalogRepair,
  subscribeSaveCatalogRepair,
  summarizeDesktopAssets,
  type SaveCatalogRepairState,
  type SaveListItemSummary,
} from '@/services/dbService';
import { clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';
import { createImportSourceFileBackup } from '@/services/exportService';
import { runGuardedStorageImport } from '@/services/storage/guardedStorageImport';
import {
  checkForDesktopUpdate,
  downloadAndInstallDesktopUpdate,
  getDesktopAppInfo,
  openDesktopDataDir,
  pickDesktopFolder,
  setDesktopStorageRoots,
  writeDesktopProbe,
  type DesktopAppInfo,
  type DesktopProbeResult,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
} from '@/services/desktop/desktopBridge';
import {
  deleteDesktopDiagnosticReport,
  listDesktopDiagnosticReports,
  loadDesktopDiagnosticReport,
  writeDesktopDiagnosticReport,
  type DesktopDiagnosticReportResult,
  type DesktopDiagnosticReportSummary,
} from '@/services/desktop/desktopDiagnostics';
import {
  buildDesktopReleaseInfo,
  type DesktopReleaseInfo,
} from '@/services/desktop/desktopReleaseInfo';
import { inspectDesktopAssetMirrorHealth, listDesktopAssetMirror, repairDesktopAssetMirrorIndex } from '@/services/desktop/desktopAssetMirror';
import type { DesktopAssetMaintenanceSummary, DesktopAssetMirrorHealth } from '@/services/desktop/desktopAssetMirror';
import {
  deleteDesktopSaveBackup,
  loadDesktopSaveBackup,
  listDesktopSaveBackups,
  type DesktopSaveBackupSummary,
} from '@/services/desktop/desktopSaveBackup';
import {
  listDesktopMigrationBackups,
  type DesktopMigrationBackupPreview,
  type DesktopMigrationBackupSummary,
} from '@/services/desktop/desktopMigrationBackup';
import { inspectDesktopSaveDeltaMirrorHealth, repairDesktopSaveDeltaMirrorIndex } from '@/services/desktop/desktopSaveDeltaMirror';
import type { DesktopSaveDeltaMirrorHealth } from '@/services/desktop/desktopSaveDeltaMirror';
import { inspectDesktopSaveMirrorHealth, listDesktopSaveMirror, repairDesktopSaveMirrorIndex, repairUnresolvedDesktopSaveTransactions } from '@/services/desktop/desktopSaveMirror';
import type { DesktopSaveMirrorHealth } from '@/services/desktop/desktopSaveMirror';
import {
  listDesktopSettingsMirrorKeys,
  listDesktopSpecialSettingMirrors,
} from '@/services/desktop/desktopSettingsMirror';
import { buildSaveTreeGroups, filterSaveTreeDisplayGroup, type SaveTreeDisplayGroup } from '@/utils/saveTreeView';
import { getRuntimePlatform } from '@/utils/platform/desktopRuntime';
import { formatByteSize } from '@/utils/formatByteSize';
import {
  StorageActionButton as ActionButton,
  StorageLegacyBackupSection,
  StorageSaveTreeGroup,
  StorageTreeSelector,
} from './storage/StorageSaveTreeView';
import {
  countUnreadableDesktopBackups,
  countUnreadableDesktopMigrationBackups,
  DesktopStorageStatus,
  downloadDesktopBackupRecord,
  downloadDesktopDiagnosticReport,
  findLatestRestorableDesktopBackup,
  findLatestVerifiedDesktopMigrationBackup,
  isRestorableDesktopBackup,
} from './storage/DesktopStorageStatus';

interface Props {
  onSave: () => Promise<number>;
  onContinue: () => Promise<boolean>;
  onLoadSave: (id: number) => Promise<boolean>;
}

type Filter = 'all' | 'manual' | 'auto' | 'imported';




export function StorageManagerTab({ onSave, onContinue, onLoadSave }: Props) {
  const [saves, setSaves] = useState<SaveListItemSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingRootId, setDeletingRootId] = useState<string | null>(null);
  const [deletingLegacyBackups, setDeletingLegacyBackups] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [loadError, setLoadError] = useState('');
  const [legacyBackups, setLegacyBackups] = useState<SaveListItemSummary[]>([]);
  const [pendingSummaryCount, setPendingSummaryCount] = useState(0);
  const [unreadableSummaryCount, setUnreadableSummaryCount] = useState(0);
  const [catalogComplete, setCatalogComplete] = useState(true);
  const [repairState, setRepairState] = useState<SaveCatalogRepairState>(() => getSaveCatalogRepairState());
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<DesktopAppInfo | null>(null);
  const [desktopReleaseInfo, setDesktopReleaseInfo] = useState<DesktopReleaseInfo | null>(null);
  const [desktopProbe, setDesktopProbe] = useState<DesktopProbeResult | null>(null);
  const [desktopError, setDesktopError] = useState('');
  const [checkingDesktop, setCheckingDesktop] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateStatus | null>(null);
  const [desktopMirrorCount, setDesktopMirrorCount] = useState(0);
  const [desktopConfigCount, setDesktopConfigCount] = useState(0);
  const [desktopAssetCount, setDesktopAssetCount] = useState(0);
  const [desktopAssetSummary, setDesktopAssetSummary] = useState<DesktopAssetMaintenanceSummary | null>(null);
  const [saveRootEdit, setSaveRootEdit] = useState<string | null>(null);
  const [backupRootEdit, setBackupRootEdit] = useState<string | null>(null);
  const [desktopSaveMirrorHealth, setDesktopSaveMirrorHealth] = useState<DesktopSaveMirrorHealth | null>(null);
  const [desktopSaveDeltaMirrorHealth, setDesktopSaveDeltaMirrorHealth] = useState<DesktopSaveDeltaMirrorHealth | null>(null);
  const [desktopAssetMirrorHealth, setDesktopAssetMirrorHealth] = useState<DesktopAssetMirrorHealth | null>(null);
  const [desktopBackupCount, setDesktopBackupCount] = useState(0);
  const [latestDesktopBackup, setLatestDesktopBackup] = useState<DesktopSaveBackupSummary | null>(null);
  const [desktopBackups, setDesktopBackups] = useState<DesktopSaveBackupSummary[]>([]);
  const [selectedDesktopBackupPath, setSelectedDesktopBackupPath] = useState<string | null>(null);
  const [deletingDesktopBackupPath, setDeletingDesktopBackupPath] = useState<string | null>(null);
  const [exportingDesktopBackupPath, setExportingDesktopBackupPath] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [restoringDesktopMirror, setRestoringDesktopMirror] = useState(false);
  const [restoringDesktopBackup, setRestoringDesktopBackup] = useState(false);
  const [cleaningDesktopAssets, setCleaningDesktopAssets] = useState(false);
  const [repairingDesktopIndexes, setRepairingDesktopIndexes] = useState(false);
  const [desktopIndexRepairSummary, setDesktopIndexRepairSummary] = useState('');
  const [backingUpDesktop, setBackingUpDesktop] = useState(false);
  const [backingUpDesktopMigration, setBackingUpDesktopMigration] = useState(false);
  const [latestDesktopMigrationBackup, setLatestDesktopMigrationBackup] = useState<DesktopMigrationBackupSummary | null>(null);
  const [desktopMigrationBackupPreview, setDesktopMigrationBackupPreview] = useState<DesktopMigrationBackupPreview | null>(null);
  const [desktopMigrationBackupCount, setDesktopMigrationBackupCount] = useState(0);
  const [unreadableDesktopMigrationBackupCount, setUnreadableDesktopMigrationBackupCount] = useState(0);
  const [exportingDiagnostic, setExportingDiagnostic] = useState(false);
  const [latestDiagnosticReport, setLatestDiagnosticReport] = useState<DesktopDiagnosticReportResult | DesktopDiagnosticReportSummary | null>(null);
  const [desktopDiagnosticReports, setDesktopDiagnosticReports] = useState<DesktopDiagnosticReportSummary[]>([]);
  const [exportingDiagnosticReportPath, setExportingDiagnosticReportPath] = useState<string | null>(null);
  const [deletingDiagnosticReportPath, setDeletingDiagnosticReportPath] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [browserStorage, setBrowserStorage] = useState<{ usage: number; quota: number; persisted?: boolean } | null>(null);

  const refresh = async () => {
    setLoadError('');
    try {
      const snapshot = await getSaveCatalogSnapshot();
      setSaves(snapshot.items);
      setLegacyBackups(snapshot.legacyBackups);
      setPendingSummaryCount(snapshot.pendingIds.length);
      setUnreadableSummaryCount(snapshot.unreadableIds.length);
      setCatalogComplete(snapshot.catalogComplete);
      return snapshot;
    } catch (err) {
      console.error('[storage-manager] save list failed', err);
      setLoadError(err instanceof Error ? err.message : '存档列表读取失败');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadAndRepair = async () => {
      try {
        const snapshot = await refresh();
        if (!cancelled && snapshot?.pendingIds.length) {
          await startSaveCatalogRepair('missing-only');
          if (!cancelled) await refresh();
        }
      } catch (err) {
        console.warn('[storage-manager] background catalog recovery failed', err);
      }
    };
    void loadAndRepair();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeSaveCatalogRepair((state) => {
    setRepairState(state);
    if (state.phase === 'completed' || state.phase === 'partial-failure') {
      void refresh();
    }
  }), []);

  useEffect(() => {
    let cancelled = false;
    const inspectBrowserStorage = async () => {
      if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return;
      try {
        const [estimate, persisted] = await Promise.all([
          navigator.storage.estimate(),
          typeof navigator.storage.persisted === 'function' ? navigator.storage.persisted() : Promise.resolve(undefined),
        ]);
        if (!cancelled) {
          setBrowserStorage({
            usage: estimate.usage ?? 0,
            quota: estimate.quota ?? 0,
            ...(persisted === undefined ? {} : { persisted }),
          });
        }
      } catch (error) {
        console.warn('[storage-manager] browser storage estimate unavailable', error);
      }
    };
    void inspectBrowserStorage();
    return () => { cancelled = true; };
  }, [saves.length]);

  useEffect(() => {
    let cancelled = false;
    const loadDesktopInfo = async () => {
      setDesktopError('');
      try {
        const info = await getDesktopAppInfo();
        if (!cancelled) {
          setDesktopInfo(info);
          setSaveRootEdit(info?.saveDir ?? null);
          setBackupRootEdit(info?.backupDir ?? null);
        }
        if (!cancelled) setDesktopReleaseInfo(buildDesktopReleaseInfo(info, null));
        const mirror = await listDesktopSaveMirror();
        if (!cancelled) setDesktopMirrorCount(mirror.length);
        const configKeys = await listDesktopSettingsMirrorKeys();
        if (!cancelled) setDesktopConfigCount(configKeys.length);
        const assetMirror = await listDesktopAssetMirror();
        if (!cancelled) setDesktopAssetCount(assetMirror.length);
        const assetSummary = await summarizeDesktopAssets();
        if (!cancelled) setDesktopAssetSummary(assetSummary);
        const saveMirrorHealth = await inspectDesktopSaveMirrorHealth();
        if (!cancelled) setDesktopSaveMirrorHealth(saveMirrorHealth);
        const saveDeltaMirrorHealth = await inspectDesktopSaveDeltaMirrorHealth();
        if (!cancelled) setDesktopSaveDeltaMirrorHealth(saveDeltaMirrorHealth);
        const assetMirrorHealth = await inspectDesktopAssetMirrorHealth();
        if (!cancelled) setDesktopAssetMirrorHealth(assetMirrorHealth);
        const backups = await listDesktopSaveBackups();
        const migrationBackups = await listDesktopMigrationBackups();
        const migrationPreview = await previewDesktopStateBeforeOneTimeMigration();
        const reports = await listDesktopDiagnosticReports();
        if (!cancelled) {
          setDesktopBackupCount(backups.length);
          setLatestDesktopBackup(findLatestRestorableDesktopBackup(backups));
          setDesktopBackups(backups);
          setDesktopMigrationBackupCount(migrationBackups.length);
          setUnreadableDesktopMigrationBackupCount(countUnreadableDesktopMigrationBackups(migrationBackups));
          setLatestDesktopMigrationBackup(findLatestVerifiedDesktopMigrationBackup(migrationBackups));
          setDesktopMigrationBackupPreview(migrationPreview);
          setDesktopDiagnosticReports(reports);
          setLatestDiagnosticReport(reports[0] ?? null);
        }
      } catch (err) {
        console.error('[storage-manager] desktop info failed', err);
        if (!cancelled) setDesktopError(err instanceof Error ? err.message : '桌面端信息读取失败');
      }
    };
    void loadDesktopInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRepairList = async () => {
    setLoading(true);
    setLoadError('');
    try {
      await repairSaveDatabase();
      await refresh();
    } catch (err) {
      console.error('[storage-manager] repair failed', err);
      setLoadError(err instanceof Error ? err.message : '存档摘要修复失败');
    } finally {
      setLoading(false);
    }
  };

  const visibleSaves = useMemo(
    () => saves.filter((save) => save.id !== deletingId && save.saveTree?.rootId !== deletingRootId),
    [deletingId, deletingRootId, saves],
  );

  const grouped = useMemo(() => {
    const manual = visibleSaves.filter((s) => s.type === 'manual');
    const auto = visibleSaves.filter((s) => s.type === 'auto');
    const imported = visibleSaves.filter((s) => s.type === 'imported');
    return { manual, auto, imported };
  }, [visibleSaves]);
  const repairingSummaries = pendingSummaryCount > 0 && (
    repairState.phase === 'checking'
    || repairState.phase === 'waiting-for-lease'
    || repairState.phase === 'repairing'
    || repairState.phase === 'paused-for-write'
  );

  const allTreeGroups = useMemo(() => buildSaveTreeGroups(visibleSaves), [visibleSaves]);
  const visibleTreeGroups = useMemo(
    () => allTreeGroups
      .map((group) => filterSaveTreeDisplayGroup(group, (save) => matchesSaveFilter(save, filter)))
      .filter((group): group is SaveTreeDisplayGroup => Boolean(group)),
    [allTreeGroups, filter],
  );
  const selectedTree =
    visibleTreeGroups.find((group) => group.rootId === selectedRootId) ??
    visibleTreeGroups[0] ??
    null;
  const selectedDesktopBackup = useMemo(
    () => desktopBackups.find((backup) => backup.path === selectedDesktopBackupPath) ?? desktopBackups[0] ?? null,
    [desktopBackups, selectedDesktopBackupPath],
  );

  useEffect(() => {
    if (visibleTreeGroups.length === 0) {
      if (selectedRootId !== null) setSelectedRootId(null);
      return;
    }
    if (!selectedRootId || !visibleTreeGroups.some((group) => group.rootId === selectedRootId)) {
      setSelectedRootId(visibleTreeGroups[0]?.rootId ?? null);
    }
  }, [selectedRootId, visibleTreeGroups]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave();
      await refresh();
      await refreshDesktopMirrorCount();
      setFilter('manual');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCurrent = async () => {
    setSaving(true);
    try {
      const id = await onSave();
      const save = await loadSave(id);
      if (save) await exportSavePackage(save);
      await refresh();
      await refreshDesktopMirrorCount();
      setFilter('manual');
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    setLoading(true);
    try {
      const ok = await onContinue();
      if (!ok) alert('没有可用的存档');
    } catch (err) {
      console.error('[storage-manager] continue failed', err);
      alert(`读取失败：${err instanceof Error ? err.message : '存档读取或恢复过程异常'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: number) => {
    if (!confirm('读取这个存档会替换当前未保存的进度，是否继续？')) return;
    setLoadingId(id);
    try {
      const ok = await onLoadSave(id);
      if (!ok) alert('读取失败：没有读取到可用存档内容');
    } catch (err) {
      console.error('[storage-manager] load failed', err);
      alert(`读取失败：${err instanceof Error ? err.message : '存档读取或恢复过程异常'}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这个存档？此操作不可恢复。')) return;
    const target = [...saves, ...legacyBackups].find((save) => save.id === id)?.saveTree;
    setDeletingId(id);
    setSaves((prev) => prev.filter((save) => save.id !== id));
    setLegacyBackups((prev) => prev.filter((save) => save.id !== id));
    try {
      await deleteSave(id);
      // 若该存档是更新增量存档的基底，deleteSave 只会隐藏它（保数据完整性），
      // 列表会仍然显示。此时提供整树删除，把依赖它的增量存档一并清掉。
      const fullList = await getSaveList();
      const stillListed = fullList.some((save) => save.id === id);
      if (stillListed && target?.rootId) {
        const nodeCount = fullList.filter((save) => save.saveTree?.rootId === target.rootId).length || 1;
        if (confirm(`这个存档是更新的自动存档的增量基底，无法单独删除。
要改为删除整棵存档树（共 ${nodeCount} 个节点）吗？此操作不可恢复。`)) {
          await deleteSaveTree(target.rootId);
        }
      } else if (stillListed) {
        // 空存档 / 无 saveTree 元信息的记录：直接强制删除。
        if (confirm('这个存档删除后仍残留在列表中（可能是空的存档记录）。要强制删除吗？此操作不可恢复。')) {
          await forceDeleteSave(id);
        }
      }
      clearActiveSaveTreeMetaIfMatches(target ? { nodeId: target.nodeId } : null);
      setDeletingId(null);
      void refresh();
      void refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] delete failed', err);
      alert(`删除失败：${err instanceof Error ? err.message : '存档删除过程异常'}`);
      await refresh();
      setDeletingId(null);
    }
  };

  const handleDeleteLegacyBackups = async () => {
    if (!legacyBackups.length || deletingLegacyBackups) return;
    if (!confirm(`确定清理全部 ${legacyBackups.length} 个历史恢复点？此操作不可恢复。`)) return;
    setDeletingLegacyBackups(true);
    try {
      await deleteLegacyBackupSaves();
      for (const backup of legacyBackups) {
        clearActiveSaveTreeMetaIfMatches(backup.saveTree ? { nodeId: backup.saveTree.nodeId } : null);
      }
      await refresh();
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] legacy backup cleanup failed', err);
      alert(`历史恢复点清理失败：${err instanceof Error ? err.message : '存档删除过程异常'}`);
    } finally {
      setDeletingLegacyBackups(false);
    }
  };

  const handleDeleteTree = async (rootId: string, nodeCount: number) => {
    if (!confirm(`确定删除这整棵存档树？将删除 ${nodeCount} 个节点，此操作不可恢复。`)) return;
    setDeletingRootId(rootId);
    setSaves((prev) => prev.filter((save) => save.saveTree?.rootId !== rootId));
    try {
      await deleteSaveTree(rootId);
      clearActiveSaveTreeMetaIfMatches({ rootId });
      setDeletingRootId(null);
      void refresh();
      void refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] delete tree failed', err);
      alert(`删除整树失败：${err instanceof Error ? err.message : '存档树删除过程异常'}`);
      await refresh();
      setDeletingRootId(null);
    }
  };

  const handleExport = async (id: number) => {
    const save = await loadSave(id);
    if (save) await exportSavePackage(save);
  };

  const handleExportTree = async (rootId: string) => {
    const treeSaves = await loadSaveTree(rootId);
    if (treeSaves.length) await exportSaveTreePackage(treeSaves);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ktysave,.zip,.json,application/zip,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const result = await runGuardedStorageImport(file, {
          parse: importSaveFileAsMany,
          confirm: (message) => window.confirm(message),
          backup: createImportSourceFileBackup,
          persist: saveGame,
        });
        if (result.status === 'cancelled') return;
        await refresh();
        await refreshDesktopMirrorCount();
        setFilter('imported');
      } catch (err) {
        alert(`导入失败：${err instanceof Error ? err.message : '存档文件格式无效'}`);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const handleDesktopProbe = async () => {
    setCheckingDesktop(true);
    setDesktopError('');
    try {
      const result = await writeDesktopProbe();
      setDesktopProbe(result);
      const info = await getDesktopAppInfo();
      setDesktopInfo(info);
      setDesktopReleaseInfo(buildDesktopReleaseInfo(info, desktopUpdate));
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop probe failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面端探针写入失败');
    } finally {
      setCheckingDesktop(false);
    }
  };

  const handleOpenDesktopSaveDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('saves');
    } catch (err) {
      console.error('[storage-manager] open desktop save dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面存档目录失败');
    }
  };

  const handleOpenDesktopConfigDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('config');
    } catch (err) {
      console.error('[storage-manager] open desktop config dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面配置目录失败');
    }
  };

  const handleOpenDesktopCodexDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('codex');
    } catch (err) {
      console.error('[storage-manager] open desktop codex dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面图鉴目录失败');
    }
  };

  const handleOpenDesktopWorldbookDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('worldbooks');
    } catch (err) {
      console.error('[storage-manager] open desktop worldbook dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面世界书目录失败');
    }
  };

  const handleOpenDesktopAssetDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('assets');
    } catch (err) {
      console.error('[storage-manager] open desktop asset dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面资源目录失败');
    }
  };

  const handleOpenDesktopBackupDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('backups');
    } catch (err) {
      console.error('[storage-manager] open desktop backup dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面备份目录失败');
    }
  };

  const handleChooseSaveRoot = async () => {
    setDesktopError('');
    try {
      const folder = await pickDesktopFolder();
      if (folder) setSaveRootEdit(folder);
    } catch (err) {
      console.error('[storage-manager] choose save root failed', err);
      setDesktopError(err instanceof Error ? err.message : '选择存档目录失败');
    }
  };

  const handleChooseBackupRoot = async () => {
    setDesktopError('');
    try {
      const folder = await pickDesktopFolder();
      if (folder) setBackupRootEdit(folder);
    } catch (err) {
      console.error('[storage-manager] choose backup root failed', err);
      setDesktopError(err instanceof Error ? err.message : '选择备份目录失败');
    }
  };

  const handleResetSaveRoot = async () => {
    setSaveRootEdit(null);
  };

  const handleResetBackupRoot = async () => {
    setBackupRootEdit(null);
  };

  const handleApplyStorageRoots = async () => {
    setDesktopError('');
    try {
      const info = await setDesktopStorageRoots({
        saveDir: saveRootEdit?.trim() ? saveRootEdit.trim() : null,
        backupDir: backupRootEdit?.trim() ? backupRootEdit.trim() : null,
      });
      setDesktopInfo(info);
      setSaveRootEdit(info.saveDir ?? null);
      setBackupRootEdit(info.backupDir ?? null);
    } catch (err) {
      console.error('[storage-manager] apply storage roots failed', err);
      setDesktopError(err instanceof Error ? err.message : '保存存储路径失败');
    }
  };

  const handleOpenDesktopLogDir = async () => {
    setDesktopError('');
    try {
      await openDesktopDataDir('logs');
    } catch (err) {
      console.error('[storage-manager] open desktop log dir failed', err);
      setDesktopError(err instanceof Error ? err.message : '打开桌面日志目录失败');
    }
  };

  const handleCheckDesktopUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError('');
    setUpdateProgress(null);
    try {
      const result = await checkForDesktopUpdate();
      setDesktopUpdate(result);
      setDesktopReleaseInfo(buildDesktopReleaseInfo(desktopInfo, result));
      if (result.error) setUpdateError(result.error);
    } catch (err) {
      console.error('[storage-manager] desktop update check failed', err);
      setUpdateError(err instanceof Error ? err.message : '桌面端更新检查失败');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallDesktopUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateError('');
    try {
      await downloadAndInstallDesktopUpdate(setUpdateProgress);
    } catch (err) {
      console.error('[storage-manager] desktop update install failed', err);
      setUpdateError(err instanceof Error ? err.message : '桌面端更新安装失败');
    } finally {
      setInstallingUpdate(false);
    }
  };

  const refreshDesktopMirrorCount = async () => {
    const mirror = await listDesktopSaveMirror();
    setDesktopMirrorCount(mirror.length);
    const configKeys = await listDesktopSettingsMirrorKeys();
    setDesktopConfigCount(configKeys.length);
    const assetMirror = await listDesktopAssetMirror();
    setDesktopAssetCount(assetMirror.length);
    const assetSummary = await summarizeDesktopAssets();
    setDesktopAssetSummary(assetSummary);
    const saveMirrorHealth = await inspectDesktopSaveMirrorHealth();
    setDesktopSaveMirrorHealth(saveMirrorHealth);
    const saveDeltaMirrorHealth = await inspectDesktopSaveDeltaMirrorHealth();
    setDesktopSaveDeltaMirrorHealth(saveDeltaMirrorHealth);
    const assetMirrorHealth = await inspectDesktopAssetMirrorHealth();
    setDesktopAssetMirrorHealth(assetMirrorHealth);
    const backups = await listDesktopSaveBackups();
    setDesktopBackupCount(backups.length);
    setLatestDesktopBackup(findLatestRestorableDesktopBackup(backups));
    setDesktopBackups(backups);
    const migrationBackups = await listDesktopMigrationBackups();
    setDesktopMigrationBackupCount(migrationBackups.length);
    setUnreadableDesktopMigrationBackupCount(countUnreadableDesktopMigrationBackups(migrationBackups));
    setLatestDesktopMigrationBackup(findLatestVerifiedDesktopMigrationBackup(migrationBackups));
    setDesktopMigrationBackupPreview(await previewDesktopStateBeforeOneTimeMigration());
    const reports = await listDesktopDiagnosticReports();
    setDesktopDiagnosticReports(reports);
    setLatestDiagnosticReport(reports[0] ?? null);
  };

  const handleCleanupDesktopAssets = async () => {
    if (!confirm('确定清理桌面端无引用图片资源？只会删除当前存档库未引用的本地图片镜像。')) return;
    setCleaningDesktopAssets(true);
    setDesktopError('');
    try {
      const summary = await cleanupUnreferencedDesktopAssets();
      setDesktopAssetSummary(summary);
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop asset cleanup failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面资源清理失败');
    } finally {
      setCleaningDesktopAssets(false);
    }
  };

  const handleRepairDesktopIndexes = async () => {
    setRepairingDesktopIndexes(true);
    setDesktopError('');
    setDesktopIndexRepairSummary('');
    try {
      await backupCurrentSavesToDesktop('before-repair');
      const repairedSaves = await repairDesktopSaveMirrorIndex();
      const repairedTransactions = await repairUnresolvedDesktopSaveTransactions();
      const repairedDeltas = await repairDesktopSaveDeltaMirrorIndex();
      const repairedAssets = await repairDesktopAssetMirrorIndex();
      setDesktopIndexRepairSummary(`已重建本地镜像索引（已先备份当前数据）：${repairedSaves.length} 个存档 / ${repairedDeltas.length} 个增量 / ${repairedAssets.length} 个资源 / 清理 ${repairedTransactions.removedTransactions} 个已完成事务 / 保留 ${repairedTransactions.retainedTransactions + repairedTransactions.unreadableTransactions} 个待排查事务`);
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop index repair failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面镜像索引修复失败');
    } finally {
      setRepairingDesktopIndexes(false);
    }
  };

  const handleBackupDesktopSaves = async () => {
    setBackingUpDesktop(true);
    setDesktopError('');
    try {
      const backup = await backupCurrentSavesToDesktop('manual');
      if (backup) {
        setLatestDesktopBackup(backup);
        setSelectedDesktopBackupPath(backup.path);
      }
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop save backup failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面本地备份失败');
    } finally {
      setBackingUpDesktop(false);
    }
  };

  const handleBackupDesktopMigration = async () => {
    if (!confirm('生成迁移前完整备份？此操作只写入备份文件，不会迁移、删除或覆盖当前数据。')) return;
    setBackingUpDesktopMigration(true);
    setDesktopError('');
    try {
      const backup = await backupDesktopStateBeforeOneTimeMigration();
      if (backup) {
        setLatestDesktopMigrationBackup(backup);
      }
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop migration backup failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面迁移前完整备份失败');
    } finally {
      setBackingUpDesktopMigration(false);
    }
  };

  const handleWriteDesktopDiagnosticReport = async () => {
    setExportingDiagnostic(true);
    setDesktopError('');
    try {
      const info = desktopInfo ?? await getDesktopAppInfo();
      if (info) setDesktopInfo(info);
      const specialSettingMirrors = await listDesktopSpecialSettingMirrors();
      const saveMirrorHealth = await inspectDesktopSaveMirrorHealth();
      const saveDeltaMirrorHealth = await inspectDesktopSaveDeltaMirrorHealth();
      const assetMirrorHealth = await inspectDesktopAssetMirrorHealth();
      const report = await writeDesktopDiagnosticReport({
        appInfo: info,
        saveCount: saves.length,
        desktopMirrorCount,
        desktopConfigCount,
        specialSettingMirrors,
        desktopAssetCount,
        desktopBackupCount,
        unreadableDesktopBackupCount: countUnreadableDesktopBackups(desktopBackups),
        desktopMigrationBackupCount,
        unreadableDesktopMigrationBackupCount,
        desktopMigrationBackupPreview,
        saveMirrorHealth,
        saveDeltaMirrorHealth,
        assetMirrorHealth,
        assetSummary: desktopAssetSummary,
        latestBackup: latestDesktopBackup,
        latestMigrationBackup: latestDesktopMigrationBackup,
        updateStatus: desktopUpdate,
        releaseInfo: desktopReleaseInfo,
        lastError: desktopError || loadError || updateError || undefined,
      });
      setLatestDiagnosticReport(report);
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop diagnostic export failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面诊断报告导出失败');
    } finally {
      setExportingDiagnostic(false);
    }
  };

  const handleRestoreDesktopMirror = async () => {
    if (!confirm('确定用桌面本地镜像恢复当前存档库？当前存档列表会被镜像内容替换。')) return;
    setRestoringDesktopMirror(true);
    setLoadError('');
    try {
      const restored = await restoreSavesFromDesktopMirror();
      await refresh();
      await refreshDesktopMirrorCount();
      setFilter('all');
      if (restored <= 0) alert('没有可恢复的桌面存档镜像');
    } catch (err) {
      console.error('[storage-manager] desktop mirror restore failed', err);
      setLoadError(err instanceof Error ? err.message : '桌面存档镜像恢复失败');
    } finally {
      setRestoringDesktopMirror(false);
    }
  };

  const handleRestoreDesktopBackup = async (backup: DesktopSaveBackupSummary | null) => {
    if (!backup) {
      alert('没有可恢复的桌面本地备份');
      return;
    }
    if (!isRestorableDesktopBackup(backup)) {
      alert('这份桌面本地备份不可恢复，请检查备份列表中的校验状态。');
      return;
    }
    if (!confirm(`确定恢复这份桌面本地备份？当前存档库会先自动备份，再替换为 ${backup.count} 个备份存档。`)) return;
    setRestoringDesktopBackup(true);
    setLoadError('');
    try {
      const restored = await restoreSavesFromDesktopBackup(backup.path);
      await refresh();
      await refreshDesktopMirrorCount();
      setFilter('all');
      if (restored <= 0) alert('这份桌面本地备份没有可恢复的存档');
    } catch (err) {
      console.error('[storage-manager] desktop backup restore failed', err);
      setLoadError(err instanceof Error ? err.message : '桌面本地备份恢复失败');
    } finally {
      setRestoringDesktopBackup(false);
    }
  };

  const handleDeleteDesktopBackup = async (backup: DesktopSaveBackupSummary) => {
    if (!confirm(`确定删除这份桌面本地备份？${new Date(backup.createdAt).toLocaleString('zh-CN')} / ${backup.count} 个存档。`)) return;
    setDeletingDesktopBackupPath(backup.path);
    setDesktopError('');
    try {
      await deleteDesktopSaveBackup(backup.path);
      if (selectedDesktopBackupPath === backup.path) {
        setSelectedDesktopBackupPath(null);
      }
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop backup delete failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面本地备份删除失败');
    } finally {
      setDeletingDesktopBackupPath(null);
    }
  };

  const handleExportDesktopBackup = async (backup: DesktopSaveBackupSummary) => {
    setExportingDesktopBackupPath(backup.path);
    setDesktopError('');
    try {
      const record = await loadDesktopSaveBackup(backup.path);
      if (!record) {
        alert('这份桌面本地备份无法读取或格式不正确');
        return;
      }
      downloadDesktopBackupRecord(record, backup.fileName);
    } catch (err) {
      console.error('[storage-manager] desktop backup export failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面本地备份导出失败');
    } finally {
      setExportingDesktopBackupPath(null);
    }
  };

  const handleExportDesktopDiagnosticReport = async (report: DesktopDiagnosticReportSummary) => {
    setExportingDiagnosticReportPath(report.path);
    setDesktopError('');
    try {
      const payload = await loadDesktopDiagnosticReport(report.path);
      if (!payload) {
        alert('这份桌面诊断报告无法读取或格式不正确');
        return;
      }
      downloadDesktopDiagnosticReport(payload, report.fileName);
    } catch (err) {
      console.error('[storage-manager] desktop diagnostic report export failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面诊断报告导出失败');
    } finally {
      setExportingDiagnosticReportPath(null);
    }
  };

  const handleDeleteDesktopDiagnosticReport = async (report: DesktopDiagnosticReportSummary) => {
    if (!confirm(`确定删除这份桌面诊断报告？${new Date(report.createdAt).toLocaleString('zh-CN')}。`)) return;
    setDeletingDiagnosticReportPath(report.path);
    setDesktopError('');
    try {
      await deleteDesktopDiagnosticReport(report.path);
      await refreshDesktopMirrorCount();
    } catch (err) {
      console.error('[storage-manager] desktop diagnostic report delete failed', err);
      setDesktopError(err instanceof Error ? err.message : '桌面诊断报告删除失败');
    } finally {
      setDeletingDiagnosticReportPath(null);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden p-1"
      style={{
        background:
          'radial-gradient(circle at 12% 0%, rgba(var(--tj-arcane-accent-deep),0.14), transparent 30%), linear-gradient(90deg, rgba(var(--tj-arcane-accent),0.035) 1px, transparent 1px), linear-gradient(180deg, rgba(var(--tj-arcane-accent),0.028) 1px, transparent 1px)',
        backgroundSize: 'auto, 44px 44px, 44px 44px',
      }}
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_auto]">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <ActionButton label={saving ? '保存中' : '手动存档'} tone="primary" disabled={saving} onClick={handleSave} />
          <ActionButton label={loading ? '读取中' : '载入最新'} disabled={loading} onClick={handleContinue} />
          <ActionButton label={importing ? '导入中' : '导入存档包'} disabled={importing} onClick={handleImport} />
          <ActionButton label="导出当前" disabled={saving} onClick={handleExportCurrent} />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <FilterButton label="全部" count={visibleSaves.length} active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterButton label="手动" count={grouped.manual.length} active={filter === 'manual'} onClick={() => setFilter('manual')} />
          <FilterButton label="自动" count={grouped.auto.length} active={filter === 'auto'} onClick={() => setFilter('auto')} />
          <FilterButton label="导入存档" count={grouped.imported.length} active={filter === 'imported'} onClick={() => setFilter('imported')} />
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 px-3 py-3 text-center font-serif text-[12px] tracking-[0.18em] lg:grid-cols-4"
        style={{
          color: 'rgba(var(--tj-text-primary),0.82)',
          background: 'rgba(var(--tj-arcane-accent),0.055)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.13)',
          clipPath: CLIP_MEDIUM,
        }}
      >
        <Metric label="手动" value={grouped.manual.length} />
        <Metric label="自动" value={grouped.auto.length} />
        <Metric label="导入存档" value={grouped.imported.length} />
        <Metric label="总计" value={saves.length} />
      </div>

      {browserStorage && (
        <div
          className="px-3 py-2 text-[12px] leading-relaxed"
          style={{
            color: 'rgba(var(--tj-text-primary),0.76)',
            background: 'rgba(var(--tj-panel-bg-start),0.38)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
            clipPath: CLIP_MEDIUM,
          }}
        >
          浏览器存储：已用 {formatByteSize(browserStorage.usage)} / {formatByteSize(browserStorage.quota)}
          {browserStorage.persisted === undefined ? '' : browserStorage.persisted ? ' · 已获得持久存储保护' : ' · 当前为浏览器尽力存储，低磁盘空间时可能被清理'}
        </div>
      )}

      <div
        className="px-3 py-2 font-serif text-[12px] leading-relaxed tracking-wider"
        style={{
          color: 'rgba(var(--tj-text-primary),0.68)',
          background: 'rgba(var(--tj-panel-bg-start),0.42)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
          clipPath: CLIP_MEDIUM,
        }}
      >
        导出存档包默认不包含 API Key / API 配置；导入存档包 / 旧 JSON 会放入导入存档分区。
        {repairingSummaries
          ? repairState.phase === 'paused-for-write'
            ? ' 索引恢复已暂停，正在优先保存或删除。'
            : ` 正在恢复节点详情 ${repairState.processed}/${Math.max(repairState.total, pendingSummaryCount)}。`
          : ''}
        {!repairingSummaries && unreadableSummaryCount > 0 ? ` ${unreadableSummaryCount} 个节点详情读取失败，可使用修复摘要重试。` : ''}
      </div>

      <DesktopStorageStatus
        platform={getRuntimePlatform()}
        info={desktopInfo}
        releaseInfo={desktopReleaseInfo}
        probe={desktopProbe}
        error={desktopError}
        checking={checkingDesktop}
        update={desktopUpdate}
        updateProgress={updateProgress}
        updateError={updateError}
        checkingUpdate={checkingUpdate}
        installingUpdate={installingUpdate}
        desktopMirrorCount={desktopMirrorCount}
        desktopConfigCount={desktopConfigCount}
        desktopAssetCount={desktopAssetCount}
        desktopAssetSummary={desktopAssetSummary}
        desktopSaveMirrorHealth={desktopSaveMirrorHealth}
        desktopSaveDeltaMirrorHealth={desktopSaveDeltaMirrorHealth}
        desktopAssetMirrorHealth={desktopAssetMirrorHealth}
        desktopBackupCount={desktopBackupCount}
        desktopMigrationBackupCount={desktopMigrationBackupCount}
        unreadableDesktopMigrationBackupCount={unreadableDesktopMigrationBackupCount}
        latestDesktopBackup={latestDesktopBackup}
        desktopMigrationBackupPreview={desktopMigrationBackupPreview}
        desktopBackups={desktopBackups}
        selectedDesktopBackup={selectedDesktopBackup}
        restoringDesktopMirror={restoringDesktopMirror}
        restoringDesktopBackup={restoringDesktopBackup}
        deletingDesktopBackupPath={deletingDesktopBackupPath}
        exportingDesktopBackupPath={exportingDesktopBackupPath}
        cleaningDesktopAssets={cleaningDesktopAssets}
        repairingDesktopIndexes={repairingDesktopIndexes}
        desktopIndexRepairSummary={desktopIndexRepairSummary}
        backingUpDesktop={backingUpDesktop}
        backingUpDesktopMigration={backingUpDesktopMigration}
        latestDesktopMigrationBackup={latestDesktopMigrationBackup}
        exportingDiagnostic={exportingDiagnostic}
        latestDiagnosticReport={latestDiagnosticReport}
        diagnosticReports={desktopDiagnosticReports}
        exportingDiagnosticReportPath={exportingDiagnosticReportPath}
        deletingDiagnosticReportPath={deletingDiagnosticReportPath}
        onProbe={handleDesktopProbe}
        onOpenSaveDir={handleOpenDesktopSaveDir}
        onOpenBackupDir={handleOpenDesktopBackupDir}
        saveRootEdit={saveRootEdit}
        backupRootEdit={backupRootEdit}
        onChooseSaveRoot={handleChooseSaveRoot}
        onChooseBackupRoot={handleChooseBackupRoot}
        onResetSaveRoot={handleResetSaveRoot}
        onResetBackupRoot={handleResetBackupRoot}
        onApplyStorageRoots={handleApplyStorageRoots}
        onOpenLogDir={handleOpenDesktopLogDir}
        onOpenConfigDir={handleOpenDesktopConfigDir}
        onOpenCodexDir={handleOpenDesktopCodexDir}
        onOpenWorldbookDir={handleOpenDesktopWorldbookDir}
        onOpenAssetDir={handleOpenDesktopAssetDir}
        onCleanupDesktopAssets={handleCleanupDesktopAssets}
        onRepairDesktopIndexes={handleRepairDesktopIndexes}
        onBackupDesktopSaves={handleBackupDesktopSaves}
        onBackupDesktopMigration={handleBackupDesktopMigration}
        onWriteDiagnosticReport={handleWriteDesktopDiagnosticReport}
        onExportDiagnosticReport={handleExportDesktopDiagnosticReport}
        onDeleteDiagnosticReport={handleDeleteDesktopDiagnosticReport}
        onRestoreDesktopBackup={handleRestoreDesktopBackup}
        onDeleteDesktopBackup={handleDeleteDesktopBackup}
        onExportDesktopBackup={handleExportDesktopBackup}
        onSelectDesktopBackup={(backup) => setSelectedDesktopBackupPath(backup.path)}
        onCheckUpdate={handleCheckDesktopUpdate}
        onInstallUpdate={handleInstallDesktopUpdate}
        onRestoreDesktopMirror={handleRestoreDesktopMirror}
      />

      <div className="teyvat-options-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-5 pr-1">
        {legacyBackups.length > 0 && (
          <StorageLegacyBackupSection
            backups={legacyBackups}
            loadingId={loadingId}
            deletingId={deletingId}
            deletingAll={deletingLegacyBackups}
            onLoad={handleLoad}
            onExport={handleExport}
            onDelete={handleDelete}
            onDeleteAll={handleDeleteLegacyBackups}
          />
        )}
        {loadError ? (
          <div
            className="p-5 text-center font-serif"
            style={{
              color: 'rgba(var(--tj-text-secondary), 0.82)',
              background: 'rgba(var(--tj-danger), 0.28)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger), 0.25)',
              clipPath: CLIP_MEDIUM,
            }}
          >
            <div className="text-sm tracking-[0.18em]" style={{ color: 'rgba(var(--tj-danger),0.92)' }}>
              存档列表读取失败
            </div>
            <div className="mt-2 text-xs leading-relaxed tracking-wider">{loadError}</div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <ActionButton label="重新读取" onClick={refresh} />
              <ActionButton label={loading ? '修复中' : '修复摘要'} tone="primary" disabled={loading} onClick={handleRepairList} />
            </div>
          </div>
        ) : visibleTreeGroups.length === 0 ? (
          <div
            className="p-6 text-center text-sm font-serif tracking-[0.2em]"
            style={{
              color: 'rgba(var(--tj-text-primary),0.72)',
              background: 'rgba(var(--tj-panel-bg-start),0.46)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.15)',
              clipPath: CLIP_MEDIUM,
            }}
          >
            暂无对应存档
          </div>
        ) : (
          <div className="grid min-h-0 min-w-0 gap-3 pb-3 lg:grid-cols-[260px_1fr]">
            <StorageTreeSelector
              groups={visibleTreeGroups}
              selectedRootId={selectedTree?.rootId ?? null}
              onSelect={setSelectedRootId}
            />
            {selectedTree && (
              <StorageSaveTreeGroup
                key={selectedTree.rootId}
                group={selectedTree}
                loadingId={loadingId}
                deletingId={deletingId}
                deletingRootId={deletingRootId}
                onLoad={handleLoad}
                onExport={handleExport}
                onExportTree={handleExportTree}
                onDelete={handleDelete}
                onDeleteTree={handleDeleteTree}
                catalogComplete={catalogComplete}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer px-3 py-2 text-[12px] font-serif tracking-[0.16em] transition-all sm:w-auto"
      style={{
        color: active ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-text-primary),0.70)',
        background: active
          ? 'linear-gradient(135deg, rgb(var(--tj-arcane-accent)), rgb(var(--tj-arcane-accent-deep)))'
          : 'rgba(var(--tj-arcane-accent),0.05)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.55), 0 0 22px rgba(var(--tj-arcane-accent-deep),0.22)'
          : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.15)',
        clipPath: CLIP_SMALL,
      }}
    >
      {label} <span style={{ opacity: 0.72 }}>{count}</span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.52)' }}>{label}</div>
      <div className="mt-0.5 text-base font-bold" style={{ color: 'rgb(var(--tj-arcane-accent))' }}>{value}</div>
    </div>
  );
}


function matchesSaveFilter(save: SaveListItemSummary, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'manual') return save.type === 'manual';
  if (filter === 'auto') return save.type === 'auto';
  return save.type === 'imported';
}
