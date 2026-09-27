import type { PromptDeliveryTarget, 提示词模块, 提示词模块类目 } from '@/models/prompts';
import { resolvePromptDeliveryTargets } from '@/services/promptDelivery';

type 独立系统提示词目标 = Exclude<PromptDeliveryTarget, 'main'>;

interface 独立系统提示词过滤选项 {
  category?: 提示词模块类目;
}

export function filterIndependentPromptModules(
  promptModules: 提示词模块[] | undefined,
  target: 独立系统提示词目标,
  options: 独立系统提示词过滤选项 = {},
): 提示词模块[] {
  if (!promptModules?.length) return [];
  return promptModules
    .filter((module) => {
      if (!module.enabled) return false;
      if (!module.scope?.includes('calibration')) return false;
      if (options.category && module.category !== options.category) return false;
      return resolvePromptDeliveryTargets(module).includes(target);
    })
    .sort((a, b) => a.order - b.order);
}

export function buildIndependentPromptModulesSection(
  promptModules: 提示词模块[] | undefined,
  target: 独立系统提示词目标,
  options: 独立系统提示词过滤选项 = {},
): string {
  return filterIndependentPromptModules(promptModules, target, options)
    .map((module) => module.content)
    .join('\n\n');
}
