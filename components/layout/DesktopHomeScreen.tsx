import  { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSaveList, type SaveListItemSummary } from '@/services/dbService';
import {
  buildDesktopReleaseInfo,
  type DesktopReleaseInfo,
} from '@/services/desktop/desktopReleaseInfo';
import {
  checkForDesktopUpdate,
  downloadAndInstallDesktopUpdate,
  getDesktopAppInfo,
  openDesktopDataDir,
  writeDesktopProbe,
  type DesktopAppInfo,
  type DesktopProbeResult,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
} from '@/services/desktop/desktopBridge';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import type { SettingsTab } from '@/components/features/Settings/SettingsModal';
import { getHomeBackground } from '@/data/homeBackgrounds';

interface DesktopHomeScreenProps {
  onNewGame: () => void;
  onLoadSave: () => void;
  onContinue: () => Promise<boolean>;
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenStorageManager: () => void;
  onOpenWorldbookManager: () => void;
  onOpenCodexManager: () => void;
  onOpenCloudSave: () => void;
  onOpenReleaseAnnouncements: () => void;
  onDiscordPost: () => void;
  onMysteryChat: () => void;
  /** 当前主题 id：决定封面用的六国背景图。 */
  currentTheme?: string;
}

type DataDirTarget = 'appData' | 'saves' | 'backups' | 'logs' | 'assets' | 'config' | 'codex' | 'worldbooks';

interface StarDot {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

const cardClip = 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)';
const smallClip = 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)';

// 手账封面配色：金箔标题、皮革封面、羊皮纸内页。
const FOIL_GRADIENT = 'linear-gradient(180deg, #f6e3ac 8%, #d5b66e 38%, #b68a43 62%, #8a6530 92%)';
const COVER_FRAME =
  'inset 0 0 0 1px rgba(240, 213, 139, 0.5), inset 0 0 0 7px rgba(0, 0, 0, 0.14), inset 0 0 0 8px rgba(240, 213, 139, 0.26), 0 24px 60px rgba(0, 0, 0, 0.45)';
const INK = 'var(--journal-ink)';
const INK_MUTED = 'var(--journal-ink-muted)';
const PAPER_BORDER = 'rgba(53, 46, 39, 0.16)';

