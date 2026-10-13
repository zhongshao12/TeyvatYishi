import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, type NPC记录 } from '@/models/npc';
import { MAX_MOMENT_IMAGES, normalizeMomentImages, type CourierContact, type CourierMoment, type CourierMomentComment, type CourierMomentImage, type CourierMomentTarget, type CourierSystem } from '@/models/teyvat/courier';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

function validatedContent(input: string, images: readonly CourierMomentImage[]): string {
  const content = input.trim();
  if (!content && !images.length) throw new Error('MOMENT_EMPTY');
  if (content.length > 500) throw new Error('MOMENT_TOO_LONG');
  return content;
}

function validatedImages(input: readonly CourierMomentImage[] = []): CourierMomentImage[] {
  if (input.length > MAX_MOMENT_IMAGES) throw new Error('MOMENT_IMAGE_LIMIT');
  const normalized = normalizeMomentImages(input);
  if (normalized.length !== input.length) throw new Error('MOMENT_IMAGE_INVALID');
  return normalized;
}

export function createMoment(system: CourierSystem, input: { id: string; content: string; turn: number; now: number; mentionIds?: string[]; worldMoment?: WorldMoment; images?: readonly CourierMomentImage[] }): CourierSystem {
  const images = validatedImages(input.images);
  const content = validatedContent(input.content, images);
  const existing = system.moments ?? [];
  if (existing.length >= 500) throw new Error('MOMENT_LIMIT');
  if (existing.some((post) => post.id === input.id)) throw new Error('MOMENT_EXISTS');
  return { ...system, moments: [{
    id: input.id, authorId: 'player', content, turn: input.turn,
    createdAt: input.now, updatedAt: input.now, revision: 1,
    ...(input.worldMoment ? { worldMoment: input.worldMoment } : {}),
    targets: [], comments: [],
    ...(input.mentionIds?.length ? { mentionIds: [...new Set(input.mentionIds)] } : {}),
    ...(images.length ? { images } : {}),
  }, ...existing] };
}

