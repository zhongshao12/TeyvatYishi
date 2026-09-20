import { CLIP_MEDIUM, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import type {
  DesktopAppInfo,
  DesktopProbeResult,
  DesktopUpdateProgress,
  DesktopUpdateStatus,
} from '@/services/desktop/desktopBridge';
import type {
  DesktopDiagnosticReport,
  DesktopDiagnosticReportResult,
  DesktopDiagnosticReportSummary,
} from '@/services/desktop/desktopDiagnostics';
import type { DesktopReleaseInfo } from '@/services/desktop/desktopReleaseInfo';
import type {
  DesktopAssetMaintenanceSummary,
  DesktopAssetMirrorHealth,
} from '@/services/desktop/desktopAssetMirror';
import type {
  DesktopSaveBackupRecord,
  DesktopSaveBackupSummary,
} from '@/services/desktop/desktopSaveBackup';
import type {
  DesktopMigrationBackupPreview,
  DesktopMigrationBackupSummary,
} from '@/services/desktop/desktopMigrationBackup';
import type { DesktopSaveDeltaMirrorHealth } from '@/services/desktop/desktopSaveDeltaMirror';
import type { DesktopSaveMirrorHealth } from '@/services/desktop/desktopSaveMirror';
import type { RuntimePlatform } from '@/utils/platform/desktopRuntime';
import { formatByteSize } from '@/utils/formatByteSize';

export function DesktopStorageStatus({
  platform,
  info,
  releaseInfo,
  probe,
  error,
  checking,
  update,
  updateProgress,
  updateError,
  checkingUpdate,
  installingUpdate,
  desktopMirrorCount,
  desktopConfigCount,
  desktopAssetCount,
  desktopAssetSummary,
  desktopSaveMirrorHealth,
  desktopSaveDeltaMirrorHealth,
  desktopAssetMirrorHealth,
  desktopBackupCount,
  desktopMigrationBackupCount,
  unreadableDesktopMigrationBackupCount,
  latestDesktopBackup,
  desktopMigrationBackupPreview,
  desktopBackups,
  selectedDesktopBackup,
  restoringDesktopMirror,
  restoringDesktopBackup,
  deletingDesktopBackupPath,
  exportingDesktopBackupPath,
  cleaningDesktopAssets,
  repairingDesktopIndexes,
  desktopIndexRepairSummary,
  backingUpDesktop,
  backingUpDesktopMigration,
  latestDesktopMigrationBackup,
  exportingDiagnostic,
  latestDiagnosticReport,
  diagnosticReports,
  exportingDiagnosticReportPath,
  deletingDiagnosticReportPath,
  onProbe,
  onOpenSaveDir,
  onOpenBackupDir,
  saveRootEdit,
  backupRootEdit,
  onChooseSaveRoot,
  onChooseBackupRoot,
  onResetSaveRoot,
  onResetBackupRoot,
  onApplyStorageRoots,
  onOpenLogDir,
  onOpenConfigDir,
  onOpenCodexDir,
  onOpenWorldbookDir,
  onOpenAssetDir,
  onCleanupDesktopAssets,
  onRepairDesktopIndexes,
  onBackupDesktopSaves,
  onBackupDesktopMigration,
  onWriteDiagnosticReport,
  onExportDiagnosticReport,
  onDeleteDiagnosticReport,
  onRestoreDesktopBackup,
  onDeleteDesktopBackup,
  onExportDesktopBackup,
  onSelectDesktopBackup,
  onCheckUpdate,
  onInstallUpdate,
  onRestoreDesktopMirror,
}: {
  platform: RuntimePlatform;
  info: DesktopAppInfo | null;
  releaseInfo: DesktopReleaseInfo | null;
  probe: DesktopProbeResult | null;
  error: string;
  checking: boolean;
  update: DesktopUpdateStatus | null;
  updateProgress: DesktopUpdateProgress | null;
  updateError: string;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  desktopMirrorCount: number;
  desktopConfigCount: number;
  desktopAssetCount: number;
  desktopAssetSummary: DesktopAssetMaintenanceSummary | null;
  desktopSaveMirrorHealth: DesktopSaveMirrorHealth | null;
  desktopSaveDeltaMirrorHealth: DesktopSaveDeltaMirrorHealth | null;
  desktopAssetMirrorHealth: DesktopAssetMirrorHealth | null;
  desktopBackupCount: number;
  desktopMigrationBackupCount: number;
  unreadableDesktopMigrationBackupCount: number;
  latestDesktopBackup: DesktopSaveBackupSummary | null;
  desktopMigrationBackupPreview: DesktopMigrationBackupPreview | null;
  desktopBackups: DesktopSaveBackupSummary[];
  selectedDesktopBackup: DesktopSaveBackupSummary | null;
  restoringDesktopMirror: boolean;
  restoringDesktopBackup: boolean;
  deletingDesktopBackupPath: string | null;
  exportingDesktopBackupPath: string | null;
  cleaningDesktopAssets: boolean;
  repairingDesktopIndexes: boolean;
  desktopIndexRepairSummary: string;
  backingUpDesktop: boolean;
  backingUpDesktopMigration: boolean;
  latestDesktopMigrationBackup: DesktopMigrationBackupSummary | null;
  exportingDiagnostic: boolean;
  latestDiagnosticReport: DesktopDiagnosticReportResult | DesktopDiagnosticReportSummary | null;
  diagnosticReports: DesktopDiagnosticReportSummary[];
  exportingDiagnosticReportPath: string | null;
  deletingDiagnosticReportPath: string | null;
  onProbe: () => void;
  onOpenSaveDir: () => void;
  onOpenBackupDir: () => void;
  saveRootEdit: string | null;
  backupRootEdit: string | null;
  onChooseSaveRoot: () => void;
  onChooseBackupRoot: () => void;
  onResetSaveRoot: () => void;
  onResetBackupRoot: () => void;
  onApplyStorageRoots: () => void;
  onOpenLogDir: () => void;
  onOpenConfigDir: () => void;
  onOpenCodexDir: () => void;
  onOpenWorldbookDir: () => void;
  onOpenAssetDir: () => void;
  onCleanupDesktopAssets: () => void;
  onRepairDesktopIndexes: () => void;
  onBackupDesktopSaves: () => void;
  onBackupDesktopMigration: () => void;
  onWriteDiagnosticReport: () => void;
  onExportDiagnosticReport: (report: DesktopDiagnosticReportSummary) => void;
  onDeleteDiagnosticReport: (report: DesktopDiagnosticReportSummary) => void;
  onRestoreDesktopBackup: (backup: DesktopSaveBackupSummary | null) => void;
  onDeleteDesktopBackup: (backup: DesktopSaveBackupSummary) => void;
  onExportDesktopBackup: (backup: DesktopSaveBackupSummary) => void;
  onSelectDesktopBackup: (backup: DesktopSaveBackupSummary) => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onRestoreDesktopMirror: () => void;
}) {
  const isDesktop = platform === 'desktop';
  const updateHint = buildUpdateHint(update, updateProgress, updateError);
  const currentVersion = releaseInfo?.version ?? info?.version ?? update?.currentVersion ?? '读取中';
  const latestVersion = releaseInfo?.latestVersion ?? update?.version ?? (update?.checked ? currentVersion : '待检查');
  const updateStateLabel = updateError
    ? '更新异常'
    : updateProgress
      ? '更新处理中'
      : update?.available
        ? '发现新版本'
        : update?.checked
          ? '已是最新'
          : '等待检查';
  return (
    <section
      className="grid min-w-0 gap-3 px-3 py-3 font-serif text-[12px] leading-relaxed tracking-wider lg:grid-cols-[1fr_auto]"
      style={{
        color: 'rgba(var(--tj-text-primary),0.72)',
        background: isDesktop
          ? 'linear-gradient(135deg, rgba(var(--tj-arcane-accent),0.09), rgba(var(--tj-accent-primary),0.045)), rgba(var(--tj-panel-bg-start),0.44)'
          : 'rgba(var(--tj-panel-bg-start),0.34)',
        boxShadow: isDesktop
          ? 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.22)'
          : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div
        className="grid min-w-0 gap-3 px-3 py-3 lg:col-span-2 lg:grid-cols-[1.15fr_0.85fr_auto]"
        style={{
          background: isDesktop
            ? 'linear-gradient(135deg, rgba(var(--tj-panel-bg-end),0.82), rgba(var(--tj-surface-bg-start),0.62)), radial-gradient(circle at 12% 0%, rgba(var(--tj-accent-primary),0.13), transparent 34%)'
            : 'rgba(0,0,0,0.16)',
          boxShadow: isDesktop
            ? 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.24), inset 0 1px 0 rgba(var(--tj-text-primary),0.08), 0 0 24px rgba(var(--tj-accent-primary),0.08)'
            : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
          clipPath: CLIP_MEDIUM,
        }}
      >
        <div className="min-w-0">
          <div className="text-[11px] tracking-[0.24em]" style={{ color: isDesktop ? 'rgba(var(--tj-accent-primary),0.86)' : 'rgba(var(--tj-text-primary),0.52)' }}>
            关于 / 更新
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="text-[16px] font-bold tracking-[0.16em]" style={{ color: isDesktop ? 'rgb(var(--tj-accent-secondary))' : 'rgba(var(--tj-text-primary),0.72)' }}>
              {isDesktop ? '旅行者纪事 Desktop Edition' : '旅行者纪事 Web Edition'}
            </span>
            <span
              className="px-2 py-0.5 text-[11px] tracking-[0.16em]"
              style={{
                color: updateError ? 'rgba(var(--tj-danger),0.94)' : update?.available ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-arcane-accent),0.92)',
                background: updateError
                  ? 'rgba(var(--tj-danger),0.08)'
                  : update?.available
                    ? 'linear-gradient(135deg, rgb(var(--tj-btn-primary-start)), rgb(var(--tj-btn-primary-end)))'
                    : 'rgba(var(--tj-arcane-accent),0.08)',
                boxShadow: updateError
                  ? 'inset 0 0 0 1px rgba(var(--tj-danger),0.24)'
                  : update?.available
                    ? 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.42), 0 0 16px rgba(var(--tj-accent-primary),0.14)'
                    : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.22)',
                clipPath: CLIP_SMALL,
              }}
            >
              {updateStateLabel}
            </span>
          </div>
          <div className="mt-2 text-[11px]" style={{ color: updateError ? 'rgba(var(--tj-danger),0.9)' : 'rgba(var(--tj-text-primary),0.68)' }}>
            {updateHint}
          </div>
        </div>
        <div className="grid min-w-0 gap-1 text-[11px]">
          <PathLine label="当前版本" value={`v${currentVersion}`} />
          <PathLine label="最新版本" value={latestVersion === '待检查' ? latestVersion : `v${latestVersion}`} />
          <PathLine label="更新渠道" value={releaseInfo?.releaseSource ?? (isDesktop ? 'desktop' : 'web')} />
          <PathLine label="更新源" value={releaseInfo?.updateEndpoint ?? '桌面端可用'} />
          <PathLine label="数据目录" value={info?.appDataDir ?? (isDesktop ? '读取中' : 'Web 存储')} />
        </div>
        <div className="flex min-w-[150px] flex-wrap content-start gap-2 lg:justify-end">
          <button
            type="button"
            disabled={!isDesktop || checkingUpdate || installingUpdate}
            onClick={onCheckUpdate}
            className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.94)' : 'rgba(var(--tj-text-primary),0.44)',
              background: 'rgba(var(--tj-arcane-accent),0.08)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.26)',
              clipPath: CLIP_SMALL,
            }}
          >
            {checkingUpdate ? '检查中' : '检查更新'}
          </button>
          {update?.available && (
            <button
              type="button"
              disabled={!isDesktop || installingUpdate}
              onClick={onInstallUpdate}
              className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                color: 'rgb(var(--tj-ui-active-text))',
                background: 'linear-gradient(135deg, rgb(var(--tj-btn-primary-start)), rgb(var(--tj-btn-primary-end)))',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.46), 0 0 18px rgba(var(--tj-accent-primary),0.16)',
                clipPath: CLIP_SMALL,
              }}
            >
              {installingUpdate ? '安装中' : '下载并安装'}
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[11px] tracking-[0.2em]" style={{ color: isDesktop ? 'rgb(var(--tj-arcane-accent))' : 'rgba(var(--tj-text-primary),0.52)' }}>
            运行平台
          </span>
          <span className="text-[14px] font-bold tracking-[0.16em]" style={{ color: isDesktop ? 'rgb(var(--tj-accent-secondary))' : 'rgba(var(--tj-text-primary),0.72)' }}>
            {isDesktop ? 'Desktop Edition' : 'Web Edition'}
          </span>
          {info && (
            <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.46)' }}>
              v{info.version}
            </span>
          )}
        </div>
        {isDesktop ? (
          <div className="mt-2 grid min-w-0 gap-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.62)' }}>
            {releaseInfo && (
              <>
                <PathLine label="发行版本" value={releaseInfo.title} />
                <PathLine label="更新源" value={releaseInfo.updateEndpoint} />
                <PathLine label="发行说明" value={releaseInfo.notes} />
              </>
            )}
            <PathLine label="应用数据" value={info?.appDataDir ?? '读取中'} />
            <PathLine label="存档目录" value={info?.saveDir ?? '读取中'} />
            <PathLine label="备份目录" value={info?.backupDir ?? '读取中'} />
            <PathLine label="图鉴目录" value={info?.codexDir ?? '读取中'} />
            <PathLine label="世界书目录" value={info?.worldbookDir ?? '读取中'} />
            <div
              className="mt-2 grid gap-2 px-3 py-3"
              style={{
                background: 'rgba(var(--tj-panel-bg-start),0.62)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.16)',
                clipPath: CLIP_SMALL,
              }}
            >
              <div className="text-[11px] tracking-[0.18em]" style={{ color: 'rgba(var(--tj-arcane-accent),0.84)' }}>
                存储路径
              </div>
              <PathLine label="存档根目录" value={saveRootEdit || '跟随默认应用数据目录'} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isDesktop}
                  onClick={onChooseSaveRoot}
                  className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: 'rgba(var(--tj-arcane-accent),0.92)',
                    background: 'rgba(var(--tj-arcane-accent),0.07)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  选择存档目录
                </button>
                <button
                  type="button"
                  disabled={!isDesktop}
                  onClick={onResetSaveRoot}
                  className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: 'rgba(var(--tj-text-primary),0.82)',
                    background: 'rgba(var(--tj-text-primary),0.06)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.18)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  恢复默认
                </button>
              </div>
              <PathLine label="备份根目录" value={backupRootEdit || '跟随默认应用数据目录'} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isDesktop}
                  onClick={onChooseBackupRoot}
                  className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: 'rgba(var(--tj-arcane-accent),0.92)',
                    background: 'rgba(var(--tj-arcane-accent),0.07)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  选择备份目录
                </button>
                <button
                  type="button"
                  disabled={!isDesktop}
                  onClick={onResetBackupRoot}
                  className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: 'rgba(var(--tj-text-primary),0.82)',
                    background: 'rgba(var(--tj-text-primary),0.06)',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.18)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  disabled={!isDesktop}
                  onClick={onApplyStorageRoots}
                  className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    color: 'rgb(var(--tj-ui-active-text))',
                    background: 'linear-gradient(135deg, rgb(var(--tj-btn-primary-start)), rgb(var(--tj-btn-primary-end)))',
                    boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.46)',
                    clipPath: CLIP_SMALL,
                  }}
                >
                  应用路径
                </button>
              </div>
            </div>
            <PathLine label="镜像存档" value={`${desktopMirrorCount} 个`} />
            {desktopSaveMirrorHealth && (
              <PathLine label="存档镜像健康" value={formatDesktopSaveMirrorHealth(desktopSaveMirrorHealth)} />
            )}
            {desktopSaveDeltaMirrorHealth && (
              <PathLine label="增量镜像健康" value={formatDesktopSaveDeltaMirrorHealth(desktopSaveDeltaMirrorHealth)} />
            )}
            <PathLine label="本地备份" value={`${desktopBackupCount} 份`} />
            <PathLine
              label="迁移备份"
              value={`${desktopMigrationBackupCount} 份${unreadableDesktopMigrationBackupCount > 0 ? ` / 异常 ${unreadableDesktopMigrationBackupCount} 份` : ''}`}
            />
            {desktopMigrationBackupPreview && (
              <PathLine
                label="迁移预估"
                value={`${desktopMigrationBackupPreview.indexedSaveCount} 个存档 / ${desktopMigrationBackupPreview.fileCount} 个文件 / ${formatByteSize(desktopMigrationBackupPreview.estimatedPayloadBytes)} / ${desktopMigrationBackupPreview.directoryCount} 个目录`}
              />
            )}
            <PathLine label="配置镜像" value={`${desktopConfigCount} 项`} />
            <PathLine label="资源镜像" value={`${desktopAssetCount} 个`} />
            {desktopAssetMirrorHealth && (
              <PathLine label="资源镜像健康" value={formatDesktopAssetMirrorHealth(desktopAssetMirrorHealth)} />
            )}
            {desktopAssetSummary && (
              <>
                <PathLine label="资源占用" value={formatByteSize(desktopAssetSummary.totalBytes)} />
                <PathLine
                  label="无引用资源"
                  value={`${desktopAssetSummary.orphanAssets} 个 / ${formatByteSize(desktopAssetSummary.orphanBytes)}`}
                />
              </>
            )}
            {desktopIndexRepairSummary && (
              <PathLine label="索引修复" value={desktopIndexRepairSummary} />
            )}
            {latestDesktopBackup && (
              <PathLine
                label="最近备份"
                value={`${new Date(latestDesktopBackup.createdAt).toLocaleString('zh-CN')} / ${latestDesktopBackup.count} 个存档`}
              />
            )}
            {latestDesktopMigrationBackup && (
              <PathLine
                label="迁移前完整备份"
                value={`${new Date(latestDesktopMigrationBackup.createdAt).toLocaleString('zh-CN')} / ${latestDesktopMigrationBackup.indexedSaveCount} 个存档 / ${latestDesktopMigrationBackup.fileCount} 个文件 / ${formatByteSize(latestDesktopMigrationBackup.payloadBytes)} / ${latestDesktopMigrationBackup.path}`}
              />
            )}
            {desktopBackups.length > 0 && (
              <div className="mt-2 grid min-w-0 gap-1">
                <div style={{ color: 'rgba(var(--tj-arcane-accent),0.72)' }}>备份列表</div>
                {desktopBackups.slice(0, 5).map((backup) => (
                  <div
                    key={backup.path}
                    className="grid min-w-0 gap-2 px-2 py-1 sm:grid-cols-[1fr_auto]"
                    style={{
                      background: 'rgba(var(--tj-arcane-accent),0.045)',
                      boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
                      clipPath: CLIP_SMALL,
                    }}
                  >
                    <div className="min-w-0 break-all" style={{ color: 'rgba(var(--tj-text-primary),0.68)' }}>
                      {formatDesktopBackupLine(backup)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={!isDesktop}
                        onClick={() => onSelectDesktopBackup(backup)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: selectedDesktopBackup?.path === backup.path ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-arcane-accent),0.92)',
                          background: selectedDesktopBackup?.path === backup.path
                            ? 'linear-gradient(135deg, rgb(var(--tj-btn-primary-start)), rgb(var(--tj-btn-primary-end)))'
                            : 'rgba(var(--tj-arcane-accent),0.08)',
                          boxShadow: selectedDesktopBackup?.path === backup.path
                            ? 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.42)'
                            : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.22)',
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        详情
                      </button>
                      <button
                        type="button"
                        disabled={!isDesktop || exportingDesktopBackupPath === backup.path}
                        onClick={() => onExportDesktopBackup(backup)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: 'rgba(var(--tj-arcane-accent),0.92)',
                          background: 'rgba(var(--tj-arcane-accent),0.08)',
                          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.22)',
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        {exportingDesktopBackupPath === backup.path ? '导出中' : '导出'}
                      </button>
                      <button
                        type="button"
                        disabled={!isDesktop || restoringDesktopBackup || !isRestorableDesktopBackup(backup)}
                        onClick={() => onRestoreDesktopBackup(backup)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: 'rgba(var(--tj-accent-primary),0.96)',
                          background: 'rgba(var(--tj-accent-primary),0.08)',
                          boxShadow: insetRing(0.22),
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        disabled={!isDesktop || deletingDesktopBackupPath === backup.path}
                        onClick={() => onDeleteDesktopBackup(backup)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: 'rgba(var(--tj-danger),0.92)',
                          background: 'rgba(var(--tj-danger),0.07)',
                          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.22)',
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        {deletingDesktopBackupPath === backup.path ? '删除中' : '删除'}
                      </button>
                    </div>
                  </div>
                ))}
                {selectedDesktopBackup && (
                  <DesktopBackupDetailPanel backup={selectedDesktopBackup} />
                )}
              </div>
            )}
            {probe && (
              <PathLine label="探针文件" value={probe.probeFile} />
            )}
            {latestDiagnosticReport && (
              <PathLine label="诊断报告" value={latestDiagnosticReport.path} />
            )}
            {diagnosticReports.length > 0 && (
              <div className="mt-2 grid min-w-0 gap-1">
                <div style={{ color: 'rgba(var(--tj-arcane-accent),0.72)' }}>日志中心</div>
                {diagnosticReports.slice(0, 5).map((report) => (
                  <div
                    key={report.path}
                    className="grid min-w-0 gap-2 px-2 py-1 sm:grid-cols-[1fr_auto]"
                    style={{
                      background: 'rgba(var(--tj-arcane-accent),0.045)',
                      boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
                      clipPath: CLIP_SMALL,
                    }}
                  >
                    <div className="min-w-0 break-all" style={{ color: 'rgba(var(--tj-text-primary),0.68)' }}>
                      {formatDesktopDiagnosticReportLine(report)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={!isDesktop || exportingDiagnosticReportPath === report.path}
                        onClick={() => onExportDiagnosticReport(report)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: 'rgba(var(--tj-arcane-accent),0.92)',
                          background: 'rgba(var(--tj-arcane-accent),0.08)',
                          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.22)',
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        {exportingDiagnosticReportPath === report.path ? '导出中' : '导出'}
                      </button>
                      <button
                        type="button"
                        disabled={!isDesktop || deletingDiagnosticReportPath === report.path}
                        onClick={() => onDeleteDiagnosticReport(report)}
                        className="cursor-pointer px-2 py-1 text-[11px] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                          color: 'rgba(var(--tj-danger),0.92)',
                          background: 'rgba(var(--tj-danger),0.07)',
                          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.22)',
                          clipPath: CLIP_SMALL,
                        }}
                      >
                        {deletingDiagnosticReportPath === report.path ? '删除中' : '删除'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1" style={{ color: updateError ? 'rgba(var(--tj-danger),0.9)' : 'rgba(var(--tj-text-primary),0.62)' }}>
              {updateHint}
            </div>
            {error && (
              <div style={{ color: 'rgba(var(--tj-danger),0.9)' }}>{error}</div>
            )}
          </div>
        ) : null}
      </div>
      {!isDesktop && (
        <div className="col-span-2 mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.58)' }}>
          当前为浏览器运行模式，存档仍使用 Web 存储。桌面版会在本地应用数据目录创建 saves / backups / assets / logs 等目录，并提供应用内更新检查。
        </div>
      )}
      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
        <button
          type="button"
          disabled={!isDesktop || checking}
          onClick={onProbe}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-text-primary),0.44)',
            background: isDesktop ? 'linear-gradient(135deg, rgb(var(--tj-arcane-accent)), rgb(var(--tj-arcane-accent-deep)))' : 'rgba(var(--tj-arcane-accent),0.04)',
            boxShadow: isDesktop
              ? 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.55), 0 0 18px rgba(var(--tj-arcane-accent-deep),0.18)'
              : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
            clipPath: CLIP_SMALL,
          }}
        >
          {checking ? '写入中' : '写入桌面探针'}
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenSaveDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开存档目录
        </button>
        <button
          type="button"
          disabled={!isDesktop || backingUpDesktop}
          onClick={onBackupDesktopSaves}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {backingUpDesktop ? '备份中' : '备份到本地'}
        </button>
        <button
          type="button"
          disabled={!isDesktop || backingUpDesktopMigration}
          onClick={onBackupDesktopMigration}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {backingUpDesktopMigration ? '备份中' : '迁移前完整备份'}
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenBackupDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开备份目录
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenLogDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开日志目录
        </button>
        <button
          type="button"
          disabled={!isDesktop || exportingDiagnostic}
          onClick={onWriteDiagnosticReport}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {exportingDiagnostic ? '导出中' : '导出诊断报告'}
        </button>
        <button
          type="button"
          disabled={!isDesktop || restoringDesktopBackup || !latestDesktopBackup || !isRestorableDesktopBackup(latestDesktopBackup)}
          onClick={() => onRestoreDesktopBackup(latestDesktopBackup)}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop && latestDesktopBackup && isRestorableDesktopBackup(latestDesktopBackup) ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {restoringDesktopBackup ? '恢复中' : '恢复最近备份'}
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenConfigDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开配置目录
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenCodexDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开图鉴目录
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenWorldbookDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开世界书目录
        </button>
        <button
          type="button"
          disabled={!isDesktop}
          onClick={onOpenAssetDir}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          打开资源目录
        </button>
        <button
          type="button"
          disabled={!isDesktop || cleaningDesktopAssets || !desktopAssetSummary || desktopAssetSummary.orphanAssets <= 0}
          onClick={onCleanupDesktopAssets}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop && desktopAssetSummary && desktopAssetSummary.orphanAssets > 0 ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {cleaningDesktopAssets ? '清理中' : '清理无引用资源'}
        </button>
        <button
          type="button"
          disabled={!isDesktop || repairingDesktopIndexes}
          onClick={onRepairDesktopIndexes}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop ? 'rgba(var(--tj-arcane-accent),0.92)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-arcane-accent),0.07)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
            clipPath: CLIP_SMALL,
          }}
        >
          {repairingDesktopIndexes ? '修复中' : '修复镜像索引'}
        </button>
        <button
          type="button"
          disabled={!isDesktop || restoringDesktopMirror || desktopMirrorCount <= 0}
          onClick={onRestoreDesktopMirror}
          className="w-full cursor-pointer px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: isDesktop && desktopMirrorCount > 0 ? 'rgba(var(--tj-accent-primary),0.96)' : 'rgba(var(--tj-text-primary),0.44)',
            background: 'rgba(var(--tj-accent-primary),0.07)',
            boxShadow: insetRing(0.24),
            clipPath: CLIP_SMALL,
          }}
        >
          {restoringDesktopMirror ? '恢复中' : '恢复本地镜像'}
        </button>
      </div>
    </section>
  );
}

