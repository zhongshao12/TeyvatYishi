export interface BuiltinAvatarCandidate {
  id: string;
  title: string;
  src: string;
}

export interface BuiltinAvatarSet {
  canonicalName: string;
  candidates: BuiltinAvatarCandidate[];
}

/**
 * 提瓦特角色头像注册表（2026-09-02 已激活）。
 *
 * 数据来源：public/assets/teyvat-avatars/characters/<原著角色中文名>.webp（平铺），
 * 由 `pnpm avatars:sync` 扫描生成 data/teyvatAvatarRegistry.generated.ts。
 * 加新头像：把 <中文名>.webp 放进 characters/ 目录 → 运行 pnpm avatars:sync → 完成。
 * 消费链：models/npc.ts 读取NPC头像 → getDefaultBuiltinAvatar(canonicalName 中文名)，
 * 聊天立绘槽位（DialogueBubble）与 NPC 档案、伙伴面板自动取到图。
 */
import { TEYVAT_AVATAR_SETS } from './teyvatAvatarRegistry.generated';
import { matchCanonical } from './canonicalCharacters';

export const BUILTIN_AVATAR_SETS: BuiltinAvatarSet[] = TEYVAT_AVATAR_SETS;

export function getBuiltinAvatarSet(canonicalName: string | undefined): BuiltinAvatarSet | undefined {
  if (!canonicalName) return undefined;
  const requestedName = canonicalName.trim();
  const resolvedName = matchCanonical(requestedName)?.name ?? requestedName;
  return BUILTIN_AVATAR_SETS.find((item) => item.canonicalName === resolvedName);
}

export function getDefaultBuiltinAvatar(canonicalName: string | undefined): string | undefined {
  return getBuiltinAvatarSet(canonicalName)?.candidates[0]?.src;
}

/** 空 / 荧等原著旅行者优先使用专属头像，自定义旅行者才回退到通用头像。 */
export function getDefaultTravelerBuiltinAvatar(name?: string, alias?: string): string | undefined {
  return getDefaultBuiltinAvatar(name?.trim())
    ?? getDefaultBuiltinAvatar(alias?.trim())
    ?? getDefaultBuiltinAvatar('旅行者');
}
