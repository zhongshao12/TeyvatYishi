import { CLIP_CARD, CLIP_SMALL, CLIP_XL, insetRing } from '@/styles/clipPaths';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteSave,
  deleteSaveTree,
  deleteLegacyBackupSaves,
  exportSavePackage,
  exportSaveTreePackage,
  getSaveCatalogRepairState,
  getSaveCatalogSnapshot,
  loadSave,
  loadSaveTree,
  repairSaveDatabase,
  saveGame,
  saveMigratedTeyvatGameAtomically,
  startSaveCatalogRepair,
  subscribeSaveCatalogRepair,
  type SaveCatalogRepairState,
  type SaveListItemSummary,
} from '@/services/dbService';
import { pushToast } from '@/utils/toastStore';
import { toUserFacingError } from '@/utils/userFacingError';
import { formatStorageOperationError } from '@/services/storage/saveCatalog';
import { clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';
import { buildSaveTreeGroups, buildSaveTreeTimeline, filterSaveTreeDisplayGroup, type SaveTreeDisplayGroup } from '@/utils/saveTreeView';
import { formatByteSize } from '@/utils/formatByteSize';
import { classifyAndMigrateDbSaveRecord, migratePartialTeyvatSave, type MigrationIssue, type MigrationReport } from '@/compat/legacy-hsr/migrate';
import { normalizeTeyvatGameState, type ParsedSavePackage, type TeyvatSaveData } from '@/models/teyvat';
import { parseSavePackageByUniverse } from '@/services/savePackage';
import { persistPartialTeyvatMigration } from '@/services/teyvatSaveMigration';
import { createRawMigrationBackup, exportRawSave, 下载文本文件, 导出剧情Markdown, 导出剧情JSON, 导出角色档案, 导出世界书, 导出相册 } from '@/services/exportService';
import { LegacyUniverseSaveCard } from './LegacyUniverseSaveCard';
import { SaveMigrationDialog, type MigrationChoice } from './SaveMigrationDialog';
import type { 角色数据结构 } from '@/models/character';
import type { 世界书 } from '@/models/worldbook';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 聊天消息 } from '@/models/chat';
import { ConfirmDialogHost, useConfirmDialog, useModalAccessibility } from '@/components/ui/Modal';

interface Props {
  onSave: () => Promise<number>;
  onLoad: (id: number) => Promise<boolean>;
  onClose: () => void;
  chatHistory?: 聊天消息[];
  旅人?: 角色数据结构;
  worldbooks?: 世界书[];
  album?: 相册系统;
}

type Tab = 'all' | 'manual' | 'auto' | 'imported';

type ImportPreview =
  | { kind: 'teyvat'; state: TeyvatSaveData; sourceFileName: string }
  | { kind: 'partial-teyvat'; raw: unknown; sourceBackupRaw: unknown; sourceJsonBytes: string; issues: MigrationIssue[]; report: MigrationReport; sourceFileName: string; backupId?: string; backupError?: string }
  | { kind: 'legacy-hsr'; raw: unknown; report?: MigrationReport; sourceFileName: string }
  | { kind: 'invalid'; errors: string[] };

const shellClip =
  CLIP_XL;