function DesktopBackupDetailPanel({ backup }: { backup: DesktopSaveBackupSummary }) {
  const checksumPreview = backup.integrity?.checksum
    ? `${backup.integrity.checksum.slice(0, 12)}...`
    : '无';
  return (
    <div
      className="mt-2 grid min-w-0 gap-2 px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-panel-bg-end),0.58), rgba(var(--tj-surface-bg-start),0.42))',
        boxShadow: insetRing(0.18),
        clipPath: CLIP_SMALL,
      }}
    >
      <div className="text-[11px] tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),0.82)' }}>
        备份详情
      </div>
      <div className="grid min-w-0 gap-1 text-[11px] sm:grid-cols-2">
        <PathLine label="文件名" value={backup.fileName} />
        <PathLine label="创建时间" value={formatDesktopBackupCreatedAt(backup)} />
        <PathLine label="备份来源" value={formatDesktopBackupReason(backup)} />
        <PathLine label="存档数量" value={`${backup.count} 个`} />
        <PathLine label="校验状态" value={formatDesktopBackupIntegrityStatus(backup)} />
        <PathLine label="可恢复性" value={isRestorableDesktopBackup(backup) ? '可恢复' : '不可恢复'} />
        <PathLine label="Payload 大小" value={backup.integrity ? formatByteSize(backup.integrity.payloadBytes) : '无校验记录'} />
        <PathLine label="校验存档数" value={backup.integrity ? `${backup.integrity.saveCount} 个` : '无校验记录'} />
        <PathLine label="校验算法" value={backup.integrity?.algorithm ?? '无校验记录'} />
        <PathLine label="Checksum" value={checksumPreview} />
        {backup.error && <PathLine label="读取错误" value={backup.error} />}
        <PathLine label="本地路径" value={backup.path} />
      </div>
    </div>
  );
}

