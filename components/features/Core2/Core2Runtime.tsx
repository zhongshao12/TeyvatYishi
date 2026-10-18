import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCoreRepository } from '@/core/persistence/repositoryFactory';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSessionPointer } from '@/core/view/coreGameController';
import { validateCoreDto } from '@/core/contracts/validation';
import { createCoreSettingsStorage, readExistingCore2Setting } from '@/core/view/existingSettings';
import type { CoreSettingsStorage, CoreSettingsKey } from '@/core/view/settingsStorage';
import type { 世界书 } from '@/models/worldbook';
import { 创建空API设置, 创建默认游戏设置, 归一化记忆系统设置, type API设置, type 游戏设置 } from '@/models/settings';
import { resolveActiveApiConfig } from '@/services/ai/activeApiConfig';
import { resolveVariableSettlementApiConfig } from '@/services/ai/variableApiConfig';
import { generateCore2Narrative } from '@/services/ai/core2NarrativeModel';
import { extractCoreFacts } from '@/core/settlement/factExtraction';
import { buildCoreMainContext } from '@/core/retrieval/consumerContext';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { useCore2Game } from '@/hooks/useCore2Game';
import { Core2App } from './Core2App';
import { createCore2MemoryModel } from '@/services/ai/core2MemoryModel';
import { createCore2PhonePort } from '@/services/ai/core2ConsumerModel';
import { createCore2NewsPort } from '@/services/ai/core2NewsModel';
import { createCore2ImagePort } from '@/services/ai/core2ImageModel';
import { createCoreImagePromptLibrary } from '@/core/view/imagePromptLibrary';
import { createCoreProfileCatalog } from '@/core/content/profileCatalog';
import { createCoreStoryResources } from '@/core/content/storyCatalog';
import { attachCoreStoryResources, type CoreStoryResources } from '@/core/content/storyContext';
import { buildCanonicalElementTalents } from '@/data/canonicalTravelerPresets';
import { ELEMENT_IDS } from '@/models/teyvat/elements';
import { createCoreCodexCatalog } from '@/core/content/codexCatalog';
import { CoreSettingsPanel, type CoreSettingsValues } from './CoreSettingsPanel';

