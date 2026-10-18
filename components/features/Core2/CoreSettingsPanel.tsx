import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import type { API设置, 游戏设置 } from '@/models/settings';
import type { 世界书 } from '@/models/worldbook';
import type { CoreSettingsStorage } from '@/core/view/settingsStorage';
import { SettingsPersistenceProvider, type SettingsPersistence } from '../Settings/SettingsPersistence';
import { Modal, ConfirmDialogHost, useConfirmDialog } from '@/components/ui/Modal';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { sameData } from '@/core/persistence/repositoryValidation';

const Api = lazy(() => import('../Settings/ApiSettings').then(module => ({ default: module.ApiSettingsTab })));
const Image = lazy(() => import('../Settings/ImageGenerationSettingsTab').then(module => ({ default: module.ImageGenerationSettingsTab })));
const Prompts = lazy(() => import('../Settings/PromptModulesTab').then(module => ({ default: module.PromptModulesTab })));
const Tavern = lazy(() => import('../Settings/TavernPresetsSettingsTab').then(module => ({ default: module.TavernPresetsSettingsTab })));
const tabs = { api: 'API 接口', image: '生图设置', presets: '酒馆预设', prompts: '提示词模块' } as const;
export interface CoreSettingsValues { gameSettings?: 游戏设置; apiSettings?: API设置; worldbooks?: 世界书[] }
interface Props { settings: 游戏设置; api: API设置; worldbooks: 世界书[]; storage: CoreSettingsStorage; onApply(values: CoreSettingsValues): void }

/** Reuse complete editors, not the legacy modal's writable game-state props. */
export function CoreSettingsPanel(props: Props) {
  const { storage, onApply } = props;
  const [open, setOpen] = useState(false), [tab, setTab] = useState<keyof typeof tabs>('api');
  const [settings, setSettings] = useState(props.settings), [api, setApi] = useState(props.api), [worldbooks, setBooks] = useState(props.worldbooks);
  const [dirtyPreset, setDirtyPreset] = useState(false), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const draft = useRef({ gameSettings: settings, apiSettings: api, worldbooks }), saved = useRef<CoreSettingsValues>(draft.current), writes = useRef(0);
  draft.current = { gameSettings: settings, apiSettings: api, worldbooks };
  const confirm = useConfirmDialog();
  const persistence = useMemo<SettingsPersistence>(() => {
    const saveSettings = async (input: Record<string, unknown>) => {
      const values = structuredClone(input); writes.current++; setBusy(true);
      try {
        await storage.saveSettings(values); onApply(values as CoreSettingsValues); saved.current = { ...saved.current, ...values };
        setDirty(!sameData(draft.current, saved.current)); setMessage('设置已保存；新的请求使用新配置。');
      } finally { writes.current--; if (!writes.current) setBusy(false); }
    };
    return { loadSetting: key => storage.loadSetting(key), saveSettings, saveSetting: (key, value) => saveSettings({ [key]: value }) };
  }, [storage, onApply]);
  const gameChange = (value: 游戏设置) => { setSettings(value); setDirty(true); setMessage(''); };
  const apiChange = (value: API设置) => { setApi(value); setDirty(true); setMessage(''); };
  const booksChange = (value: 世界书[]) => { setBooks(value); setDirty(true); setMessage(''); };
  const switchTab = async (next: keyof typeof tabs) => {
    if (next === tab) return;
    if (dirtyPreset && next !== tab && !await confirm.confirm({ title: '预设修改尚未保存', message: '切换会丢弃当前预设编辑草稿，是否继续？', confirmLabel: '放弃草稿并切换' })) return;
    setDirtyPreset(false); setTab(next);
  };
  const close = async () => {
    if ((dirty || dirtyPreset) && !await confirm.confirm({ title: '设置修改尚未全部保存', message: '关闭会丢弃未保存内容；已经点击保存的设置不受影响。', confirmLabel: '关闭并丢弃未保存内容' })) return;
    setOpen(false);
  };
  const save = async () => {
    if (dirtyPreset) { setMessage('请先在酒馆预设中点击“保存修改”，再保存其它设置。'); return; }
    setBusy(true); setMessage('');
    try { await persistence.saveSettings({ gameSettings: settings, apiSettings: api, worldbooks }); setDirty(false); }
    catch (error) { setMessage('保存失败：' + sanitizeApiErrorReportText(String(error))); }
    finally { setBusy(false); }
  };
  return <><button onClick={() => { saved.current = { gameSettings: props.settings, apiSettings: props.api, worldbooks: props.worldbooks }; setSettings(props.settings); setApi(props.api); setBooks(props.worldbooks); setDirty(false); setDirtyPreset(false); setMessage(''); setOpen(true); }}>设置</button>
    {open && <Modal title="手账设置" portal onClose={() => { if (!busy) void close(); }} className="core2-settings-modal"><SettingsPersistenceProvider value={persistence}>
      <section className="core2-settings"><nav aria-label="设置分类">{(Object.keys(tabs) as (keyof typeof tabs)[]).map(key => <button key={key} disabled={busy} aria-pressed={tab === key} onClick={() => void switchTab(key)}>{tabs[key]}</button>)}</nav>
        <p>配置单独保存，不修改旧存档。API 密钥仍按现有规则保存在本机，请勿分享本机配置文件。</p>
        <Suspense fallback={<p role="status">正在翻开设置……</p>}>
          {tab === 'api' ? <Api settings={api} onChange={apiChange} gameSettings={settings} onGameSettingsChange={gameChange} />
            : tab === 'image' ? <Image settings={settings} onChange={gameChange} apiSettings={api} />
              : tab === 'presets' ? <Tavern settings={settings} onChange={gameChange} apiSettings={api} onApiSettingsChange={apiChange} worldbooks={worldbooks} onWorldbooksChange={booksChange}
                onImportedPresetDirtyChange={setDirtyPreset} onSaveImportedPreset={async next => { await persistence.saveSetting('gameSettings', next); setSettings(next); setDirtyPreset(false); }} />
                : <Prompts settings={settings} onChange={gameChange} apiSettings={api} onApiSettingsChange={apiChange} worldbooks={worldbooks} onWorldbooksChange={booksChange} />}
        </Suspense><button disabled={busy} onClick={() => void save()}>{busy ? '正在保存……' : '保存全部设置'}</button>{message && <p role="status">{message}</p>}
      </section>
    </SettingsPersistenceProvider></Modal>}
    <ConfirmDialogHost dialog={confirm} />
  </>;
}
