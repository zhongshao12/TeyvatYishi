import type { 提示词模块, 提示词模块类目 } from '@/models/prompts';

type 独立系统提示词目标 =
  | 'steambird'
  | 'courier'
  | 'variable'
  | 'codex'
  | 'irminsulRecall'
  | 'irminsulArchive'
  | 'storyWeaving';

const TARGET_ID_MATCHERS: Record<独立系统提示词目标, readonly ((id: string) => boolean)[]> = {
  steambird: [
    (id) => id.startsWith('builtin_steambird_'),
    (id) => id.startsWith('custom_steambird_'),
    (id) => id.startsWith('st_import_steambird_'),
  ],
  courier: [
    (id) => id.startsWith('builtin_courier_'),
    (id) => id.startsWith('custom_courier_'),
    (id) => id.startsWith('st_import_courier_'),
  ],
  variable: [
    (id) => id.startsWith('builtin_variable_'),
    (id) => id === 'builtin_companion_archive_worldbook',
  ],
  codex: [
    (id) => id.startsWith('builtin_codex_'),
    (id) => id.startsWith('custom_codex_'),
    (id) => id.startsWith('st_import_codex_'),
  ],
  irminsulRecall: [
    (id) => id === 'builtin_irminsul_recall',
    (id) => id.startsWith('custom_irminsul_recall_'),
    (id) => id.startsWith('st_import_irminsul_recall_'),
  ],
  irminsulArchive: [
    (id) => id.startsWith('builtin_irminsul_archive_'),
    (id) => id.startsWith('custom_irminsul_archive_'),
    (id) => id.startsWith('st_import_irminsul_archive_'),
  ],
  storyWeaving: [(id) => id.startsWith('builtin_story_weaving_')],
};

interface 独立系统提示词过滤选项 {
  category?: 提示词模块类目;
}

export function filterIndependentPromptModules(
  promptModules: 提示词模块[] | undefined,
  target: 独立系统提示词目标,
  options: 独立系统提示词过滤选项 = {},
): 提示词模块[] {
  if (!promptModules?.length) return [];
  const matchers = TARGET_ID_MATCHERS[target];
  return promptModules
    .filter((module) => {
      if (!module.enabled) return false;
      if (!module.scope?.includes('calibration')) return false;
      if (options.category && module.category !== options.category) return false;
      return matchers.some((matches) => matches(module.id));
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
