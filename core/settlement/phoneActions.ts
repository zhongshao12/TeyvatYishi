import type { CoreScope } from '../contracts/identity';
import type { SettlementDependencies } from './settleOperation';
import { freezeSource } from '../sources/sourceRecords';
import { commitCoreInteraction } from './consumerOperations';
import type { CoreInteractionDescriptor } from './interactionProjection';
import { selectCoreReplyRecipients } from '../retrieval/consumerContext';
import { sameScope } from '../persistence/repositoryValidation';

export interface CorePhoneSend { conversationId: string; text: string; operationId: string }
/** Register the player's message and every selected reply job in ONE core commit. */
export async function sendCorePhoneMessage(input: CorePhoneSend & { scope: CoreScope; sessionId: string; modelIdentity: string }, deps: SettlementDependencies) {
  const owned = structuredClone(input), snapshot = await deps.repo.readState(owned.scope), player = snapshot.records.find(row => row.domain === 'traveler'), world = snapshot.records.find(row => row.domain === 'world');
  if (snapshot.head.sessionId !== owned.sessionId || !sameScope(snapshot.head.scope, owned.scope) || player?.domain !== 'traveler' || world?.domain !== 'world' || !owned.text.trim()) throw Error('CORE2_PHONE_SEND_NOT_READY');
  const prior = await deps.repo.readOperation(owned.scope, owned.operationId), sources = prior ? await Promise.all(prior.sourceRefs.map(ref => deps.repo.readSource(ref))) : [];
  const savedMessage = sources.find(source => source?.kind === 'courier'), delivery = sources.find(source => source?.kind === 'manual');
  if (prior && (!savedMessage || !delivery || savedMessage.blocks.length !== 1 || savedMessage.blocks[0]!.text !== owned.text.trim() || savedMessage.blocks[0]!.speakerId !== player.entityId)) throw Error('CORE2_INTERACTION_REPLAY_MISMATCH');
  const selected = prior ? null : selectCoreReplyRecipients({ snapshot, conversationId: owned.conversationId, messageId: owned.operationId, text: owned.text });
  const descriptor: CoreInteractionDescriptor = delivery ? JSON.parse(delivery.blocks[0]!.text) : { target: selected!.target, channelId: owned.conversationId, recipientIds: selected!.memberIds, responsePlan: { npcIds: selected!.npcIds, modelIdentity: owned.modelIdentity } };
  if (descriptor.channelId !== owned.conversationId || !descriptor.responsePlan) throw Error('CORE2_INTERACTION_REPLAY_MISMATCH');
  const source = savedMessage ?? freezeSource({ scope: owned.scope, operationId: owned.operationId, kind: 'courier', moment: world.value.moment, blocks: [{ blockId: 'player-message', kind: 'message', speakerId: player.entityId, text: owned.text.trim() }] });
  return commitCoreInteraction({ ...descriptor, scope: owned.scope, sessionId: owned.sessionId, source }, { ...deps,
    // A player's sent intention is a transcript, never a physical-world update.
    factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
  });
}
