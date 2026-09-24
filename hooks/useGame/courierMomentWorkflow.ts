import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, type NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import type { CourierMoment, CourierSystem } from '@/models/teyvat/courier';
import { buildCourierSenderProfile } from '@/services/ai/courierService';
import type { MomentCommentInput } from '@/services/ai/courierMomentComments';
import { appendMomentComment, markMomentTarget, selectMomentCommenters } from '@/services/courierMoments';

const inFlightComments = new Set<string>();

export interface MomentWorkflowDeps {
  getSessionId: () => number;
  getCourier: () => CourierSystem;
  setCourier: (update: (old: CourierSystem) => CourierSystem) => void;
  getNpcs: () => NPC记录[];
  getApiConfig: () => API配置项 | null;
  generateComment: (config: API配置项, input: MomentCommentInput) => Promise<string>;
}

function currentPost(deps: MomentWorkflowDeps, postId: string, revision: number): CourierMoment | undefined {
  return deps.getCourier().moments?.find((post) => post.id === postId && post.revision === revision);
}

function eligibleNpc(deps: MomentWorkflowDeps, npcId: string): NPC记录 | undefined {
  const hasContact = deps.getCourier().contacts.some((contact) => contact.available && contact.npcId === npcId);
  if (!hasContact) return undefined;
  const npc = deps.getNpcs().find((entry) => entry.id === npcId);
  return npc && npc.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD ? npc : undefined;
}

/** Each selected companion owns one independent, revision-guarded comment job. */
export async function runMomentComments(deps: MomentWorkflowDeps, postId: string, revision: number, retryNpcId?: string): Promise<void> {
  const sessionId = deps.getSessionId();
  const post = currentPost(deps, postId, revision);
  if (!post) return;
  const selectedIds = retryNpcId
    ? post.targets.some((target) => target.npcId === retryNpcId && target.status === 'failed') ? [retryNpcId] : []
    : post.targets.length
      ? post.targets.map((target) => target.npcId)
      : selectMomentCommenters(post.id, deps.getCourier().contacts, deps.getNpcs()).map((npc) => npc.id);
  const workIds = selectedIds.slice(0, 3).filter((npcId) => {
    const target = post.targets.find((entry) => entry.npcId === npcId);
    return target?.status !== 'done' && target?.status !== 'generating' && Boolean(eligibleNpc(deps, npcId));
  });
  const claimKey = (npcId: string) => JSON.stringify([sessionId, postId, revision, npcId]);
  const claimedIds = workIds.filter((npcId) => {
    const key = claimKey(npcId);
    if (inFlightComments.has(key)) return false;
    inFlightComments.add(key);
    return true;
  });
  if (!claimedIds.length) return;

  try {
    deps.setCourier((old) => {
      if (deps.getSessionId() !== sessionId) return old;
      let updated = old;
      for (const npcId of claimedIds) updated = markMomentTarget(updated, postId, revision, npcId, 'generating');
      return updated;
    });
  } catch (error) {
    for (const npcId of claimedIds) inFlightComments.delete(claimKey(npcId));
    throw error;
  }

  await Promise.all(claimedIds.map(async (npcId) => {
    const stillCurrent = () => deps.getSessionId() === sessionId && Boolean(currentPost(deps, postId, revision));
    if (!stillCurrent()) return;
    const npc = eligibleNpc(deps, npcId);
    const config = deps.getApiConfig();
    if (!npc || !config) {
      if (stillCurrent()) deps.setCourier((old) => markMomentTarget(old, postId, revision, npcId, 'failed'));
      return;
    }
    try {
      const content = await deps.generateComment(config, { post, npc, profile: buildCourierSenderProfile(npc) });
      if (!stillCurrent()) return;
      deps.setCourier((old) => {
        if (deps.getSessionId() !== sessionId) return old;
        const livePost = old.moments?.find((item) => item.id === postId && item.revision === revision);
        if (!livePost || livePost.targets.find((item) => item.npcId === npcId)?.status !== 'generating') return old;
        const knownContact = old.contacts.some((contact) => contact.available && contact.npcId === npcId);
        const currentNpc = deps.getNpcs().find((entry) => entry.id === npcId);
        if (!knownContact || !currentNpc || currentNpc.好感度 <= NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD) {
          return markMomentTarget(old, postId, revision, npcId, 'failed');
        }
        return appendMomentComment(old, postId, revision, {
          id: `${postId}:${revision}:${npcId}`, npcId, npcName: npc.姓名, content, createdAt: Date.now(),
        });
      });
    } catch {
      if (!stillCurrent()) return;
      deps.setCourier((old) => {
        if (deps.getSessionId() !== sessionId) return old;
        const target = old.moments?.find((item) => item.id === postId && item.revision === revision)
          ?.targets.find((item) => item.npcId === npcId);
        return target?.status === 'generating' ? markMomentTarget(old, postId, revision, npcId, 'failed') : old;
      });
    }
  }).map((task, index) => task.finally(() => inFlightComments.delete(claimKey(claimedIds[index]!)))));
}
