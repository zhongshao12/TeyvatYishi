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
  if (!requestedName) return undefined;
  const canonical = matchCanonical(requestedName);
  // 2026-10-03：身份合并（「闲云」并入「留云借风真君」）之后，头像注册表仍然按**素材名**存放
  // （注册表里就是「闲云」）。旧实现只按原著正名查找，于是合并身份把已有头像一起弄丢了 ——
  // 表现就是闲云 / 留云借风真君在对话框与档案里都没有头像。
  // 现在同时试：原始名 / 原著正名 / 该正名的全部别名。
  const candidates = new Set<string>(
    [requestedName, canonical?.name, ...(canonical?.aliases ?? [])].filter((name): name is string => Boolean(name)),
  );
  return BUILTIN_AVATAR_SETS.find((item) => candidates.has(item.canonicalName));
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
