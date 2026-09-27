import type { PromptDeliveryTarget, 提示词模块 } from '@/models/prompts';

export const PROMPT_DELIVERY_TARGETS: readonly PromptDeliveryTarget[] = [
  'main', 'variable', 'courier', 'steambird', 'codex',
  'irminsulRecall', 'irminsulArchive', 'storyWeaving',
];

export const PROMPT_DELIVERY_LABELS: Record<PromptDeliveryTarget, string> = {
  main: '主剧情', variable: '变量', courier: '手机', steambird: '蒸汽鸟报',
  codex: '图鉴', irminsulRecall: '世界树召回',
  irminsulArchive: '世界树归档', storyWeaving: '剧情编织',
};

export function resolvePromptDeliveryTargets(module: 提示词模块): PromptDeliveryTarget[] {
  if (module.deliveryTargets) return [...new Set(module.deliveryTargets)];
  if (!module.scope?.includes('calibration')) return ['main'];
  return [];
}