function buildUpdateHint(
  update: DesktopUpdateStatus | null,
  progress: DesktopUpdateProgress | null,
  error: string,
): string {
  if (error) return `更新检查失败：${error}`;
  if (progress) {
    const size = progress.contentLength ? ` / ${formatByteSize(progress.contentLength)}` : '';
    if (progress.phase === 'installing') return '更新包已下载，正在安装。';
    if (progress.phase === 'finished') return '更新包下载完成，准备安装。';
    if (progress.phase === 'downloading') return `更新下载中：${formatByteSize(progress.downloadedBytes)}${size}`;
    return '更新下载已开始。';
  }
  if (!update?.checked) return '桌面版可在此检查应用更新。';
  if (!update.available) return '当前已是最新版本。';
  return `发现新版本 ${update.version ?? ''}${update.currentVersion ? `，当前版本 ${update.currentVersion}` : ''}。`;
}

function formatDesktopSaveMirrorHealth(health: DesktopSaveMirrorHealth): string {
  const sequenceIssue =
    health.sequenceBehindIndex
    || health.sequenceStatus === 'invalid'
    || health.sequenceStatus === 'unreadable'
    || (health.sequenceStatus === 'missing' && (health.indexedSaves > 0 || health.saveFiles > 0));
  const issueCount =
    health.invalidSaveFiles +
    health.unreadableSaveFiles +
    health.missingIndexedSaveFiles +
    health.orphanSaveFiles +
    health.pendingTransactions +
    health.unreadableTransactions +
    (sequenceIssue ? 1 : 0);
  const sequenceLabel = `${formatDesktopMirrorIndexStatus(health.sequenceStatus)}#${health.sequenceLastSaveId || 0}${health.sequenceBehindIndex ? '落后' : ''}`;
  return `索引 ${formatDesktopMirrorIndexStatus(health.indexStatus)} / 序列 ${sequenceLabel} / 有效 ${health.validSaveFiles}/${health.saveFiles} / 缺失 ${health.missingIndexedSaveFiles} / 孤儿 ${health.orphanSaveFiles} / 事务 ${health.pendingTransactions} / 异常 ${issueCount}`;
}

