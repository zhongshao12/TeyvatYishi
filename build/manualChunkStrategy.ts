export function resolveManualChunk(rawId: string): string | undefined {
  const id = rawId.replace(/\\/g, '/');
  if (!id.includes('/node_modules/')) {
    if (/\/hooks\/useGame\/(?:contextSnapshot|narrativeImageWorkflow|postSettlementRecoveryWorkflow|variableSettlementWorkflow|postSettlementCommitStage|sendPreparationStage|variableCalibrationStage|mainPromptAssembly|aiMessageStage|autoSaveStage|apiMessagesStage|elementalSettlementStage|memoryUpdateStage|worldCommitStage|mainNarrativeStreamingStage|mainNarrativeRequestStage)\.ts$/.test(id)) return undefined;
    if (id.includes('/prompts/')) return 'app-content';
    if (/\/data\/(?:storyWeavingCanonDecomposed|teyvatAvatarRegistry\.generated|canonicalCharacters|courierWorldbook|companionArchiveWorldbook|variableWorldbook|weatherRules|nsfwWorldbook|steambirdWorldbook|modelRecommendations|openingCompanionScenes|keyboardShortcutDefaults|teyvatAvatarNameOverrides|gameMenu|homeBackgrounds|questWorldbook|storyWeavingWorldbook|characterPresets|releaseAnnouncements|journeyPresets)\.(?:ts|json)$/.test(id)) {
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
