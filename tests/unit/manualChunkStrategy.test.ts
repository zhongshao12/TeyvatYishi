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
});
