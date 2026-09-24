import { describe, expect, it } from 'vitest';
import { resolveManualChunk } from '@/build/manualChunkStrategy';

describe('manual chunk strategy', () => {
  it('keeps mutually dependent first-party runtime layers in one cycle-safe core chunk', () => {
    expect(resolveManualChunk('/repo/services/ai/chatCompletionClient.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/services/storage/saveCatalog.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/services/desktop/desktopSaveMirror.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/services/dbService.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/hooks/useGame/sendWorkflow.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/models/teyvat/state.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/services/storyProgressService.ts')).toBe('app-core');
    expect(resolveManualChunk('/repo/components/layout/GameView.tsx')).toBeUndefined();
  });

  it('leaves lazy workflow entry modules to Rollup so they become real async chunks', () => {
    expect(resolveManualChunk('/repo/hooks/useGame/narrativeImageWorkflow.ts')).toBeUndefined();
    expect(resolveManualChunk('/repo/hooks/useGame/postSettlementRecoveryWorkflow.ts')).toBeUndefined();
    expect(resolveManualChunk('/repo/hooks/useGame/variableSettlementWorkflow.ts')).toBeUndefined();
    expect(resolveManualChunk('/repo/hooks/useGame/postSettlementCommitStage.ts')).toBeUndefined();
    expect(resolveManualChunk('/repo/hooks/useGame/contextSnapshot.ts')).toBeUndefined();
    // 主叙事请求装配阶段：原先只被 sendWorkflow 的**死 import** 静态引用而被迫并入
    // app-core（白名单漏登记 + 静态边），两者都必须不复存在，否则它就回不到异步分包。
    expect(resolveManualChunk('/repo/hooks/useGame/mainNarrativeRequestStage.ts')).toBeUndefined();
  });

  it('keeps vendor packages in stable package-oriented chunks', () => {
    expect(resolveManualChunk('/repo/node_modules/react/index.js')).toBe('vendor-react');
    expect(resolveManualChunk('/repo/node_modules/lucide-react/dist/index.js')).toBe('vendor-icons');
    expect(resolveManualChunk('/repo/node_modules/@dnd-kit/core/dist/index.js')).toBe('vendor-dnd');
    expect(resolveManualChunk('/repo/node_modules/other/index.js')).toBe('vendor-other');
  });

  it('extracts only dependency-leaf content modules into a cacheable first-party chunk', () => {
    expect(resolveManualChunk('/repo/prompts/subsystems/questPrompt.ts')).toBe('app-content');
    expect(resolveManualChunk('/repo/data/journeyPresets.ts')).toBe('app-content');
    expect(resolveManualChunk('/repo/data/canonicalCharacters.ts')).toBe('app-content');
    expect(resolveManualChunk('/repo/data/storyWeavingCanonDecomposed.json')).toBe('app-content');
  });

  it('keeps content data and its runtime providers in the same chunk to avoid a core-content cycle', () => {
    const edges = [
      ['/repo/data/builtinWorldbookConfig.ts', '/repo/services/elementalAttunementService.ts'],
      ['/repo/data/builtinPromptModules.ts', '/repo/models/prompts.ts'],
      ['/repo/data/codexCustomGovernance.ts', '/repo/models/codexArchive.ts'],
      ['/repo/data/codexIdentityRegistry.ts', '/repo/models/codexGovernance.ts'],
      ['/repo/data/codexPreset.ts', '/repo/models/codexArchive.ts'],
      ['/repo/services/elementalAttunementService.ts', '/repo/models/teyvat/elements.ts'],
      ['/repo/models/codexArchive.ts', '/repo/compat/legacy-hsr/readOnly.ts'],
      ['/repo/data/codexPreset.ts', '/repo/compat/legacy-hsr/readOnly.ts'],
      ['/repo/data/keyboardShortcutDefaults.ts', '/repo/utils/valueGuards.ts'],
    ] as const;
    for (const [consumer, provider] of edges) {
      expect(resolveManualChunk(provider), `${consumer} imports ${provider}`).toBe(resolveManualChunk(consumer));
    }
  });
});
