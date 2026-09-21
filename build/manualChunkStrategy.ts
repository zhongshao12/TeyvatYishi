export function resolveManualChunk(rawId: string): string | undefined {
  const id = rawId.replace(/\\/g, '/');
  if (!id.includes('/node_modules/')) {
    if (/\/hooks\/useGame\/(?:contextSnapshot|narrativeImageWorkflow|postSettlementRecoveryWorkflow|variableSettlementWorkflow|postSettlementCommitStage|sendPreparationStage|variableCalibrationStage|mainPromptAssembly|aiMessageStage|autoSaveStage|apiMessagesStage|elementalSettlementStage|memoryUpdateStage|worldCommitStage|mainNarrativeStreamingStage|mainNarrativeRequestStage)\.ts$/.test(id)) return undefined;
    if (id.includes('/prompts/')) return 'app-content';
    // C1（第二轮审计）：这 6 个数据模块原先不在白名单里，而它们被 models/settings.ts 等
    // app-core 模块**静态引入**、没有动态 import 边界 → 只能落进 app-core（首屏）。
    // 它们的体积实测合计约 347.6 KB（builtinPromptModules 200.7 / codexPreset 50.1 /
    // builtinWorldbookConfig 34.1 / codexIdentityRegistry 29.5 / storyModeWorldbooks 20.2 /
    // codexCustomGovernance 13.0），移到 app-content 后可把首屏砍掉约五分之一。
    if (/\/data\/(?:storyWeavingCanonDecomposed|teyvatAvatarRegistry\.generated|canonicalCharacters|courierWorldbook|companionArchiveWorldbook|variableWorldbook|weatherRules|nsfwWorldbook|steambirdWorldbook|modelRecommendations|openingCompanionScenes|keyboardShortcutDefaults|teyvatAvatarNameOverrides|gameMenu|homeBackgrounds|questWorldbook|storyWeavingWorldbook|characterPresets|releaseAnnouncements|journeyPresets|builtinPromptModules|codexPreset|builtinWorldbookConfig|codexIdentityRegistry|storyModeWorldbooks|codexCustomGovernance)\.(?:ts|json)$/.test(id)) {
      return 'app-content';
    }
    if (id.includes('/services/') || id.includes('/hooks/') || id.includes('/models/')) return 'app-core';
    return undefined;
  }

  const marker = id.lastIndexOf('node_modules/');
  const rest = id.slice(marker + 'node_modules/'.length);
  const pkg = rest.startsWith('@') ? rest.split('/').slice(0, 2).join('/') : (rest.split('/')[0] ?? '');
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
  if (pkg === 'lucide-react') return 'vendor-icons';
  if (pkg.startsWith('@dnd-kit')) return 'vendor-dnd';
  return 'vendor-other';
}