const POINTER_KEY = 'teyvat-core2-navigation-v1';
type RuntimeData = { repo: CoreRepository; settings: 游戏设置; api: API设置; worldbooks: 世界书[]; storage: CoreSettingsStorage };
function RuntimeSession({ repo, settings: initialSettings, api: initialApi, worldbooks: initialBooks, storage }: RuntimeData) {
  const [settings, setSettings] = useState(initialSettings), [api, setApi] = useState(initialApi), [worldbooks, setBooks] = useState(initialBooks);
  const applySettings = useCallback((values: CoreSettingsValues) => { if (values.gameSettings) setSettings(values.gameSettings); if (values.apiSettings) setApi(values.apiSettings); if (values.worldbooks) setBooks(values.worldbooks); }, []);
  const main = resolveActiveApiConfig(api, settings.enableClaudeMode);
  const memory = 归一化记忆系统设置(settings.记忆系统);
  const imagePromptLibrary = useMemo(() => createCoreImagePromptLibrary(storage), [storage]);
  const contentCatalog = useMemo(() => createCoreCodexCatalog(async () => (await import('@/data/codexPreset')).loadAllBundledCodexPresets()), []);
  const stories = useMemo<CoreStoryResources>(() => {
    let loaded: CoreStoryResources | undefined, loading: Promise<CoreStoryResources> | undefined;
    const get = async () => {
      if (!loading) {
        loading = import('@/data/storyWeavingPreset').then(data => {
          loaded = createCoreStoryResources(data.bundledStoryWeavingPresets.map(item => item.id), async id => {
            const preset = data.bundledStoryWeavingPresets.find(item => item.id === id);
            const resource = preset && await data.loadBundledStoryWeavingPreset(preset);
            if (!resource) throw Error(`无法读取原著剧情资源：${id}`); return resource;
          }); return loaded;
        });
        void loading.catch(() => { loading = undefined; });
      }
      return loading;
    };
    return { getNodes: snapshot => loaded?.getNodes(snapshot) ?? [], prepare: async (snapshot, signal) => (await get()).prepare(snapshot, signal) };
  }, []);
  const controller = useCore2Game(repo, {
    imagePromptLibrary,
    profileCatalog: createCoreProfileCatalog(),
    storyResources: stories,
    contentCatalog,
    phoneModels: createCore2PhonePort({ mainConfig: main, settings: settings.手机系统, promptModules: settings.promptModules }),
    newsModels: createCore2NewsPort({ repo, mainConfig: main, settings: settings.蒸汽鸟报系统, promptModules: settings.promptModules }),
    imageModels: createCore2ImagePort(settings.文生图系统, main),
    savePointer: pointer => localStorage.setItem(POINTER_KEY, JSON.stringify(pointer)),
    memoryModels: { summarize: request => main ? createCore2MemoryModel(main, memory)(request) : Promise.resolve({ kind: 'failed', code: 'CORE2_MEMORY_API_MISSING', detail: '记忆总结 API 未配置，原始事件已保存，可在配置后重试。' }) },
    turnDependencies: () => attachCoreStoryResources({
      summarySettings: { mode: memory.启用中短长期API总结 ? 'model' : 'local', shortThreshold: Math.max(2, memory.即时转短期阈值), middleThreshold: Math.max(2, memory.短期转中期阈值), longThreshold: Math.max(2, memory.中期转长期阈值), prompt: memory.即时转短期提示词 },
      rulePolicy: { ruleVersion: 'core2-v1', storyNodes: [], talents: ELEMENT_IDS.flatMap(buildCanonicalElementTalents) },
      assembleContext: input => buildCoreMainContext(input, settings, { repo, contentCatalog, worldbooks }),
      generateNarrative: input => generateCore2Narrative({ ...input, config: main ?? undefined }),
      factModel: input => extractCoreFacts({ ...input, config: main ? resolveVariableSettlementApiConfig(main, settings.variableApi).config : undefined, promptModules: settings.promptModules }),
    }, stories),
  });
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(POINTER_KEY) ?? 'null');
      if (raw && typeof raw === 'object' && 'scope' in raw && validateCoreDto('scope', raw.scope).ok
        && Object.keys(raw).every(key => ['scope', 'pendingOperationId', 'manualSlotId'].includes(key))
        && (!('pendingOperationId' in raw) || typeof raw.pendingOperationId === 'string') && (!('manualSlotId' in raw) || typeof raw.manualSlotId === 'string')) {
        void controller.attach(raw as CoreSessionPointer).catch(failure => { if (live) setError(controller.getView().snapshot ? `存档已接入，但部分剧情资料未能载入：${sanitizeApiErrorReportText(String(failure))}。未重置剧情或删除存档。` : `恢复位置不可用：${sanitizeApiErrorReportText(String(failure))}。可以建立全新旅程；没有删除任何存档。`); });
      }
    } catch (failure) { setError(`无法读取恢复位置：${sanitizeApiErrorReportText(String(failure))}`); }
    return () => { live = false; };
  }, [controller]);
  return <div className="core2-runtime">{error && <p role="alert">{error}</p>}<div className="core2-runtime-settings"><CoreSettingsPanel {...{ settings, api, worldbooks, storage }} onApply={applySettings} /></div><Core2App controller={controller} repo={repo} /></div>;
}
export default function Core2Runtime() {
  const [data, setData] = useState<RuntimeData | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const own = createCoreSettingsStorage(), storage: CoreSettingsStorage = { ...own, loadSetting: async <T,>(key: string) => await own.loadSetting<T>(key) ?? await readExistingCore2Setting<T>(key as CoreSettingsKey) };
    void Promise.all([createCoreRepository(isDesktopRuntime() ? 'desktop' : 'web'), storage.loadSetting<游戏设置>('gameSettings'), storage.loadSetting<API设置>('apiSettings'), storage.loadSetting<世界书[]>('worldbooks')])
      .then(([repo, settings, api, worldbooks]) => { if (live) setData({ repo, storage, settings: { ...创建默认游戏设置(), ...settings }, api: api ?? 创建空API设置(), worldbooks: worldbooks ?? [] }); })
      .catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; };
  }, []);
  return error ? <p role="alert">新内核未能启动：{error}</p> : data ? <RuntimeSession {...data} /> : <p role="status">正在翻开独立的新手账……</p>;
}