export function editMoment(
  system: CourierSystem,
  id: string,
  contentInput: string,
  now: number,
  mentionIds?: string[],
  imagesInput?: readonly CourierMomentImage[],
): CourierSystem {
  const existing = system.moments?.find((post) => post.id === id);
  if (!existing) throw new Error('MOMENT_NOT_FOUND');
  const images = validatedImages(imagesInput ?? existing.images);
  const content = validatedContent(contentInput, images);
  return { ...system, moments: (system.moments ?? []).map((post) => post.id === id
    ? {
        ...post,
        content,
        updatedAt: now,
        revision: post.revision + 1,
        targets: [],
        comments: [],
        images: images.length ? images : undefined,
        // 编辑后重新解析 @：正文可能已经删掉或新增了点名（2026-09-29 第 7 项）。
        ...(mentionIds?.length ? { mentionIds: [...new Set(mentionIds)] } : { mentionIds: undefined }),
      }
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

/** 自动评论名额（与好感度资格绑定）；@ 点名的人**不占**这个名额。 */
export const MOMENT_AUTO_COMMENT_LIMIT = 3;

/**
 * 该条动态允许的评论总数 = 自动评论名额 + 被点名的角色数（2026-09-29 第 7 项）。
 * 运行时（`markMomentTarget` / `appendMomentComment`）、工作流与存档归一化必须共用这一个口径，
 * 否则「@ 了 4 个人」会在读档后被静默截断。
 */
export function momentCommentCapacity(post: Pick<CourierMoment, 'mentionIds'>): number {
  return MOMENT_AUTO_COMMENT_LIMIT + (post.mentionIds?.length ?? 0);
}

/** 草稿内的字符位置绑定；持久化仍只写已有 mentionIds。 */
export interface MomentMentionBinding { npcId: string; start: number; token: string; fromArchive?: boolean }

export function shiftMomentMentionBindings(before: string, after: string, bindings: readonly MomentMentionBinding[]): MomentMentionBinding[] {
  const identitiesByToken = new Map<string, Set<string>>();
  for (const binding of bindings) identitiesByToken.set(binding.token, new Set([...(identitiesByToken.get(binding.token) ?? []), binding.npcId]));
  const ambiguousTokens = new Set([...identitiesByToken].filter(([token, ids]) => token && ids.size > 1
    && before.split(token).length !== after.split(token).length).map(([token]) => token));
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
  const oldEnd = before.length - suffix;
  return bindings.flatMap(binding => {
    if (!binding.token || ambiguousTokens.has(binding.token)) return [];
    const start = binding.start + (binding.start >= oldEnd ? after.length - before.length : 0);
    if (binding.start + binding.token.length > prefix && binding.start < oldEnd) return [];
    const end = start + binding.token.length;
    const oldFollowing = before[binding.start + binding.token.length];
    if ((!oldFollowing || /[\s，。！？、,.!?]/u.test(oldFollowing)) && after[end]
      && !/[\s，。！？、,.!?]/u.test(after[end]!)) return [];
    return after.slice(start, start + binding.token.length) === binding.token ? [{ ...binding, start }] : [];
  });
}

export function restoreMomentMentionBindings(post: Pick<CourierMoment, 'content' | 'mentionIds'>, contacts: readonly CourierContact[]): MomentMentionBinding[] {
  const ids = [...new Set(post.mentionIds ?? [])];
  if (!ids.length) return [];
  const selected = contacts.filter(contact => contact.npcId && post.mentionIds?.includes(contact.npcId));
  const anchors = [...post.content.matchAll(/[@＠]/gu)];
  return anchors.flatMap(match => {
    const start = match.index;
    const rest = post.content.slice(start + 1);
    const matching = contacts.filter(contact => contact.name && rest.startsWith(contact.name)).sort((a, b) => b.name.length - a.name.length);
    const name = matching[0]?.name ?? rest.match(/^[^\s，。！？、,.!?@＠]+/u)?.[0];
    if (!name) return [];
    const matchingIds = [...new Set(selected.filter(contact => contact.name === name).map(contact => contact.npcId!))];
    const npcId = ids.length === 1 && anchors.length === 1 ? ids[0]!
      : matchingIds.length === 1 ? matchingIds[0]! : '';
    // 不明确的旧字符也占位，阻止它在当前姓名表里误命中另一个人；需玩家重新选择。
    return [{ npcId, start, token: `${match[0]}${name}`, fromArchive: true }];
  });
}

/**
 * 解析正文里的 `@角色`（2026-09-29 第 7 项）。
 *
 * 与群聊解析（`services/ai/courierService.ts`）的差别：那里用 `(?=\s|$|标点)` 前瞻，
 * `@安柏你好` 这种**没有空格**的写法不会命中；朋友圈是玩家自己写的正文，
 * 必须按**最长联系人姓名前缀**匹配。只有已建立且可用的手机联系人能被点名。
 */
export function parseMomentMentions(
  content: string,
  contacts: readonly CourierContact[],
  bindings: readonly MomentMentionBinding[] = [],
): string[] {
  const text = content ?? '';
  if (!text.includes('@') && !text.includes('＠')) return [];
  const named = contacts
    .filter((contact) => contact.available !== false && (!contact.status || contact.status === 'available') && contact.npcId && contact.name?.trim())
    .map((contact) => ({ npcId: contact.npcId!, name: contact.name!.trim() }))
    // 最长名字优先：避免「安」这类短名把「安柏」的前缀抢走。
    .sort((a, b) => b.name.length - a.name.length);
  const found: string[] = [];
  for (const match of text.matchAll(/[@＠]/gu)) {
    const rest = text.slice((match.index ?? 0) + 1);
    const binding = bindings.find(item => item.start === match.index && text.slice(item.start, item.start + item.token.length) === item.token);
    const longest = named.find((candidate) => rest.startsWith(candidate.name));
    const matches = longest ? named.filter(candidate => candidate.name === longest.name) : [];
    const hit = binding
      ? named.find(candidate => candidate.npcId === binding.npcId)
      : new Set(matches.map(candidate => candidate.npcId)).size === 1 ? matches[0] : undefined;
    if (hit && !found.includes(hit.npcId)) found.push(hit.npcId);
  }
  return found;
}

/**
 * @ 点名角色的**确定性**本地回应（2026-09-29 第 7 项）。
 *
 * 契约修订说明：原契约（`docs/superpowers/plans/2026-09-23-phone-moments.md:19`）要求
 * 「失败不能用固定套话伪装为评论」，那条约束保护的是**自动评论**（不能假装模型写了评论）。
 * 玩家**显式 @** 是直接请求「一定要回」，因此这里给 @ 目标补一条本地写成的回应，
 * 并把它标记为 `source: 'local'`、在界面显式标注「本地回应」—— 既不伪装成模型输出，
 * 也不让玩家的点名落空。自动评论通道保持原契约（失败即 `failed`，可手动重试）。
 */
export function composeMomentCommentLocally(npc: NPC记录, post: Pick<CourierMoment, 'content'>): string {
  const 主题 = (post.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const 阶段 = npc.好感度 >= 150 ? '挚友' : npc.好感度 > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD ? '知交' : '朋友';
  const 开头 = npc.同行 ? '我就在旁边看着' : 阶段 === '挚友' ? '看到你这条，我立刻就想回' : '看到你的动态了';
  const 正文 = `「${主题}」——${开头}。等见面时我想听你亲口讲讲，别一个人扛着。`;
  // 面板已经把角色名渲染在评论前面（`{npcName}：`），正文不再重复署名；
  // 必须落在句末标点上（评论校验与既有契约都要求），并且不超过 120 字上限。
  return [...正文].length > 120 ? `${[...正文].slice(0, 118).join('').replace(/[，、；：\s]+$/u, '')}。` : 正文;
}

export function markMomentTarget(system: CourierSystem, postId: string, revision: number, npcId: string, status: CourierMomentTarget['status']): CourierSystem {
  return { ...system, moments: (system.moments ?? []).map((post) => {
    if (post.id !== postId || post.revision !== revision) return post;
    const existing = post.targets.find((target) => target.npcId === npcId);
    if (!existing && post.targets.length >= momentCommentCapacity(post)) return post;
    return { ...post, targets: existing
      ? post.targets.map((target) => target.npcId === npcId ? { ...target, status } : target)
      : [...post.targets, { npcId, status }] };
  }) };
}

export function appendMomentComment(system: CourierSystem, postId: string, revision: number, comment: CourierMomentComment): CourierSystem {
  const content = comment.content.trim();
  if (!content || content.length > 120) throw new Error('MOMENT_COMMENT_INVALID');
  return { ...system, moments: (system.moments ?? []).map((post) => {
    if (post.id !== postId || post.revision !== revision || post.comments.length >= momentCommentCapacity(post)
      || post.comments.some((existing) => existing.npcId === comment.npcId)) return post;
    return {
      ...post,
      comments: [...post.comments, { ...comment, content }],
      targets: post.targets.map((target) => target.npcId === comment.npcId ? { ...target, status: 'done' as const } : target),
    };
  }) };
}
