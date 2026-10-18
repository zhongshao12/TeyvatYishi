import type { CoreScope } from '../contracts/identity';
import type { SourceRecord } from '../contracts/event';
import type { CommitReceipt } from '../contracts/operation';
import { settleCoreOperation, type SettlementDependencies } from './settleOperation';
import type { CoreInteractionDescriptor } from './interactionProjection';
import { projectCoreInteraction, coreDeliveryDescriptor, assertCoreDeliverySource, readCoreReplyAnchor } from './interactionProjection';
import { extractCoreFacts } from './factExtraction';
import type { SettleOperationInput } from './settleOperation';
import { stableJson, sameData } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { freezeSource } from '../sources/sourceRecords';
import { readCoreMomentOrigin } from './momentSources';

export interface CoreInteractionInput extends CoreInteractionDescriptor { scope: CoreScope; sessionId: string; source: SourceRecord; signal?: AbortSignal; modelOptions?: SettleOperationInput['modelOptions'] }
export async function commitCoreInteraction(input: CoreInteractionInput, deps: SettlementDependencies): Promise<CommitReceipt> {
  const owned = structuredClone({ ...input, signal: undefined }), prior = await deps.repo.readOperation(owned.scope, owned.source.operationId);
  const descriptor = coreDeliveryDescriptor(owned), deliveryRef = { sourceId: `delivery-${checksumUtf8(stableJson([owned.scope, owned.source.operationId, owned.source.ref]))}`, sourceVersion: 1 };
  const previousMessage = await deps.repo.readSource(owned.source.ref), savedDelivery = await deps.repo.readSource(deliveryRef);
  if (previousMessage && !sameData(previousMessage, owned.source)) throw Error('CORE2_INTERACTION_REPLAY_MISMATCH');
  if (savedDelivery) assertCoreDeliverySource(savedDelivery, descriptor, owned.source);
  if (prior?.receipt && ['committed', 'already_committed'].includes(prior.receipt.status)) {
    if (!previousMessage || !savedDelivery || !sameData(prior.sourceRefs, [owned.source.ref, deliveryRef])) throw Error('CORE2_INTERACTION_REPLAY_MISMATCH');
    return { ...prior.receipt, status: 'already_committed' };
  }
  // Check before persisting a bad draft; settlement repeats against its own captured state.
  const snapshot = await deps.repo.readState(owned.scope);
  projectCoreInteraction(snapshot, owned.source, owned, deps.rulePolicy.ruleVersion, await readCoreReplyAnchor(deps.repo, snapshot, owned), await readCoreMomentOrigin(deps.repo, snapshot, owned));
  const delivery = savedDelivery ?? { ...freezeSource({ scope: owned.scope, operationId: owned.source.operationId, kind: 'manual', moment: owned.source.moment, createdAt: owned.source.createdAt,
    blocks: [{ blockId: 'delivery', kind: 'configuration', text: stableJson(descriptor) }] }), ref: deliveryRef };
  return settleCoreOperation({ scope: owned.scope, sessionId: owned.sessionId, operationId: owned.source.operationId, kind: owned.target === 'moment' ? 'moment' : 'courier', sources: [owned.source, delivery], signal: input.signal, modelOptions: owned.modelOptions,
    interaction: descriptor }, {
    ...deps, factModel: async request => {
      const facts = await (deps.factModel ?? extractCoreFacts)(request);
      if (facts.kind !== 'extracted') return facts;
      // Phone speech is not evidence for physical state changes. Affinity uses the
      // existing deterministic exchange rule; promises still require explicit review.
      const playerId = request.snapshot.records.find(row => row.domain === 'traveler')?.entityId;
      return { ...facts, candidates: facts.candidates.filter(candidate => candidate.proposal.kind === 'commitment' && candidate.proposal.participantIds.every(id => id === playerId || descriptor.recipientIds.includes(id))) };
    },
  });
}
