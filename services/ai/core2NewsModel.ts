import type { API配置项, 蒸汽鸟报系统设置 } from '@/models/settings';
import { 归一化蒸汽鸟报系统设置 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreNewsModels } from '@/core/jobs/newsJob';
import { generateCoreNews } from '@/core/retrieval/newsContext';
import { resolveSteambirdApiConfig } from './steambirdModel';
import { coreTextModelIdentity } from './core2ConsumerModel';

export function createCore2NewsPort(input: { repo: CoreRepository; mainConfig: API配置项 | null; settings: 蒸汽鸟报系统设置; promptModules: 提示词模块[] }): CoreNewsModels {
  const settings = 归一化蒸汽鸟报系统设置(structuredClone(input.settings)), modules = structuredClone(input.promptModules), config = resolveSteambirdApiConfig(settings.api, input.mainConfig);
  const identity = !settings.enabled ? 'disabled' : config ? coreTextModelIdentity(config, modules, 'news') : 'unconfigured';
  return { getModelIdentity: () => identity,
    getAutomaticInterval: () => settings.enabled && settings.autoGenerate ? settings.generateIntervalTurns : undefined,
    async generate(snapshot, signal) {
      if (!settings.enabled) throw Error('蒸汽鸟报已关闭，没有调用模型。');
      if (!config) throw Error('蒸汽鸟报独立模型未配置，请先在设置中选择接口。');
      return generateCoreNews({ snapshot, config, promptModules: modules, maxEntries: settings.maxNewEntriesPerTurn, signal }, { repo: input.repo });
    },
  };
}