export function DesktopHomeScreen({
  onNewGame,
  onLoadSave,
  onContinue,
  onOpenSettings,
  onOpenStorageManager,
  onOpenWorldbookManager,
  onOpenCodexManager,
  onOpenCloudSave,
  onOpenReleaseAnnouncements,
  onDiscordPost,
  onMysteryChat,
  currentTheme,
}: DesktopHomeScreenProps) {
  const [desktopInfo, setDesktopInfo] = useState<DesktopAppInfo | null>(null);
  const [saveList, setSaveList] = useState<SaveListItemSummary[]>([]);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateStatus | null>(null);
  const [desktopReleaseInfo, setDesktopReleaseInfo] = useState<DesktopReleaseInfo | null>(null);
  const [desktopProbe, setDesktopProbe] = useState<DesktopProbeResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [toolboxOpen, setToolboxOpen] = useState(true);

  const stars = useMemo<StarDot[]>(() => {
    const list: StarDot[] = [];
    for (let i = 0; i < 24; i++) {
      list.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() < 0.12 ? 2 + Math.random() * 1.6 : 0.7 + Math.random() * 1.2,
        opacity: 0.16 + Math.random() * 0.5,
      });
    }
    return list;
  }, []);

  const refreshOverview = useCallback(async () => {
    setLoadError('');
    try {
      const [info, saves] = await Promise.all([getDesktopAppInfo(), getSaveList()]);
      setDesktopInfo(info);
      setSaveList(saves);
      setDesktopReleaseInfo(buildDesktopReleaseInfo(info, null));
    } catch (error) {
      console.error('[desktop-home] overview refresh failed', error);
      setLoadError(error instanceof Error ? error.message : '桌面首页状态读取失败');
    }
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void refreshOverview();
  }, [refreshOverview]);

  const latestSave = saveList[0] ?? null;
  const hasSave = Boolean(latestSave);
  const saveCount = saveList.filter((save) => save.type !== 'auto').length;
  const appVersion = desktopInfo?.version || desktopReleaseInfo?.version || '0.0.0';
  const updateText = desktopUpdate?.available
    ? `发现新版本 ${desktopUpdate.version ?? '未知'}`
    : desktopUpdate?.checked
      ? '当前已是最新版本'
      : '尚未检查更新';
  const releaseNotes = desktopReleaseInfo?.notes || updateText;
  const continueLabel = hasSave ? `继续游戏 · 最近存档 #${latestSave?.id ?? '?'}` : '继续游戏';
  const continueHint = latestSave
    ? `${latestSave.travelerName || '未命名旅人'} / ${latestSave.currentLocation || latestSave.worldPeriodName || '未知坐标'}`
    : '当前没有可继续的存档。';

  const handleOpenDir = useCallback(async (target: DataDirTarget) => {
    await openDesktopDataDir(target);
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setStatusMessage('正在检查更新...');
    setLoadError('');
    try {
      const result = await checkForDesktopUpdate();
      setDesktopUpdate(result);
      setDesktopReleaseInfo(buildDesktopReleaseInfo(desktopInfo, result));
      setStatusMessage(result.available
        ? `发现 Desktop Edition ${result.version ?? '新版本'}`
        : '当前已是最新版本');
    } catch (error) {
      console.error('[desktop-home] check update failed', error);
      setStatusMessage('');
      setLoadError(error instanceof Error ? error.message : '检查更新失败');
    } finally {
      setCheckingUpdate(false);
    }
  }, [desktopInfo]);

  const handleInstallUpdate = useCallback(async () => {
    if (!desktopUpdate?.available) return;
    setInstallingUpdate(true);
    setLoadError('');
    setStatusMessage('正在下载并安装更新...');
    setUpdateProgress(null);
    try {
      await downloadAndInstallDesktopUpdate((progress) => setUpdateProgress(progress));
      setStatusMessage('更新已提交安装，应用将重启或由安装器继续完成。');
    } catch (error) {
      console.error('[desktop-home] install update failed', error);
      setStatusMessage('');
      setLoadError(error instanceof Error ? error.message : '下载并安装更新失败');
    } finally {
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  }, [desktopUpdate?.available]);

  const handleWriteProbe = useCallback(async () => {
    setLoadError('');
    try {
      const result = await writeDesktopProbe();
      setDesktopProbe(result);
      setStatusMessage(result?.ok ? `探针已写入 ${result.probeFile}` : '探针写入失败');
    } catch (error) {
      console.error('[desktop-home] probe failed', error);
      setLoadError(error instanceof Error ? error.message : '探针写入失败');
    }
  }, []);

  const themeBackground = getHomeBackground(currentTheme);
  // 有主题背景图时：图上压皮革色渐变，保证金箔标题与纸卡可读；无图则维持纯皮革封面。
  const coverBackground = themeBackground
    ? `linear-gradient(180deg, rgba(75, 52, 40, 0.66), rgba(37, 26, 22, 0.9) 78%), url(${themeBackground.src}) center/cover no-repeat`
    : 'radial-gradient(ellipse at 50% 0%, rgba(240, 213, 139, 0.1), transparent 44%), radial-gradient(ellipse at 18% 88%, rgba(135, 79, 67, 0.22), transparent 40%), linear-gradient(180deg, var(--journal-leather), var(--journal-leather-deep) 74%)';

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden px-4 py-6 sm:px-8 sm:py-8"
      style={{ background: coverBackground }}
    >
      {/* 封面烫金尘埃 */}
      {stars.map((star, index) => (
        <span
          key={`desktop-star-${index}`}
          className="absolute rounded-full"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.opacity * 0.55,
            background: 'var(--journal-antique-gold-soft)',
            boxShadow: star.size > 1.8 ? '0 0 10px rgba(240, 213, 139, 0.24)' : 'none',
          }}
        />
      ))}

      <div className="relative z-10 grid w-full min-w-0 gap-5 xl:grid-cols-[248px_minmax(0,1fr)]">
        <aside
          className="hidden flex-col gap-3 xl:flex"
          style={{
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--journal-leather) 82%, var(--journal-parchment) 18%), color-mix(in srgb, var(--journal-leather-deep) 92%, var(--journal-parchment) 8%))',
            boxShadow: 'inset 0 0 0 1px rgba(240, 213, 139, 0.3), 0 18px 38px rgba(0, 0, 0, 0.32)',
            clipPath: cardClip,
          }}
        >
          <div className="px-4 pt-4">
            <div className="text-[10px] tracking-[0.3em]" style={{ color: 'var(--journal-antique-gold-soft)' }}>❦ 工具箱</div>
            <div className="mt-2 font-serif text-[20px] tracking-[0.16em]" style={{ color: '#f0d58b' }}>本地入口</div>
            <p className="mt-2 text-[12px] leading-6" style={{ color: 'rgba(239, 227, 201, 0.6)' }}>
              更新、目录、探针和迁移都放在这里，不占主视野。
            </p>
          </div>
          <div className="px-4 pb-4 space-y-2">
            <ToolButton label="检查更新" onClick={() => void handleCheckUpdate()} active={checkingUpdate} tone="accent" />
            <ToolButton label="写入探针" onClick={() => void handleWriteProbe()} active={false} tone="secondary" />
            <ToolButton label="存档目录" onClick={() => void handleOpenDir('saves')} active={false} tone="secondary" />
            <ToolButton label="备份目录" onClick={() => void handleOpenDir('backups')} active={false} tone="secondary" />
            <ToolButton label="设置" onClick={() => onOpenSettings('api')} active={false} tone="secondary" />
            <ToolButton label="存储管理" onClick={onOpenStorageManager} active={false} tone="secondary" />
            <ToolButton label="世界书" onClick={onOpenWorldbookManager} active={false} tone="secondary" />
            <ToolButton label="北陆图书馆" onClick={onOpenCodexManager} active={false} tone="secondary" />
            <ToolButton label="云存档" onClick={onOpenCloudSave} active={false} tone="secondary" />
            <ToolButton label="更新公告" onClick={onOpenReleaseAnnouncements} active={false} tone="secondary" />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-5">
          {/* 手账封面 */}
          <header
            className="relative mx-auto w-full max-w-[920px] px-6 pb-9 pt-10 text-center sm:px-12"
            style={{
              background: 'linear-gradient(165deg, color-mix(in srgb, var(--journal-leather) 84%, var(--journal-parchment) 16%), var(--journal-leather-deep))',
              boxShadow: COVER_FRAME,
              clipPath: cardClip,
            }}
          >
            {/* 缎带书签 */}
            <span
              aria-hidden
              className="absolute left-1/2 top-0 h-20 w-7 -translate-x-1/2"
              style={{
                background: 'linear-gradient(180deg, var(--journal-ribbon-red), color-mix(in srgb, var(--journal-ribbon-red) 68%, #000 32%))',
                clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 12px), 0 100%)',
                boxShadow: '0 6px 14px rgba(0, 0, 0, 0.38)',
              }}
            />
            {/* 四角花饰 */}
            {(['left-3 top-3', 'right-3 top-3', 'left-3 bottom-3', 'right-3 bottom-3'] as const).map((pos) => (
              <span key={pos} aria-hidden className={`absolute ${pos} select-none text-sm opacity-50`} style={{ color: 'var(--journal-antique-gold-soft)' }}>
                ❦
              </span>
            ))}

            <div className="pt-5 text-[10px] tracking-[0.5em] sm:text-[11px]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
              ❦ TEYVAT CHRONICLE ❦
            </div>
            <h1
              className="mt-4 font-serif text-[46px] font-bold leading-none tracking-[0.2em] sm:text-[56px] lg:text-[68px]"
              style={{
                backgroundImage: FOIL_GRADIENT,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55))',
              }}
            >
              旅行者纪事
            </h1>
            <div className="mt-4 flex items-center justify-center gap-3 text-[10px] tracking-[0.3em] sm:text-[11px]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
              <span aria-hidden className="h-px w-10" style={{ background: 'linear-gradient(90deg, transparent, rgba(240, 213, 139, 0.6))' }} />
              <span>Desktop Edition · {appVersion}</span>
              <span aria-hidden className="h-px w-10" style={{ background: 'linear-gradient(270deg, transparent, rgba(240, 213, 139, 0.6))' }} />
            </div>
            <p className="mx-auto mt-4 max-w-[52ch] text-[13px] leading-7" style={{ color: 'rgba(239, 227, 201, 0.78)' }}>
              翻开这本手账，提瓦特的每一段见闻都会落在纸页上。继续旅程、整理存档、检查更新，都在这里。
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void onContinue()}
                disabled={!hasSave}
                className="teyvat-btn teyvat-btn-primary px-7 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="relative">{continueLabel}</span>
              </button>
              <button
                type="button"
                onClick={onLoadSave}
                className="px-6 py-3 font-serif text-sm tracking-[0.14em] transition-all hover:opacity-90"
                style={{
                  color: 'var(--journal-ink)',
                  background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
                  boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}, 0 10px 24px rgba(0, 0, 0, 0.3)`,
                  clipPath: cardClip,
                  fontWeight: 600,
                }}
              >
                读取存档
              </button>
              <button
                type="button"
                onClick={onNewGame}
                className="px-6 py-3 font-serif text-sm tracking-[0.14em] transition-all hover:opacity-90"
                style={{
                  color: 'var(--journal-ink)',
                  background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
                  boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}, 0 10px 24px rgba(0, 0, 0, 0.3)`,
                  clipPath: cardClip,
                  fontWeight: 600,
                }}
              >
                踏上旅途
              </button>
            </div>
            <div className="mt-4 text-[12px] leading-6" style={{ color: 'rgba(239, 227, 201, 0.6)' }}>
              {continueHint}
            </div>
          </header>

          <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <PaperPanel title="本地档案" subtitle="存档、备份、资源和日志都在本地。">
              <div className="grid gap-2 sm:grid-cols-2">
                <StatTile label="存档" value={`${saveCount}`} detail={latestSave ? `最新 ${latestSave.currentDate || latestSave.timestamp}` : '暂无'} />
                <StatTile label="备份" value={desktopInfo ? '可管理' : '读取中'} detail="本地备份与迁移前完整备份" />
                <StatTile label="资源" value={desktopInfo?.assetDir ? '可打开' : '读取中'} detail="图片、壁纸与生成资源" />
                <StatTile label="日志" value={desktopInfo?.logDir ? '可导出' : '读取中'} detail="诊断报告与错误记录" />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <SecondaryButton label="打开存档目录" onClick={() => void handleOpenDir('saves')} />
                <SecondaryButton label="打开备份目录" onClick={() => void handleOpenDir('backups')} />
                <SecondaryButton label="存储管理" onClick={onOpenStorageManager} />
                <SecondaryButton label="写入探针" onClick={() => void handleWriteProbe()} />
              </div>
              <div className="mt-4 rounded-sm px-3 py-3 text-sm" style={{ background: 'rgba(53, 46, 39, 0.05)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}` }}>
                <SectionLabel text="最近存档" />
                {latestSave ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="font-serif text-[15px] tracking-[0.16em]" style={{ color: 'var(--journal-antique-gold)' }}>{latestSave.travelerName || '未命名旅人'}</div>
                    <DesktopLine label="回合" value={`第 ${latestSave.turnCount} 回合`} />
                    <DesktopLine label="地点" value={latestSave.currentLocation || latestSave.worldPeriodName || '未知坐标'} />
                    <DesktopLine label="时间" value={new Date(latestSave.timestamp).toLocaleString('zh-CN')} />
                    <DesktopLine label="摘要" value={latestSave.lastSummary || '暂无摘要'} />
                  </div>
                ) : (
                  <div className="mt-2" style={{ color: INK_MUTED }}>当前没有可继续的本地存档。</div>
                )}
              </div>
            </PaperPanel>

            <PaperPanel title="桌面工具箱" subtitle="左侧是展开工具箱，这里是桌面专属能力。">
              <div className="grid gap-2 sm:grid-cols-2">
                <SecondaryButton label="检查更新" onClick={() => void handleCheckUpdate()} />
                <SecondaryButton label="下载并安装" onClick={() => void handleInstallUpdate()} />
                <SecondaryButton label="云存档" onClick={onOpenCloudSave} />
                <SecondaryButton label="更新公告" onClick={onOpenReleaseAnnouncements} />
                <SecondaryButton label="Discord 帖" onClick={onDiscordPost} />
                <SecondaryButton label="神秘聊天" onClick={onMysteryChat} />
              </div>
              <div className="mt-4 space-y-2 rounded-sm px-3 py-3 text-sm" style={{ background: 'rgba(53, 46, 39, 0.05)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}` }}>
                <SectionLabel text="版本信息" />
                <DesktopLine label="当前版本" value={desktopReleaseInfo?.title || `旅行者纪事 Desktop Edition ${appVersion}`} />
                <DesktopLine label="更新源" value={desktopReleaseInfo?.updateEndpoint || '读取中'} />
                <DesktopLine label="发布说明" value={releaseNotes} />
                {updateProgress && (
                  <>
                    <DesktopLine label="进度" value={updateProgress.phase} />
                    <DesktopLine label="已下载" value={`${formatSize(updateProgress.downloadedBytes)}${updateProgress.contentLength ? ` / ${formatSize(updateProgress.contentLength)}` : ''}`} />
                  </>
                )}
              </div>
              <div className="mt-4 rounded-sm px-3 py-3 text-sm" style={{ background: 'rgba(53, 46, 39, 0.05)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}` }}>
                <SectionLabel text="启动提示" />
                <div className="mt-2 text-[12px] leading-7" style={{ color: INK_MUTED }}>{continueHint}</div>
                {statusMessage && <div className="mt-2 text-[12px] leading-7" style={{ color: 'var(--journal-antique-gold)' }}>{statusMessage}</div>}
                {loadError && <div className="mt-2 text-[12px] leading-7" style={{ color: 'var(--tj-danger)' }}>{loadError}</div>}
              </div>
            </PaperPanel>
          </section>
        </main>
      </div>
    </div>
  );
}

// 手账内页纸卡：羊皮纸底 + 墨线框。
function PaperPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode; }) {
  return (
    <section
      className="flex min-h-0 flex-col gap-3 px-5 py-4"
      style={{
        background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 88%, var(--journal-leather) 12%))',
        boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}, 0 14px 34px rgba(0, 0, 0, 0.32)`,
        clipPath: cardClip,
      }}
    >
      <div className="flex items-baseline justify-between gap-3 pb-2" style={{ borderBottom: `1px solid rgba(53, 46, 39, 0.14)` }}>
        <div className="font-serif text-[17px] tracking-[0.16em]" style={{ color: INK }}>{title}</div>
        <p className="text-right text-[11px] leading-5" style={{ color: INK_MUTED }}>{subtitle}</p>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function DesktopLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-[12px] sm:grid-cols-[72px_1fr]">
      <span style={{ color: 'var(--journal-antique-gold)' }}>{label}</span>
      <span className="min-w-0 break-all leading-6" style={{ color: 'color-mix(in srgb, var(--journal-ink) 88%, transparent)' }}>{value}</span>
    </div>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="px-3 py-3" style={{ background: 'rgba(53, 46, 39, 0.04)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`, clipPath: smallClip }}>
      <div className="text-[11px] tracking-[0.18em]" style={{ color: 'var(--journal-antique-gold)' }}>{label}</div>
      <div className="mt-1 font-serif text-[15px] tracking-[0.12em]" style={{ color: INK }}>{value}</div>
      <div className="mt-1 text-[11px] leading-5" style={{ color: INK_MUTED }}>{detail}</div>
    </div>
  );
}