function formatDesktopSaveDeltaMirrorHealth(health: DesktopSaveDeltaMirrorHealth): string {
  const issueCount =
    health.invalidDeltaFiles +
    health.unreadableDeltaFiles +
    health.missingIndexedDeltaFiles +
    health.orphanDeltaFiles;
  return `索引 ${formatDesktopMirrorIndexStatus(health.indexStatus)} / 有效 ${health.validDeltaFiles}/${health.deltaFiles} / 缺失 ${health.missingIndexedDeltaFiles} / 孤儿 ${health.orphanDeltaFiles} / 异常 ${issueCount}`;
}

function formatDesktopAssetMirrorHealth(health: DesktopAssetMirrorHealth): string {
  const issueCount =
    health.invalidMetadataFiles +
    health.unreadableMetadataFiles +
    health.missingPayloadFiles +
    health.missingIndexedMetadataFiles +
    health.orphanMetadataFiles;
  return `索引 ${formatDesktopMirrorIndexStatus(health.indexStatus)} / metadata ${health.validMetadataFiles}/${health.metadataFiles} / payload缺失 ${health.missingPayloadFiles} / 孤儿 ${health.orphanMetadataFiles} / 异常 ${issueCount}`;
}

function formatDesktopMirrorIndexStatus(status: DesktopSaveMirrorHealth['indexStatus'] | DesktopSaveMirrorHealth['sequenceStatus'] | DesktopSaveDeltaMirrorHealth['indexStatus'] | DesktopAssetMirrorHealth['indexStatus']): string {
  const statusLabel: Record<typeof status, string> = {
    ok: '正常',
    missing: '缺失',
    invalid: '格式异常',
    unreadable: '不可读',
  };
  return statusLabel[status];
}

