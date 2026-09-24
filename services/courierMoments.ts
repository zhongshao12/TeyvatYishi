import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, type NPC记录 } from '@/models/npc';
import type { CourierContact, CourierMoment, CourierMomentComment, CourierMomentTarget, CourierSystem } from '@/models/teyvat/courier';

function validatedContent(input: string): string {
  const content = input.trim();
  if (!content) throw new Error('MOMENT_EMPTY');
  if (content.length > 500) throw new Error('MOMENT_TOO_LONG');
  return content;
}

export function createMoment(system: CourierSystem, input: { id: string; content: string; turn: number; now: number }): CourierSystem {
  const content = validatedContent(input.content);
  const existing = system.moments ?? [];
  if (existing.length >= 500) throw new Error('MOMENT_LIMIT');
  if (existing.some((post) => post.id === input.id)) throw new Error('MOMENT_EXISTS');
  return { ...system, moments: [{
    id: input.id, authorId: 'player', content, turn: input.turn,
    createdAt: input.now, updatedAt: input.now, revision: 1,
    targets: [], comments: [],
  }, ...existing] };
}

export function editMoment(system: CourierSystem, id: string, contentInput: string, now: number): CourierSystem {
  const content = validatedContent(contentInput);
  if (!(system.moments ?? []).some((post) => post.id === id)) throw new Error('MOMENT_NOT_FOUND');
  return { ...system, moments: (system.moments ?? []).map((post) => post.id === id
    ? { ...post, content, updatedAt: now, revision: post.revision + 1, targets: [], comments: [] }
    : post) };
}

export function deleteMoment(system: CourierSystem, id: string): CourierSystem {
  if (!(system.moments ?? []).some((post) => post.id === id)) throw new Error('MOMENT_NOT_FOUND');
  return { ...system, moments: (system.moments ?? []).filter((post) => post.id !== id) };
}

export function restoreMoment(system: CourierSystem, deleted: CourierMoment): CourierSystem {
  const existing = system.moments ?? [];
  if (existing.some((post) => post.id === deleted.id) || existing.length >= 500) return system;
  return { ...system, moments: [{
    ...deleted,
    revision: deleted.revision + 1,
    targets: deleted.targets.map((target) => target.status === 'generating' ? { ...target, status: 'failed' as const } : target),
  }, ...existing] };
}

function eligibleMomentCommenters(contacts: readonly CourierContact[], npcs: readonly NPC记录[]): NPC记录[] {
  const npcById = new Map(npcs.map((npc) => [npc.id, npc]));
  const unique = new Map<string, NPC记录>();
  for (const contact of contacts) {
    const npc = contact.npcId ? npcById.get(contact.npcId) : undefined;
    if (contact.available && npc && npc.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD) unique.set(npc.id, npc);
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function countEligibleMomentCommenters(contacts: readonly CourierContact[], npcs: readonly NPC记录[]): number {
  return eligibleMomentCommenters(contacts, npcs).length;
}

export function selectMomentCommenters(momentId: string, contacts: readonly CourierContact[], npcs: readonly NPC记录[]): NPC记录[] {
  const eligible = eligibleMomentCommenters(contacts, npcs);
  if (!eligible.length) return [];
  const start = [...momentId].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0) % eligible.length;
  return [...eligible.slice(start), ...eligible.slice(0, start)].slice(0, 3);
}

export function markMomentTarget(system: CourierSystem, postId: string, revision: number, npcId: string, status: CourierMomentTarget['status']): CourierSystem {
  return { ...system, moments: (system.moments ?? []).map((post) => {
    if (post.id !== postId || post.revision !== revision) return post;
    const existing = post.targets.find((target) => target.npcId === npcId);
    if (!existing && post.targets.length >= 3) return post;
    return { ...post, targets: existing
      ? post.targets.map((target) => target.npcId === npcId ? { ...target, status } : target)
      : [...post.targets, { npcId, status }] };
  }) };
}

export function appendMomentComment(system: CourierSystem, postId: string, revision: number, comment: CourierMomentComment): CourierSystem {
  const content = comment.content.trim();
  if (!content || content.length > 120) throw new Error('MOMENT_COMMENT_INVALID');
  return { ...system, moments: (system.moments ?? []).map((post) => {
    if (post.id !== postId || post.revision !== revision || post.comments.length >= 3
      || post.comments.some((existing) => existing.npcId === comment.npcId)) return post;
    return {
      ...post,
      comments: [...post.comments, { ...comment, content }],
      targets: post.targets.map((target) => target.npcId === comment.npcId ? { ...target, status: 'done' as const } : target),
    };
  }) };
}