export function SaveLoadModal({ onSave, onLoad, onClose, chatHistory, 旅人, worldbooks, album }: Props) {
  const [saves, setSaves] = useState<SaveListItemSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingRootId, setDeletingRootId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deletingLegacyBackups, setDeletingLegacyBackups] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [showMobileHelp, setShowMobileHelp] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [legacyBackups, setLegacyBackups] = useState<SaveListItemSummary[]>([]);
  const [pendingSummaryCount, setPendingSummaryCount] = useState(0);
  const [unreadableSummaryCount, setUnreadableSummaryCount] = useState(0);
  const [catalogComplete, setCatalogComplete] = useState(true);
  const [repairState, setRepairState] = useState<SaveCatalogRepairState>(() => getSaveCatalogRepairState());
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const previewFocusRestoreRef = useRef<HTMLElement | null>(null);
  const modalContentRef = useModalAccessibility<HTMLDivElement>(onClose);
  // 原生 confirm 无法换主题、不能读屏标注；读档/删档统一走样式化确认弹窗。
  const confirmDialog = useConfirmDialog();
  const askConfirm = confirmDialog.confirm;
  const isMigrationPreview = importPreview?.kind === 'partial-teyvat';

  const capturePreviewFocus = () => {
    previewFocusRestoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const restorePreviewFocus = () => {
    const target = previewFocusRestoreRef.current;
    previewFocusRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else if (modalContentRef.current?.isConnected) modalContentRef.current.focus();
    });
  };

  useEffect(() => {
    if (!isMigrationPreview) return;
    return () => restorePreviewFocus();
  }, [isMigrationPreview]);

  const refresh = async () => {
    setLoading(true);
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
      console.error('[save-list] load failed', err);
      setLoadError(err instanceof Error ? err.message : '存档列表读取失败');
    } finally {
      setLoading(false);
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
        console.warn('[save-list] background catalog recovery failed', err);
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

  const handleRepairList = async () => {
    setLoading(true);
    setLoadError('');
    try {
      await repairSaveDatabase();
      await refresh();
    } catch (err) {
      console.error('[save-list] repair failed', err);
      setLoadError(err instanceof Error ? err.message : '存档摘要修复失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave();
      await refresh();
      setTab('manual');
    } catch (err) {
      console.error('[save] failed', err);
      pushToast({ kind: 'error', title: '保存失败', detail: formatStorageOperationError('保存', err) });
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
      setTab('manual');
    } catch (err) {
      console.error('[save-export-current] failed', err);
      pushToast({ kind: 'error', title: '导出失败', detail: formatStorageOperationError('导出', err) });
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id: number) => {
    if (!await askConfirm({
      title: '读取存档',
      message: '读取这个存档会替换当前未保存的进度，是否继续？',
      confirmLabel: '读取',
    })) return;
    setLoadingId(id);
    try {
      const ok = await onLoad(id);
      if (!ok) pushToast({ kind: 'error', title: '加载失败', detail: '没有读取到可用存档内容' });
    } catch (err) {
      console.error('[save-load] load failed', err);
      pushToast({ kind: 'error', title: '加载失败', detail: toUserFacingError(err, { fallback: '存档读取或恢复过程异常' }) });
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!await askConfirm({
      title: '删除存档',
      message: '确定删除这个存档？此操作不可恢复。',
      confirmLabel: '删除',
      tone: 'danger',
    })) return;
    const target = [...saves, ...legacyBackups].find((save) => save.id === id)?.saveTree;
    setDeletingId(id);
    setSaves((prev) => prev.filter((save) => save.id !== id));
    setLegacyBackups((prev) => prev.filter((save) => save.id !== id));
    try {
      await deleteSave(id);
      clearActiveSaveTreeMetaIfMatches(target ? { nodeId: target.nodeId } : null);
      setDeletingId(null);
      void refresh();
    } catch (err) {
      console.error('[save-delete] delete failed', err);
      pushToast({ kind: 'error', title: '删除失败', detail: toUserFacingError(err, { fallback: '存档删除过程异常' }) });
      await refresh();
      setDeletingId(null);
    }
  };

  const handleDeleteLegacyBackups = async () => {
    if (!legacyBackups.length || deletingLegacyBackups) return;
    if (!await askConfirm({
      title: '清理历史恢复点',
      message: `确定清理全部 ${legacyBackups.length} 个历史恢复点？此操作不可恢复。`,
      confirmLabel: '清理全部',
      tone: 'danger',
    })) return;
    setDeletingLegacyBackups(true);
    try {
      await deleteLegacyBackupSaves();
      for (const backup of legacyBackups) {
        clearActiveSaveTreeMetaIfMatches(backup.saveTree ? { nodeId: backup.saveTree.nodeId } : null);
      }
      await refresh();
    } catch (err) {
      console.error('[save-delete-legacy-backups] failed', err);
      pushToast({ kind: 'error', title: '历史恢复点清理失败', detail: toUserFacingError(err, { fallback: '存档删除过程异常' }) });
    } finally {
      setDeletingLegacyBackups(false);
    }
  };

  const handleDeleteTree = async (rootId: string, nodeCount: number) => {
    if (!await askConfirm({
      title: '删除整棵存档树',
      message: `确定删除这整棵存档树？将删除 ${nodeCount} 个节点，此操作不可恢复。`,
      confirmLabel: '删除整树',
      tone: 'danger',
    })) return;
    setDeletingRootId(rootId);
    setSaves((prev) => prev.filter((save) => save.saveTree?.rootId !== rootId));
    try {
      await deleteSaveTree(rootId);
      clearActiveSaveTreeMetaIfMatches({ rootId });
      setDeletingRootId(null);
      void refresh();
    } catch (err) {
      console.error('[save-delete-tree] delete failed', err);
      pushToast({ kind: 'error', title: '删除整树失败', detail: toUserFacingError(err, { fallback: '存档树删除过程异常' }) });
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
    capturePreviewFocus();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ktysave,.zip,.json,application/zip,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportPreview(null);
      try {
        setImportPreview(await previewImportFile(file));
      } catch (err) {
        console.error('[save-import] failed', err);
        setImportPreview({ kind: 'invalid', errors: [err instanceof Error ? err.message : '存档文件格式无效'] });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const handleTeyvatImport = async (state: TeyvatSaveData) => {
    setImporting(true);
    setLoadError('');
    try {
      await saveGame(normalizeTeyvatGameState(state));
      await refresh();
      setTab('imported');
      setImportPreview(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '提瓦特存档写入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleMigrationConfirm = async (choices: MigrationChoice) => {
    if (!importPreview || importPreview.kind !== 'partial-teyvat' || !importPreview.backupId) {
      throw new Error('原档备份尚未完成，不能确认迁移。');
    }
    const elementByLegacyPath: Record<string, MigrationChoice[string] & string> = {};
    const rarityByLegacyValue: Record<string, number> = {};
    for (const issue of importPreview.issues) {
      const choice = choices[issue.path];
      if (issue.code === 'UNRESOLVED_ELEMENT' && typeof choice === 'string') elementByLegacyPath[String(issue.value)] = choice;
      if (issue.code === 'UNRESOLVED_RARITY' && typeof choice === 'number') rarityByLegacyValue[String(issue.value)] = choice;
    }
    const result = await persistPartialTeyvatMigration(
      importPreview.raw,
      { elementByLegacyPath, rarityByLegacyValue },
      {
        readCatalogBytes: async () => JSON.stringify(await getSaveCatalogSnapshot()),
        writeCandidateAtomically: saveMigratedTeyvatGameAtomically,
      },
    );
    if (result.status !== 'migrated') throw new Error('迁移结果仍有未决字段，未写入任何存档。');
    await refresh();
    setTab('imported');
    setImportPreview(null);
  };

  const visibleSaves = useMemo(
    () => saves.filter((save) => save.id !== deletingId && save.saveTree?.rootId !== deletingRootId),
    [deletingId, deletingRootId, saves],
  );

  const { manualSaves, autoSaves, importedSaves } = useMemo(() => {
    const manual = visibleSaves.filter((s) => s.type === 'manual');
    const auto = visibleSaves.filter((s) => s.type === 'auto');
    const imported = visibleSaves.filter((s) => s.type === 'imported');
    return { manualSaves: manual, autoSaves: auto, importedSaves: imported };
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
      .map((group) => filterSaveTreeDisplayGroup(group, (save) => matchesSaveTab(save, tab)))
      .filter((group): group is SaveTreeDisplayGroup => Boolean(group)),
    [allTreeGroups, tab],
  );
  const visibleNodeCount = useMemo(
    () => visibleTreeGroups.reduce((sum, group) => sum + group.nodeCount, 0),
    [visibleTreeGroups],
  );
  const totalBranches = allTreeGroups.reduce((sum, group) => sum + group.branchCount, 0);
  const totalSizeBytes = allTreeGroups.reduce((sum, group) => sum + group.totalSizeBytes, 0);
  const latestSave = visibleSaves[0];
  const selectedTree =
    visibleTreeGroups.find((group) => group.rootId === selectedRootId) ??
    visibleTreeGroups[0] ??
    null;

  useEffect(() => {
    if (visibleTreeGroups.length === 0) {
      if (selectedRootId !== null) setSelectedRootId(null);
      return;
    }
    if (!selectedRootId || !visibleTreeGroups.some((group) => group.rootId === selectedRootId)) {
      setSelectedRootId(visibleTreeGroups[0]?.rootId ?? null);
    }
  }, [selectedRootId, visibleTreeGroups]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <div
      className="teyvat-modal-overlay fixed inset-0 z-50 flex items-stretch justify-center p-0 md:items-center md:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
          ref={modalContentRef}
          role="dialog"
          aria-modal="true"
          aria-label="存档管理"
          inert={isMigrationPreview}
          aria-hidden={isMigrationPreview}
          tabIndex={-1}
          className="flex h-[100dvh] w-full min-w-0 max-w-[1500px] flex-col animate-slide-up md:h-[88vh] md:overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 15% 10%, rgba(var(--tj-arcane-blue), 0.18), transparent 31%), radial-gradient(circle at 85% 20%, rgba(var(--tj-accent-primary), 0.10), transparent 28%), linear-gradient(90deg, rgba(var(--tj-arcane-blue), 0.055) 1px, transparent 1px), linear-gradient(180deg, rgba(var(--tj-arcane-blue), 0.045) 1px, transparent 1px), linear-gradient(135deg, rgb(var(--tj-bg-primary)), rgb(var(--tj-bg-secondary)) 44%, rgb(var(--tj-bg-primary)))',
            backgroundSize: 'auto, auto, 44px 44px, 44px 44px, auto',
            boxShadow:
              '0 24px 70px rgba(var(--tj-shadow), 0.55), inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.28), inset 0 0 0 2px rgba(var(--tj-accent-primary), 0.04)',
            clipPath: shellClip,
          }}
        >
        <header
          className="relative flex shrink-0 items-center justify-between gap-3 overflow-hidden px-4 py-3 md:px-6"
          style={{
borderBottom: '1px solid rgba(var(--tj-border), 0.20)',
  background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary), 0.10), transparent 42%), rgba(var(--tj-surface), 0.82)',
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(110deg, transparent 0 42%, rgba(var(--tj-accent-primary), 0.12) 47%, transparent 52%), radial-gradient(circle at 76% 0%, rgba(var(--tj-accent-primary), 0.08), transparent 28%)',
            }}
          />
          <div className="relative min-w-0">
            <div className="font-serif text-[11px] tracking-[0.28em]" style={{ color: 'rgba(var(--tj-accent-primary),0.82)' }}>
              SAVE TREE CONTROL
            </div>
            <h2
              className="mt-1 min-w-0 truncate font-serif text-xl font-bold tracking-[0.22em] md:tracking-[0.32em]"
              style={{ color: 'rgba(var(--tj-accent-secondary),1)' }}
            >
              存档树控制台
            </h2>
          </div>
          <div className="relative hidden min-w-0 flex-1 justify-end gap-3 text-right font-serif text-[12px] tracking-[0.12em] md:flex">
            <span style={{ color: 'rgba(var(--tj-text-primary), 0.66)' }}>
              {latestSave ? `最新节点 #${latestSave.id} / 第 ${latestSave.turnCount} 回合` : '暂无节点'}
            </span>
            {repairingSummaries && <span style={{ color: 'rgba(var(--tj-accent-primary),0.9)' }}>索引恢复中</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative h-9 w-9 shrink-0 text-lg transition-all hover:opacity-90"
            aria-label="关闭"
            style={{
              color: 'rgba(var(--tj-text-primary),0.78)',
              background: 'rgba(var(--tj-accent-primary),0.07)',
              boxShadow: insetRing(0.18),
              clipPath: CLIP_SMALL,
            }}
          >
            ×
          </button>
        </header>

        {importPreview?.kind === 'legacy-hsr' && (
          <LegacyUniverseSaveCard
            report={importPreview.report}
            onExport={() => exportRawSave(importPreview.raw, importPreview.sourceFileName)}
          />
        )}
        {importPreview?.kind === 'teyvat' && (
          <section className="mx-4 mb-4 max-w-3xl self-center border px-4 py-5 font-serif md:px-6" style={{ background: '#f4ead1', borderColor: '#9a7747', color: '#38291e' }}>
            <p className="text-xs tracking-[0.22em]" style={{ color: '#806237' }}>提瓦特存档 · 已验证</p>
            <h3 className="mt-1 text-xl font-bold tracking-[0.12em]">准备导入</h3>
            <p className="mt-2 text-sm leading-6">已识别为提瓦特存档。点击后才会写入一个新的导入节点。</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleTeyvatImport(importPreview.state)} disabled={importing} className="min-h-11 border px-4 text-sm font-semibold disabled:opacity-50" style={{ borderColor: '#2c7068', background: '#21645d', color: '#f7efd9' }}>{importing ? '导入中…' : '导入提瓦特存档'}</button>
              <button type="button" onClick={() => setImportPreview(null)} disabled={importing} className="min-h-11 border px-4 text-sm disabled:opacity-50" style={{ borderColor: '#806237', color: '#5b452d' }}>返回</button>
            </div>
          </section>
        )}
        {importPreview?.kind === 'invalid' && (
          <section role="alert" className="mx-4 mb-4 max-w-3xl self-center border px-4 py-4 font-serif text-sm" style={{ background: '#f8e5dc', borderColor: '#a44b3e', color: '#7e2f28' }}>
            <p className="font-semibold">无法安全导入此包</p>
            <ul className="mt-2 list-disc pl-5">{importPreview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            <button type="button" onClick={() => setImportPreview(null)} className="mt-3 min-h-10 border px-3" style={{ borderColor: '#a44b3e' }}>返回</button>
          </section>
        )}

        {(chatHistory || 旅人 || worldbooks || album) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2" style={{ background: "rgba(var(--tj-accent-primary),0.04)", boxShadow: "inset 0 -1px 0 rgba(var(--tj-border),0.25)" }}>
            <span className="text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>单系统导出：</span>
            {chatHistory && chatHistory.length > 0 && (
              <>
                <button type="button" onClick={() => 下载文本文件("剧情导出.md", 导出剧情Markdown(chatHistory), "text/markdown")} className="px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--tj-accent-primary))", boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>剧情 Markdown</button>
                <button type="button" onClick={() => 下载文本文件("剧情导出.json", 导出剧情JSON(chatHistory))} className="px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--tj-accent-primary))", boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>剧情 JSON</button>
              </>
            )}
            {旅人 && <button type="button" onClick={() => 下载文本文件("角色档案.json", 导出角色档案(旅人))} className="px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--tj-accent-primary))", boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>角色档案</button>}
            {worldbooks && <button type="button" onClick={() => 下载文本文件("世界书.json", 导出世界书(worldbooks))} className="px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--tj-accent-primary))", boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>世界书</button>}
            {album && <button type="button" onClick={() => 下载文本文件("相册.json", 导出相册(album))} className="px-2.5 py-1 text-[11px]" style={{ color: "rgb(var(--tj-accent-primary))", boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>相册</button>}
          </div>
        )}

        {allTreeGroups.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 overflow-x-auto px-4 py-2" style={{ background: "rgba(var(--tj-bg-primary),0.45)", boxShadow: "inset 0 -1px 0 rgba(var(--tj-border),0.25)" }}>
            {allTreeGroups.map((group) => {
              const timeline = buildSaveTreeTimeline(group);
              return (
                <div key={group.rootId} className="flex items-center gap-1">
                  <span className="mr-1 text-[10px]" style={{ color: "rgba(var(--tj-text-secondary),0.65)" }}>{group.rootSave.travelerName || '存档树'}</span>
                  {timeline.map((node) => (
                    <span key={node.nodeId} className="flex items-center gap-1">
                      <span title={`第 ${node.turnCount} 回合`} style={{ width: 8, height: 8, borderRadius: '50%', background: node.isLatest ? 'rgb(var(--tj-accent-primary))' : node.isBranchPoint ? 'rgba(var(--tj-accent-secondary),0.9)' : 'rgba(var(--tj-text-secondary),0.35)' }} />
                      {node.isBranchPoint && <span className="text-[9px]" style={{ color: "rgba(var(--tj-accent-secondary),0.8)" }}>分叉</span>}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[320px_minmax(0,1fr)_270px] md:overflow-hidden">
          <aside
            className="hidden w-full flex-shrink-0 flex-col md:flex md:min-h-0 md:w-auto md:flex-col md:gap-4 md:overflow-y-auto md:px-5 md:py-5 md:pb-6 md:pr-4"
            style={{
              borderRight: '1px solid rgba(var(--tj-accent-primary),0.18)',
              background: 'radial-gradient(circle at 0 0, rgba(var(--tj-accent-primary),0.12), transparent 34%), rgba(var(--tj-bg-primary), 0.62)',
            }}
          >
            <div className="flex flex-col gap-4">
              <div className="grid gap-2">
                <SaveActionButton primary onClick={handleSave} disabled={saving}>
                  {saving ? '保存中' : '保存新节点'}
                </SaveActionButton>
                <SaveActionButton onClick={handleImport} disabled={importing}>
                  {importing ? '导入中' : '导入存档包'}
                </SaveActionButton>
                <SaveActionButton onClick={handleExportCurrent} disabled={saving}>
                  导出当前节点
                </SaveActionButton>
                <SaveActionButton warn onClick={handleRepairList} disabled={loading}>
                  {loading ? '修复中' : '修复存档索引'}
                </SaveActionButton>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <SaveMetric value={saves.length} label="总节点" />
                <SaveMetric value={totalBranches} label="分支" />
                <SaveMetric value={autoSaves.length} label="自动" />
                <SaveMetric value={importedSaves.length} label="导入" />
              </div>

              <div className="mt-4">
                <MiniSaveTreeMap
                  nodeCount={saves.length}
                  branchCount={totalBranches}
                  sizeText={formatByteSize(totalSizeBytes)}
                />
              </div>

              <div
                className="mt-4 px-3 py-3 font-serif text-[12px] leading-relaxed tracking-wider"
                style={{
                  color: 'rgba(var(--tj-text-primary),0.82)',
                  background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.52), rgba(var(--tj-accent-secondary),0.48))',
                  boxShadow: insetRing(0.14),
                  clipPath: CLIP_CARD,
                }}
              >
                <div className="mb-1.5 text-[11px] tracking-[0.22em]" style={{ color: 'rgba(var(--tj-accent-primary),0.86)' }}>
                  存档策略
                </div>
                <div>存档树数量不限，不会因树数量清理旧存档</div>
                <div>每棵树手动节点最多 5 个、自动节点最多 6 个</div>
                <div>导入存档不计入手动上限</div>
                <div>历史恢复点已停止新建，可在列表中手动清理</div>
                <div>读取节点后继续保存会生成新分支</div>
                <div>整树导出会带走当前旅程分叉</div>
              </div>

              <div className="flex-1" />

              <div className="mt-4 text-center font-serif text-[12px] tracking-[0.22em]" style={{ color: 'rgba(var(--tj-text-primary),0.46)' }}>
                共 {saves.length} 节点 / {allTreeGroups.length} 棵树
                {repairingSummaries ? ` / 正在恢复 ${pendingSummaryCount} 个节点目录` : ''}
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-col md:min-h-0 md:flex-1 md:overflow-hidden">
            <div className="md:hidden flex flex-col">
              <div className="flex gap-1.5 px-3 pb-1.5 pt-2.5">
                <SaveActionButton primary size="sm" onClick={handleSave} disabled={saving} className="flex-1 min-w-0">
                  {saving ? '保存中' : '保存'}
                </SaveActionButton>
                <SaveActionButton size="sm" onClick={handleImport} disabled={importing} className="flex-1 min-w-0">
                  {importing ? '导入中' : '导入'}
                </SaveActionButton>
                <SaveActionButton size="sm" onClick={handleExportCurrent} disabled={saving} className="flex-1 min-w-0">
                  导出
                </SaveActionButton>
                <SaveActionButton warn size="sm" onClick={handleRepairList} disabled={loading} className="flex-1 min-w-0">
                  {loading ? '修复中' : '修复'}
                </SaveActionButton>
              </div>
              {visibleTreeGroups.length > 0 && (
                <div
                  className="mx-3 mb-2 overflow-hidden font-serif"
                  style={{
                    background: 'linear-gradient(180deg, rgba(var(--tj-accent-primary),0.075), rgba(0,0,0,0.18))',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16), 0 0 24px rgba(0,0,0,0.18)',
                    clipPath: CLIP_CARD,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
                    <h3 className="text-[11px] font-medium tracking-[0.22em]" style={{ color: 'rgba(var(--tj-accent-primary),0.86)' }}>
                      存档树列表
                    </h3>
                    <span className="text-[10px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
                      横向滚动切换
                    </span>
                  </div>
                  <div className="overflow-x-auto px-3 pb-2.5 no-scrollbar">
                    <div className="flex gap-2 w-max">
                      {visibleTreeGroups.map((group) => {
                        const active = group.rootId === selectedTree?.rootId;
                        const title = group.latestSave.travelerName || group.rootSave.travelerName || '未命名旅人';
                        return (
                          <button
                            key={group.rootId}
                            type="button"
                            onClick={() => setSelectedRootId(group.rootId)}
                            className="w-[155px] shrink-0 cursor-pointer px-2.5 py-2 text-left transition-all"
                            style={{
                              background: active
                                ? 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.18), rgba(var(--tj-accent-primary), 0.06))'
                                : 'rgba(var(--tj-accent-primary),0.045)',
                              boxShadow: active
                                ? 'inset 3px 0 0 rgba(var(--tj-accent-primary),1), inset 0 0 0 1px rgba(var(--tj-accent-primary),0.32)'
                                : insetRing(0.12),
                              clipPath: CLIP_SMALL,
                            }}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-1">
                              <span className="truncate text-[12px] font-semibold tracking-[0.1em]" style={{ color: active ? 'rgba(var(--tj-accent-secondary),1)' : 'rgba(var(--tj-text-primary),0.78)' }}>
                                {title}
                              </span>
                              <span className="shrink-0 text-[10px]" style={{ color: active ? 'rgba(var(--tj-accent-primary),1)' : 'rgba(var(--tj-text-primary),0.42)' }}>
                                #{group.latestSave.id}
                              </span>
                            </div>
                            <div className="mt-0.5 flex gap-2 text-[10px] tracking-[0.08em]" style={{ color: 'rgba(var(--tj-text-primary),0.54)' }}>
                              <span>{group.nodeCount}节点</span>
                              <span>{group.branchCount}分支</span>
                              <span>第{group.latestSave.turnCount}回合</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div
              className="flex flex-shrink-0 flex-col gap-2 px-3 pb-2 pt-3 md:px-5 md:pb-3 md:pt-4 lg:flex-row lg:items-center lg:justify-between"
              style={{ borderBottom: '1px solid rgba(var(--tj-accent-primary),0.14)' }}
            >
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                <TabButton label="全部" count={visibleSaves.length} active={tab === 'all'} onClick={() => setTab('all')} />
                <TabButton label="手动" count={manualSaves.length} active={tab === 'manual'} onClick={() => setTab('manual')} />
                <TabButton label="自动" count={autoSaves.length} active={tab === 'auto'} onClick={() => setTab('auto')} />
                <TabButton label="导入" count={importedSaves.length} active={tab === 'imported'} onClick={() => setTab('imported')} />
              </div>
              <div className="font-serif text-[12px] tracking-[0.12em] md:block hidden" style={{ color: 'rgba(var(--tj-text-primary),0.58)' }}>
                当前视图：{visibleTreeGroups.length} 棵树 / {visibleNodeCount} 节点
                {selectedTree ? ` / 当前树 #${selectedTree.latestSave.id}` : ''}
              </div>
            </div>

            <div className="teyvat-options-scroll relative overflow-x-hidden px-4 py-4 pb-7 md:min-h-0 md:flex-1 md:overflow-y-auto md:px-5">
              {loading && saves.length === 0 && <EmptyState text="加载中..." />}

              {repairingSummaries && (
                <div
                  className="mb-3 px-3 py-2 text-center font-serif text-[12px] tracking-[0.14em]"
                  style={{
                    color: 'rgba(var(--tj-accent-primary),0.92)',
                    background: 'rgba(var(--tj-accent-primary),0.08)',
                    boxShadow: insetRing(0.18),
                    clipPath: CLIP_SMALL,
                  }}
                >
                  {repairState.phase === 'paused-for-write'
                    ? '索引恢复已暂停，正在优先保存或删除'
                    : `正在恢复节点详情 ${repairState.processed} / ${Math.max(repairState.total, pendingSummaryCount)}`}
                </div>
              )}

              {!repairingSummaries && unreadableSummaryCount > 0 && (
                <div
                  className="mb-3 px-3 py-2 text-center font-serif text-[12px] tracking-[0.12em]"
                  style={{
                    color: 'rgba(var(--tj-danger),0.9)',
                    background: 'rgba(var(--tj-danger),0.08)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.2)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  {unreadableSummaryCount} 个节点详情读取失败，可使用“修复存档索引”重试
                </div>
              )}

              {legacyBackups.length > 0 && (
                <LegacyBackupSection
                  backups={legacyBackups}
                  loadingId={loadingId}
                  deletingId={deletingId}
                  deletingAll={deletingLegacyBackups}
                  onLoad={handleLoad}
                  onDelete={handleDelete}
                  onExport={handleExport}
                  onDeleteAll={handleDeleteLegacyBackups}
                  formatTime={formatTime}
                />
              )}

              {!loading && loadError && (
                <div
                  className="p-5 text-center font-serif"
                  style={{
                    background: 'rgba(var(--tj-danger), 0.28)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger), 0.25)',
                    clipPath: CLIP_CARD,
                  }}
                >
                  <div className="text-sm tracking-[0.18em]" style={{ color: 'rgba(var(--tj-danger),0.92)' }}>
                    存档列表读取失败
                  </div>
                  <div className="mt-2 text-xs leading-relaxed tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.72)' }}>
                    {loadError}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <SaveActionButton onClick={refresh}>重新读取</SaveActionButton>
                    <SaveActionButton primary onClick={handleRepairList} disabled={loading}>
                      修复摘要
                    </SaveActionButton>
                  </div>
                </div>
              )}

              {!loading && !loadError && visibleTreeGroups.length === 0 && (
                <EmptyState
                  text={
                    tab === 'manual'
                      ? '暂无手动存档'
                      : tab === 'auto'
                        ? '暂无自动存档'
                        : tab === 'imported'
                          ? '暂无导入存档'
                          : '暂无存档'
                  }
                  detail={
                    tab === 'manual'
                      ? '点击左侧“保存新节点”留下第一道印记。'
                      : '推进旅程后，新的节点会显示在这里。'
                  }
                />
              )}

              {selectedTree && (
                <div className="space-y-4">
                  <SaveTreeGroup
                    key={selectedTree.rootId}
                    group={selectedTree}
                    loadingId={loadingId}
                    deletingId={deletingId}
                    deletingRootId={deletingRootId}
                    onLoad={handleLoad}
                    onDelete={handleDelete}
                    onExport={handleExport}
                    onExportTree={handleExportTree}
                    onDeleteTree={handleDeleteTree}
                    catalogComplete={catalogComplete}
                    formatTime={formatTime}
                  />
                </div>
              )}
            </div>
          </main>

          <aside
            className="hidden min-h-0 min-w-0 flex-col px-4 py-4 md:flex md:px-4 md:py-5"
            style={{
              borderLeft: '1px solid rgba(var(--tj-accent-primary),0.18)',
              background: 'radial-gradient(circle at 100% 0, rgba(var(--tj-accent-primary),0.10), transparent 36%), rgba(var(--tj-panel-bg-end),0.48)',
            }}
          >
            <SaveTreeSelector
              groups={visibleTreeGroups}
              selectedRootId={selectedTree?.rootId ?? null}
              onSelect={setSelectedRootId}
            />
          </aside>
        </div>
      </div>
      </div>
      {isMigrationPreview && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/45 p-3 md:p-6">
          <SaveMigrationDialog
            issues={importPreview.issues}
            report={importPreview.report}
            sourceBackupId={importPreview.backupId}
            backupError={importPreview.backupError}
            onConfirm={handleMigrationConfirm}
            onCancel={() => setImportPreview(null)}
          />
        </div>,
        document.body,
      )}
      <ConfirmDialogHost dialog={confirmDialog} />
    </>
  );
}

function SaveActionButton({
  children,
  primary = false,
  warn = false,
  danger = false,
  disabled,
  onClick,
  className = '',
  size = 'md',
}: {
  children: ReactNode;
  primary?: boolean;
  warn?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  // 用 size prop 区分尺寸,避免 PC 默认 padding 与 mobile 传入的 px-2 py-2 在 Tailwind 里冲突
  // (Tailwind 中 px-4 的 CSS 定义在 px-2 之后,会覆盖 mobile 的值)。
  const sizeClass = size === 'sm' ? 'px-2.5 py-2 text-[11px]' : 'px-4 py-3 text-[12px]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer font-serif ${sizeClass} font-semibold tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{
        color: primary ? 'rgba(var(--tj-surface-bg-start),1)' : danger ? 'rgba(var(--tj-danger),0.92)' : warn ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-primary),0.76)',
        background: primary
          ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),1))'
          : danger
            ? 'rgba(var(--tj-danger),0.07)'
          : warn
            ? 'rgba(var(--tj-accent-primary),0.06)'
            : 'rgba(var(--tj-accent-primary),0.07)',
        boxShadow: primary
          ? 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.55), 0 0 20px rgba(var(--tj-arcane-blue), 0.24)'
          : danger
            ? 'inset 0 0 0 1px rgba(var(--tj-danger),0.28)'
          : warn
            ? insetRing(0.28)
            : insetRing(0.18),
        clipPath: CLIP_SMALL,
      }}
    >
      {children}
    </button>
  );
}

function SaveMetric({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="px-3 py-3 font-serif"
      style={{
        background: 'rgba(var(--tj-accent-primary),0.055)',
        boxShadow: insetRing(0.13),
        clipPath: CLIP_SMALL,
      }}
    >
      <b className="block text-[21px] leading-none tracking-[0.04em]" style={{ color: 'rgba(var(--tj-accent-primary),1)' }}>
        {value}
      </b>
      <span className="mt-1 block text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
        {label}
      </span>
    </div>
  );
}

function MiniSaveTreeMap({
  nodeCount,
  branchCount,
  sizeText,
}: {
  nodeCount: number;
  branchCount: number;
  sizeText: string;
}) {
  return (
    <div
      className="col-span-2 min-h-[170px] px-3 py-3 font-serif"
      style={{
        background: 'rgba(0,0,0,0.20)',
        boxShadow: insetRing(0.12),
        clipPath: CLIP_CARD,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium tracking-[0.22em]" style={{ color: 'rgba(var(--tj-accent-primary),0.86)' }}>
          当前存档树
        </h3>
        <span className="text-[11px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
          {sizeText}
        </span>
      </div>
      <div className="relative h-[112px]">
        <MiniLine left={26} top={24} width={88} rotate={20} />
        <MiniLine left={105} top={55} width={88} rotate={-18} />
        <MiniLine left={105} top={55} width={68} rotate={42} />
        <MiniDot left={22} top={20} />
        <MiniDot left={102} top={50} />
        <MiniDot left={190} top={25} gold />
        <MiniDot left={167} top={101} />
      </div>
      <div className="flex flex-wrap gap-2">
        <SmallTag>{nodeCount} 节点</SmallTag>
        <SmallTag gold>{branchCount} 分支</SmallTag>
      </div>
    </div>
  );
}

function MiniLine({ left, top, width, rotate }: { left: number; top: number; width: number; rotate: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute h-px"
      style={{
        left,
        top,
        width,
        transform: `rotate(${rotate}deg)`,
        transformOrigin: 'left center',
        background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.36), rgba(var(--tj-accent-secondary),0.3))',
      }}
    />
  );
}

function MiniDot({ left, top, gold = false }: { left: number; top: number; gold?: boolean }) {
  return (
    <i
      aria-hidden="true"
      className="absolute h-[9px] w-[9px] rounded-full"
      style={{
        left,
        top,
        background: gold ? 'linear-gradient(135deg, rgb(var(--tj-accent-primary)), rgb(var(--tj-accent-secondary)))' : 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),1))',
        boxShadow: gold ? '0 0 14px rgba(var(--tj-accent-primary),0.72)' : '0 0 16px rgba(var(--tj-accent-primary),.8)',
      }}
    />
  );
}

function SaveTreeSelector({
  groups,
  selectedRootId,
  onSelect,
}: {
  groups: SaveTreeDisplayGroup[];
  selectedRootId: string | null;
  onSelect: (rootId: string) => void;
}) {
  return (
    <div
      className="teyvat-options-scroll min-h-0 flex-1 px-3 py-3 pb-5 font-serif md:overflow-y-auto"
      style={{
        background: 'linear-gradient(180deg, rgba(var(--tj-accent-primary),0.075), rgba(0,0,0,0.18))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16), 0 0 24px rgba(0,0,0,0.18)',
        clipPath: CLIP_CARD,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium tracking-[0.22em]" style={{ color: 'rgba(var(--tj-accent-primary),0.86)' }}>
          存档树列表
        </h3>
        <span className="text-[11px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
          点击切换路线
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="py-3 text-center text-[12px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-primary),0.46)' }}>
          暂无可选存档树
        </div>
      ) : (
        <div className="grid gap-2">
          {groups.map((group) => {
            const active = group.rootId === selectedRootId;
            const title = group.latestSave.travelerName || group.rootSave.travelerName || '未命名旅人';
            return (
              <button
                key={group.rootId}
                type="button"
                onClick={() => onSelect(group.rootId)}
                className="min-w-0 cursor-pointer px-3 py-2 text-left transition-all hover:opacity-90"
                style={{
                  background: active
                    ? 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.18), rgba(var(--tj-accent-primary), 0.06))'
                    : 'rgba(var(--tj-accent-primary),0.045)',
                  boxShadow: active
                    ? 'inset 3px 0 0 rgba(var(--tj-accent-primary),1), inset 0 0 0 1px rgba(var(--tj-accent-primary),0.32)'
                    : insetRing(0.12),
                  clipPath: CLIP_SMALL,
                }}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold tracking-[0.12em]" style={{ color: active ? 'rgba(var(--tj-accent-secondary),1)' : 'rgba(var(--tj-text-primary),0.78)' }}>
                    {title}
                  </span>
                  <span className="shrink-0 text-[11px]" style={{ color: active ? 'rgba(var(--tj-accent-primary),1)' : 'rgba(var(--tj-text-primary),0.42)' }}>
                    #{group.latestSave.id}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] tracking-[0.1em]" style={{ color: 'rgba(var(--tj-text-primary),0.54)' }}>
                  <span>{group.nodeCount} 节点</span>
                  <span>{group.branchCount} 分支</span>
                  <span>第 {group.latestSave.turnCount} 回合</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabButton({
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
      className="cursor-pointer px-3 py-2 font-serif text-[12px] tracking-[0.16em] transition-all md:px-4 md:text-[13px] md:tracking-[0.24em]"
      style={{
        color: active ? 'rgba(var(--tj-surface-bg-start),1)' : 'rgba(var(--tj-text-primary),0.70)',
        background: active ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),1))' : 'rgba(var(--tj-accent-primary),0.05)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-surface-bg-start), 0.55), 0 0 24px rgba(var(--tj-accent-primary), 0.28)'
          : insetRing(0.15),
        clipPath: CLIP_SMALL,
      }}
    >
      {label}
      <span className="ml-2 text-[11px]" style={{ color: active ? 'rgba(var(--tj-panel-bg-start),0.66)' : 'rgba(var(--tj-text-primary),0.46)' }}>
        {count}
      </span>
    </button>
  );
}

function LegacyBackupSection({
  backups,
  loadingId,
  deletingId,
  deletingAll,
  onLoad,
  onDelete,
  onExport,
  onDeleteAll,
  formatTime,
}: {
  backups: SaveListItemSummary[];
  loadingId: number | null;
  deletingId: number | null;
  deletingAll: boolean;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  onExport: (id: number) => void;
  onDeleteAll: () => void;
  formatTime: (ts: number) => string;
}) {
  return (
    <details
      className="mb-4 overflow-hidden"
      style={{
        background: 'rgba(var(--tj-accent-primary),0.045)',
        boxShadow: insetRing(0.16),
        clipPath: CLIP_CARD,
      }}
    >
      <summary className="cursor-pointer px-4 py-3 font-serif text-[13px] tracking-[0.14em]" style={{ color: 'rgba(var(--tj-accent-secondary),0.92)' }}>
        历史恢复点 {backups.length} 个
      </summary>
      <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: 'rgba(var(--tj-accent-primary),0.12)' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] leading-relaxed tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.6)' }}>
          <span>这是旧版本读档前自动生成的恢复点。系统已停止新建，清理与否由你决定。</span>
          <SaveActionButton danger onClick={onDeleteAll} disabled={deletingAll || loadingId !== null || deletingId !== null}>
            {deletingAll ? '清理中' : '清理全部旧恢复点'}
          </SaveActionButton>
        </div>
        <div className="space-y-3 pl-6">
          {backups.map((backup, index) => (
            <SaveRow
              key={backup.id}
              item={backup}
              loadingId={loadingId}
              deletingId={deletingId}
              onLoad={onLoad}
              onDelete={onDelete}
              onExport={onExport}
              formatTime={formatTime}
              treeLabel="旧恢复点"
              depth={0}
              visualLevel={index}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function SaveTreeGroup({
  group,
  loadingId,
  deletingId,
  deletingRootId,
  onLoad,
  onDelete,
  onExport,
  onExportTree,
  onDeleteTree,
  catalogComplete,
  formatTime,
}: {
  group: SaveTreeDisplayGroup;
  loadingId: number | null;
  deletingId: number | null;
  deletingRootId: string | null;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  onExport: (id: number) => void;
  onExportTree: (rootId: string) => void;
  onDeleteTree: (rootId: string, nodeCount: number) => void;
  catalogComplete: boolean;
  formatTime: (ts: number) => string;
}) {
  return (
    <section
      className="min-w-0 overflow-hidden p-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-panel-bg-start),0.52), rgba(var(--tj-panel-bg-end),0.56))',
        boxShadow: insetRing(0.18),
        clipPath: CLIP_CARD,
      }}
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3 font-serif">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="text-[11px] tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),1)' }}>
              存档树
            </span>
            <span className="truncate text-[15px] font-semibold tracking-wider" style={{ color: 'rgba(var(--tj-accent-secondary),1)' }}>
              {group.latestSave.travelerName || group.rootSave.travelerName || '未命名旅人'}
            </span>
            <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
              最新 #{group.latestSave.id}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.58)' }}>
            <span>{group.nodeCount} 个节点</span>
            <span>{group.branchCount} 个分支</span>
            <span>{formatByteSize(group.totalSizeBytes)}</span>
            <span>第 {group.latestSave.turnCount} 回合</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveActionButton onClick={() => onExportTree(group.rootId)} disabled={loadingId !== null || deletingRootId !== null || deletingId !== null}>
            导出整树
          </SaveActionButton>
          <SaveActionButton onClick={() => onDeleteTree(group.rootId, group.nodeCount)} disabled={!catalogComplete || loadingId !== null || deletingRootId !== null || deletingId !== null} danger>
            {deletingRootId === group.rootId ? '删除中' : catalogComplete ? '删除整树' : '目录恢复后可删'}
          </SaveActionButton>
        </div>
      </div>

      <div className="relative space-y-3 pl-6">
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-[10px] top-2 w-px"
          style={{ background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),0.92))' }}
        />
        {group.nodes.map((node, index) => (
          <SaveRow
            key={node.save.id}
            item={node.save}
            loadingId={loadingId}
            deletingId={deletingId}
            onLoad={onLoad}
            onDelete={onDelete}
            onExport={onExport}
            formatTime={formatTime}
            treeLabel={node.isRoot ? '根节点' : `分支 +${node.depth}`}
            isLatest={node.isLatest}
            depth={node.depth}
            visualLevel={index}
          />
        ))}
      </div>
    </section>
  );
}

function SaveRow({
  item,
  loadingId,
  deletingId,
  onLoad,
  onDelete,
  onExport,
  formatTime,
  treeLabel,
  isLatest = false,
  depth,
  visualLevel,
}: {
  item: SaveListItemSummary;
  loadingId: number | null;
  deletingId: number | null;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  onExport: (id: number) => void;
  formatTime: (ts: number) => string;
  treeLabel?: string;
  isLatest?: boolean;
  depth: number;
  visualLevel: number;
}) {
  const visualIndent = Math.min(visualLevel, 5) * 14;
  return (
    <article
      className={`relative grid min-w-0 gap-3 md:grid-cols-[1fr_auto] md:items-center ${
        isLatest ? 'p-4 md:gap-4' : 'p-3'
      }`}
      style={{
        marginLeft: visualIndent,
        background: isLatest
          ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.18), rgba(var(--tj-accent-primary),0.09)), rgba(var(--tj-panel-bg-start),0.92)'
          : 'rgba(var(--tj-panel-bg-start),0.74)',
        boxShadow: isLatest
          ? 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.46), inset 0 0 0 2px rgba(var(--tj-accent-primary),0.08), 0 0 28px rgba(var(--tj-accent-primary),0.10), 0 0 22px rgba(var(--tj-accent-primary),0.08)'
          : insetRing(0.18),
        clipPath: CLIP_CARD,
      }}
    >
      <span
        aria-hidden="true"
        className={`absolute left-[-22px] rounded-full ${isLatest ? 'top-6 h-[14px] w-[14px]' : 'top-5 h-[11px] w-[11px]'}`}
        style={{
          background: isLatest ? 'linear-gradient(135deg, rgb(var(--tj-accent-primary)), rgb(var(--tj-accent-secondary)))' : 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),1))',
          boxShadow: isLatest ? '0 0 18px rgba(var(--tj-accent-primary),0.82), 0 0 28px rgba(var(--tj-accent-primary),0.28)' : '0 0 16px rgba(var(--tj-accent-primary),0.78)',
        }}
      />
      {depth > 0 && (
        <span
          aria-hidden="true"
          className={`absolute left-[-16px] h-px ${isLatest ? 'top-[31px]' : 'top-[25px]'}`}
          style={{
            width: 16 + visualIndent,
            background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.36), rgba(var(--tj-accent-primary),0.05))',
          }}
        />
      )}

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className={`font-serif tracking-[0.18em] ${isLatest ? 'text-[12px]' : 'text-[11px]'}`} style={{ color: typeColor(item.type) }}>
            {typeLabel(item.type)}
          </span>
          <span className={`truncate font-serif font-semibold tracking-wider ${isLatest ? 'text-[17px]' : 'text-[15px]'}`} style={{ color: 'rgba(var(--tj-accent-secondary),1)' }}>
            {item.travelerName || '未命名旅人'}
          </span>
          <span className="font-serif text-[11px] tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
            #{item.id}
          </span>
          {treeLabel && <SmallTag>{treeLabel}</SmallTag>}
          {isLatest && <SmallTag gold>最新</SmallTag>}
        </div>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 font-serif tracking-wider ${isLatest ? 'mt-2 text-[13px]' : 'mt-1 text-[12px]'}`} style={{ color: 'rgba(var(--tj-text-primary),0.78)' }}>
          <span style={{ color: 'rgba(var(--tj-accent-primary),1)' }}>第 {item.turnCount} 回合</span>
          {(item.currentDate || item.currentTime || item.currentLocation) && (
            <>
              <span style={{ color: 'rgba(var(--tj-text-primary),0.28)' }}>/</span>
              <span>{[item.currentDate, item.currentTime, item.currentLocation].filter(Boolean).join(' / ')}</span>
            </>
          )}
          {item.worldPeriodName && (
            <>
              <span style={{ color: 'rgba(var(--tj-text-primary),0.28)' }}>/</span>
              <span>{item.worldPeriodName}</span>
            </>
          )}
          <span style={{ color: 'rgba(var(--tj-text-primary),0.28)' }}>/</span>
          <span style={{ color: 'rgba(var(--tj-text-primary),0.56)' }}>{formatTime(item.timestamp)}</span>
          <span style={{ color: 'rgba(var(--tj-text-primary),0.28)' }}>/</span>
          <span style={{ color: 'rgba(var(--tj-text-primary),0.56)' }}>{formatByteSize(item.sizeBytes)}</span>
        </div>
        {item.lastSummary && (
          <div className={`font-serif leading-relaxed ${isLatest ? 'mt-2 line-clamp-3 text-[13px]' : 'mt-1 line-clamp-2 text-[12px]'}`} style={{ color: 'rgba(var(--tj-text-primary),0.62)' }}>
            {item.lastSummary}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 md:flex md:flex-shrink-0">
        <button
          type="button"
          onClick={() => onLoad(item.id)}
          disabled={loadingId !== null}
          className={`cursor-pointer font-serif font-semibold tracking-wider transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
            isLatest ? 'px-4 py-2.5 text-[13px]' : 'px-3 py-2 text-xs'
          }`}
          style={{
            background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),1), rgba(var(--tj-accent-secondary),1))',
            color: 'rgba(var(--tj-surface-bg-start),1)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-surface-bg-start), 0.55), 0 0 18px rgba(var(--tj-accent-primary), 0.20)',
            clipPath: CLIP_SMALL,
          }}
        >
          {loadingId === item.id ? '读取中' : '读取'}
        </button>
        <button
          type="button"
          onClick={() => onExport(item.id)}
          disabled={loadingId !== null}
          className="cursor-pointer px-2.5 py-2 text-xs font-serif tracking-wider transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            color: 'rgba(var(--tj-accent-primary),0.92)',
            boxShadow: insetRing(0.28),
            clipPath: CLIP_SMALL,
          }}
        >
          导出
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          disabled={loadingId !== null || deletingId !== null}
          className="cursor-pointer px-2.5 py-2 text-xs font-serif tracking-wider transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            color: 'rgba(var(--tj-danger),0.9)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.28)',
            clipPath: CLIP_SMALL,
          }}
        >
          {deletingId === item.id ? '删除中' : '删除'}
        </button>
      </div>
    </article>
  );
}

function SmallTag({ children, gold = false }: { children: ReactNode; gold?: boolean }) {
  return (
    <span
      className="px-1.5 py-0.5 font-serif text-[10px] tracking-[0.12em]"
      style={{
        color: gold ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-accent-primary),1)',
        background: gold ? 'rgba(var(--tj-accent-primary),0.08)' : 'rgba(var(--tj-accent-primary),0.08)',
        boxShadow: gold ? insetRing(0.16) : insetRing(0.16),
        clipPath: CLIP_SMALL,
      }}
    >
      {children}
    </span>
  );
}

function EmptyState({ text, detail }: { text: string; detail?: string }) {
  return (
    <div
      className="p-6 text-center font-serif"
      style={{
        background: 'rgba(var(--tj-panel-bg-start),0.46)',
        boxShadow: insetRing(0.15),
        clipPath: CLIP_CARD,
      }}
    >
      <p className="text-sm tracking-[0.2em]" style={{ color: 'rgba(var(--tj-text-primary),0.86)' }}>
        {text}
      </p>
      {detail && (
        <p className="mt-1.5 text-xs tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.56)' }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function typeLabel(type: SaveListItemSummary['type']): string {
  if (type === 'auto') return '自动';
  if (type === 'backup') return '恢复点';
  if (type === 'imported') return '导入';
  return '手动';
}

function typeColor(type: SaveListItemSummary['type']): string {
  if (type === 'auto') return 'rgba(var(--tj-accent-primary),0.86)';
  if (type === 'backup') return 'rgba(var(--tj-accent-secondary),0.9)';
  if (type === 'imported') return 'rgba(var(--tj-ui-success),0.9)';
  return 'rgba(var(--tj-accent-primary),0.9)';
}

function matchesSaveTab(save: SaveListItemSummary, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'manual') return save.type === 'manual';
  if (tab === 'auto') return save.type === 'auto';
  return save.type === 'imported';
}

async function previewImportFile(file: File): Promise<ImportPreview> {
  if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
    const sourceJsonBytes = await file.text();
    const raw = JSON.parse(sourceJsonBytes) as unknown;
    return previewClassifiedRecord(raw, file.name, sourceJsonBytes);
  }
  if (!file.name.toLowerCase().endsWith('.ktysave') && !file.name.toLowerCase().endsWith('.zip') && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
    return { kind: 'invalid', errors: ['不支持的存档格式，请选择 .ktysave、.zip 或 .json。'] };
  }
  const parsed = await parseSavePackageByUniverse(await file.arrayBuffer());
  return previewParsedPackage(parsed, file.name);
}

async function previewParsedPackage(parsed: ParsedSavePackage, sourceFileName: string): Promise<ImportPreview> {
  if (parsed.kind === 'invalid') return { kind: 'invalid', errors: parsed.errors };
  if (parsed.kind === 'teyvat') {
    if (parsed.manifest.kind === 'save-tree-package') return { kind: 'invalid', errors: ['当前版本无法逐节点验证存档树，已拒绝安全导入此包。'] };
    return { kind: 'teyvat', state: parsed.save, sourceFileName };
  }
  if (parsed.kind === 'legacy-hsr') {
    return { kind: 'legacy-hsr', raw: parsed.raw, sourceFileName };
  }
  if (parsed.kind === 'partial-teyvat') return previewPartialRecord(parsed.raw, parsed.migration, sourceFileName, parsed.sourceJsonBytes, parsed.sourceBackupRaw);
  return { kind: 'invalid', errors: ['无法安全识别存档包类型。'] };
}

async function previewClassifiedRecord(raw: unknown, sourceFileName: string, sourceJsonBytes: string): Promise<ImportPreview> {
  const classified = classifyAndMigrateDbSaveRecord(raw, {});
  if (classified.kind === 'invalid') return { kind: 'invalid', errors: classified.errors };
  if (classified.kind === 'legacy-hsr') return { kind: 'legacy-hsr', raw: classified.raw, report: classified.report, sourceFileName };
  if (classified.kind === 'teyvat') return { kind: 'teyvat', state: classified.state, sourceFileName };
  return previewPartialRecord(raw, { status: 'needs-input', issues: classified.issues, report: classified.report }, sourceFileName, sourceJsonBytes, raw);
}

async function previewPartialRecord(
  raw: unknown,
  migration: ReturnType<typeof migratePartialTeyvatSave>,
  sourceFileName: string,
  sourceJsonBytes: string,
  sourceBackupRaw: unknown,
): Promise<ImportPreview> {
  if (migration.status === 'invalid') return { kind: 'invalid', errors: migration.errors };
  if (migration.status === 'legacy-universe') return { kind: 'legacy-hsr', raw: migration.raw, report: migration.report, sourceFileName };
  try {
    const backup = await createRawMigrationBackup(sourceBackupRaw, sourceFileName, sourceJsonBytes);
    return {
      kind: 'partial-teyvat', raw, sourceBackupRaw, sourceJsonBytes, issues: migration.status === 'needs-input' ? migration.issues : [], report: migration.report,
      sourceFileName, backupId: backup.backupId,
    };
  } catch (cause) {
    return {
      kind: 'partial-teyvat', raw, sourceBackupRaw, sourceJsonBytes, issues: migration.status === 'needs-input' ? migration.issues : [], report: migration.report,
      sourceFileName, backupError: cause instanceof Error ? cause.message : '无法创建原档备份。',
    };
  }
}