function formatDesktopBackupLine(backup: DesktopSaveBackupSummary): string {
  const sizeLabel = backup.integrity?.payloadBytes ? ` / ${formatByteSize(backup.integrity.payloadBytes)}` : '';
  const errorLabel = backup.error ? ` / ${backup.error}` : '';
  return `${formatDesktopBackupCreatedAt(backup)} / ${formatDesktopBackupReason(backup)} / ${backup.count} 个存档 / ${formatDesktopBackupIntegrityStatus(backup)}${sizeLabel}${errorLabel} / ${backup.fileName}`;
}

function formatDesktopBackupCreatedAt(backup: DesktopSaveBackupSummary): string {
  return backup.createdAt ? new Date(backup.createdAt).toLocaleString('zh-CN') : '时间未知';
}

function formatDesktopBackupReason(backup: DesktopSaveBackupSummary): string {
  const reasonLabel: Record<NonNullable<DesktopSaveBackupSummary['reason']>, string> = {
    manual: '手动备份',
    'before-restore': '恢复前备份',
    'before-replace': '替换前备份',
    'before-repair': '修复前备份',
  };
  return backup.reason ? reasonLabel[backup.reason] ?? backup.reason : '未知来源';
}

function formatDesktopBackupIntegrityStatus(backup: DesktopSaveBackupSummary): string {
  const integrityLabel: Record<DesktopSaveBackupSummary['integrityStatus'], string> = {
    verified: '校验通过',
    missing: '旧备份无校验',
    mismatch: '校验异常',
    unreadable: '不可读',
  };
  return integrityLabel[backup.integrityStatus];
}

