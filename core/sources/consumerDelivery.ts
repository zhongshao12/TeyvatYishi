import type { PromptDeliveryAudit } from '../contracts/event';
import type { MemoryContextBundle } from '../retrieval/recallTypes';

/** Call only with the context already passed to the consumer's model port. */
export function consumerDelivery(bundle: MemoryContextBundle, target: 'private' | 'group' | 'moment', npcId: string): PromptDeliveryAudit {
  return { version: 1, bundles: [{ bundleId: bundle.bundleId, target, npcIds: [npcId], selectedLeafIds: bundle.selectedLeafIds }], worldbookEntryIds: [] };
}