function ToolButton({ label, onClick, active, tone }: { label: string; onClick: () => void; active: boolean; tone: 'accent' | 'secondary'; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-[12px] tracking-[0.16em] transition-all hover:opacity-90"
      style={{
        color: tone === 'accent' ? 'var(--journal-leather-deep)' : 'rgba(239, 227, 201, 0.9)',
        background: active
          ? 'linear-gradient(135deg, #f0d58b, var(--journal-antique-gold))'
          : tone === 'accent'
            ? 'rgba(240, 213, 139, 0.14)'
            : 'rgba(239, 227, 201, 0.07)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(240, 213, 139, 0.7), 0 0 18px rgba(240, 213, 139, 0.12)'
          : tone === 'accent'
            ? 'inset 0 0 0 1px rgba(240, 213, 139, 0.42)'
            : 'inset 0 0 0 1px rgba(240, 213, 139, 0.2)',
        clipPath: smallClip,
      }}
    >
      {label}
    </button>
  );
}

function SecondaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2 text-[12px] tracking-[0.16em] transition-all hover:opacity-80"
      style={{
        color: 'color-mix(in srgb, var(--journal-ink) 90%, transparent)',
        background: 'rgba(53, 46, 39, 0.05)',
        boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`,
        clipPath: smallClip,
      }}
    >
      {label}
    </button>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <div className="text-[11px] tracking-[0.2em]" style={{ color: 'var(--journal-antique-gold)' }}>{text}</div>;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