export function isRestorableDesktopBackup(backup: DesktopSaveBackupSummary | null): backup is DesktopSaveBackupSummary {
  return Boolean(
    backup
    && backup.count > 0
    && backup.integrityStatus !== 'unreadable'
    && backup.integrityStatus !== 'mismatch',
  );
}

export function findLatestRestorableDesktopBackup(backups: DesktopSaveBackupSummary[]): DesktopSaveBackupSummary | null {
  return backups.find(isRestorableDesktopBackup) ?? null;
}

export function countUnreadableDesktopBackups(backups: DesktopSaveBackupSummary[]): number {
  return backups.filter((backup) => backup.integrityStatus === 'unreadable').length;
}

export function findLatestVerifiedDesktopMigrationBackup(backups: DesktopMigrationBackupSummary[]): DesktopMigrationBackupSummary | null {
  return backups.find((backup) => backup.integrityStatus === 'verified') ?? null;
}

export function countUnreadableDesktopMigrationBackups(backups: DesktopMigrationBackupSummary[]): number {
  return backups.filter((backup) => backup.integrityStatus !== 'verified').length;
}

function formatDesktopDiagnosticReportLine(report: DesktopDiagnosticReportSummary): string {
  const updateLabel = report.updateChecked
    ? report.updateAvailable ? '发现更新' : '已检查更新'
    : '未检查更新';
  const errorLabel = report.lastError ? ` / 最近错误：${report.lastError}` : '';
  return `${new Date(report.createdAt).toLocaleString('zh-CN')} / v${report.appVersion ?? '未知'} / ${updateLabel}${errorLabel} / ${report.fileName}`;
}

export function downloadDesktopBackupRecord(record: DesktopSaveBackupRecord, fileName: string): void {
  const json = JSON.stringify(record, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `export-${fileName}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadDesktopDiagnosticReport(report: DesktopDiagnosticReport, fileName: string): void {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `export-${fileName}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function PathLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[72px_1fr]">
      <span style={{ color: 'rgba(var(--tj-arcane-accent),0.72)' }}>{label}</span>
      <span className="min-w-0 break-all" style={{ color: 'rgba(var(--tj-text-primary),0.72)' }}>{value}</span>
    </div>
  );
}

