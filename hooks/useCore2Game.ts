import { useEffect, useMemo, useRef } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreController, type CoreControllerDependencies } from '@/core/settlement/coreController';

export function useCore2Game(repo: CoreRepository, options: Omit<CoreControllerDependencies, 'repo'>) {
  const latest = useRef(options); latest.current = options;
  const lease = useMemo(() => ({ mounted: false, controller: createCoreController({ repo,
    imagePromptLibrary: options.imagePromptLibrary,
    profileCatalog: { read: (identity, signal) => latest.current.profileCatalog?.read(identity, signal) ?? Promise.reject(Error('公开档案资料未配置。')) },
    turnDependencies: () => latest.current.turnDependencies(),
    savePointer: pointer => latest.current.savePointer?.(pointer),
    memoryModels: { summarize: request => latest.current.memoryModels?.summarize?.(request) ?? Promise.resolve({ kind: 'failed', code: 'CORE2_MEMORY_MODEL_MISSING', detail: '记忆模型尚未配置，原始事件已保存。' }) },
    phoneModels: {
      generate: request => latest.current.phoneModels?.generate(request) ?? Promise.reject(Error('手机回复 API 未配置；玩家消息已保存，可在配置后重试。')),
      getModelIdentity: () => latest.current.phoneModels?.getModelIdentity() ?? 'unconfigured',
    },
    newsModels: {
      generate: (snapshot, signal) => latest.current.newsModels?.generate(snapshot, signal) ?? Promise.reject(Error('蒸汽鸟报独立模型未配置。')),
      getModelIdentity: () => latest.current.newsModels?.getModelIdentity() ?? 'unconfigured',
      getAutomaticInterval: () => latest.current.newsModels?.getAutomaticInterval?.(),
    },
    imageModels: {
      prepare: (snapshot, input, signal) => latest.current.imageModels?.prepare?.(snapshot, input, signal) ?? Promise.reject(Error('尚未配置图片提示词准备接口。')),
      generate: (request, signal) => latest.current.imageModels?.generate(request, signal) ?? Promise.reject(Error('生图接口尚未配置。')),
      getModelIdentity: () => latest.current.imageModels?.getModelIdentity() ?? 'unconfigured',
    },
    storyResources: {
      getNodes: snapshot => latest.current.storyResources?.getNodes(snapshot) ?? [],
      prepare: (snapshot, signal) => latest.current.storyResources?.prepare(snapshot, signal) ?? Promise.reject(Error('当前运行入口未配置剧情资料。')),
    },
    contentCatalog: {
      read: signal => latest.current.contentCatalog?.read(signal) ?? Promise.reject(Error('当前运行入口未配置提瓦特图鉴。')),
      select: input => latest.current.contentCatalog?.select(input) ?? Promise.resolve([]),
    },
  }) }), [repo, options.imagePromptLibrary]);
  useEffect(() => {
    lease.mounted = true;
    return () => { lease.mounted = false; queueMicrotask(() => { if (!lease.mounted) lease.controller.dispose(); }); };
  }, [lease]);
  return lease.controller;
}
