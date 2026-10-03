import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, type NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import type { CourierMoment, CourierSystem } from '@/models/teyvat/courier';
import { buildCourierSenderProfile } from '@/services/ai/courierService';
import type { MomentCommentInput } from '@/services/ai/courierMomentComments';
import { appendMomentComment, composeMomentCommentLocally, markMomentTarget, momentCommentCapacity, selectMomentCommenters } from '@/services/courierMoments';

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

function eligibleNpc(deps: MomentWorkflowDeps, npcId: string, options?: { allowBelowAffinity?: boolean }): NPC记录 | undefined {
  const hasContact = deps.getCourier().contacts.some((contact) => contact.available && contact.npcId === npcId);
  if (!hasContact) return undefined;
  const npc = deps.getNpcs().find((entry) => entry.id === npcId);
  if (!npc) return undefined;
  // 被 @ 点名 = 玩家直接对着这位联系人说话：只要有手机联系人身份就一定要回，
  // 不受「自动评论需要好感度 > 100」的限制（2026-09-29 第 7 项）。
  if (options?.allowBelowAffinity) return npc;
  return npc.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD ? npc : undefined;
}

function isMentioned(post: CourierMoment | undefined, npcId: string): boolean {
  return Boolean(post?.mentionIds?.includes(npcId));
}

/** Each selected companion owns one independent, revision-guarded comment job. */
export async function runMomentComments(deps: MomentWorkflowDeps, postId: string, revision: number, retryNpcId?: string): Promise<void> {
  const sessionId = deps.getSessionId();
  const post = currentPost(deps, postId, revision);
  if (!post) return;
  const mentionIds = post.mentionIds ?? [];
  const selectedIds = retryNpcId
    ? post.targets.some((target) => target.npcId === retryNpcId && target.status === 'failed') ? [retryNpcId] : []
    // @ 点名的角色与自动评论者取**并集**：旧实现是三元选择，一旦把 @ 目标写进 targets
    // 就会让自动评论者全部消失（2026-09-29 第 7 项）。
    : [...new Set([
        ...mentionIds,
        ...(post.targets.length
          ? post.targets.map((target) => target.npcId)
          : selectMomentCommenters(post.id, deps.getCourier().contacts, deps.getNpcs()).map((npc) => npc.id)),
      ])];
  const workIds = selectedIds.slice(0, momentCommentCapacity(post)).filter((npcId) => {
    const target = post.targets.find((entry) => entry.npcId === npcId);
    return target?.status !== 'done' && target?.status !== 'generating'
      && Boolean(eligibleNpc(deps, npcId, { allowBelowAffinity: mentionIds.includes(npcId) }));
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
    /** @ 点名的角色：模型失败时用确定性本地写作器补一条回应（并标注来源），保证「一定会回」。 */
    const writeLocalReply = (npc: NPC记录, reason: string) => {
      if (!stillCurrent()) return;
      deps.setCourier((old) => {
        if (deps.getSessionId() !== sessionId) return old;
        const livePost = old.moments?.find((item) => item.id === postId && item.revision === revision);
        if (!livePost || livePost.targets.find((item) => item.npcId === npcId)?.status !== 'generating') return old;
        return appendMomentComment(old, postId, revision, {
          id: `${postId}:${revision}:${npcId}`,
          npcId,
          npcName: npc.姓名,
          content: composeMomentCommentLocally(npc, livePost),
          createdAt: Date.now(),
          ...(livePost.worldMoment ? { worldMoment: livePost.worldMoment } : {}),
          source: 'local',
        });
      });
      void reason;
    };
    const mentioned = isMentioned(currentPost(deps, postId, revision), npcId);
    const npc = eligibleNpc(deps, npcId, { allowBelowAffinity: mentioned });
    const config = deps.getApiConfig();
    if (!npc || !config) {
      if (mentioned && npc) writeLocalReply(npc, config ? 'missing_npc' : 'missing_api_config');
      else if (stillCurrent()) deps.setCourier((old) => markMomentTarget(old, postId, revision, npcId, 'failed'));
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
        const stillMentioned = isMentioned(livePost, npcId);
        if (!knownContact || !currentNpc
          || (!stillMentioned && currentNpc.好感度 <= NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD)) {
          return markMomentTarget(old, postId, revision, npcId, 'failed');
        }
        return appendMomentComment(old, postId, revision, {
          id: `${postId}:${revision}:${npcId}`, npcId, npcName: npc.姓名, content, createdAt: Date.now(),
          ...(livePost.worldMoment ? { worldMoment: livePost.worldMoment } : {}),
          source: 'model',
        });
      });
    } catch {
      if (!stillCurrent()) return;
      if (mentioned) {
        writeLocalReply(npc, 'model_failed');
        return;
      }
      deps.setCourier((old) => {
        if (deps.getSessionId() !== sessionId) return old;
        const target = old.moments?.find((item) => item.id === postId && item.revision === revision)
          ?.targets.find((item) => item.npcId === npcId);
        return target?.status === 'generating' ? markMomentTarget(old, postId, revision, npcId, 'failed') : old;
      });
    }
  }).map((task, index) => task.finally(() => inFlightComments.delete(claimKey(claimedIds[index]!)))));
}
