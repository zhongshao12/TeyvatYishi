import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { 世界状态 } from '@/models/world';
import type { SteambirdGenerationStepResult } from './steambirdWorkflow';

/** Opening settings are private. The same post-turn AI task runs only after actual narrative settlement. */
export function buildOpeningSteambirdPreprocess(_params: { current: SteambirdNews; world: 世界状态; turnCount: number; now?: number }): SteambirdGenerationStepResult | null { return null; }
