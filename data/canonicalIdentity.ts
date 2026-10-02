import { matchCanonical, type CanonicalCharacterDef } from './canonicalCharacters';
import { getBuiltinAvatarSet } from './builtinAvatars';

/**
 * 原著身份的**单一判定**（2026-09-29，用户第 9 项）。
 *
 * 背景：`data/canonicalCharacters.ts` 是**手维护的精简名单**（58 个高频角色的基础识别信息），
 * 而官方头像注册表 `data/teyvatAvatarRegistry.generated.ts` 由 `pnpm avatars:sync` 扫描
 * `public/assets/teyvat-avatars/characters/*.webp` 生成，共 **127** 个角色。
 * 两者相差 71 个：阿贝多、莫娜、优菈、迪奥娜、砂糖、五郎、云堇、重云、七七、早柚、瑶瑶…
 *
 * 后果（用户看到的现象）：这些角色**有头像却不是原著角色** ——
 * `models/teyvat/character.ts` 的 `matchCanonicalIdentity` 只认那 58 个名字，
 * 于是记录拿到 `canonical: false` + `roleTier: 'extra'`：不显示「原著角色」标签、
 * 长期性格不受保护（变量模型可改写）、不强制 companion 阶位，但头像照显示
 * （`models/npc.ts` 的 `读取NPC头像` 会按名字回退取内置头像）。
 *
 * 修法：把「有官方头像」并入原著身份判定。**不**把 71 个名字手抄进 `canonicalCharacters.ts`
 * （该文件注释明确只保留高频基础识别信息，精修人设由图鉴档案负责召回）；头像注册表本身就是
 * 「这是官方角色」的权威信号，且新增头像时无需改这个文件。
 *
 * 放在独立模块里是为了避免 `builtinAvatars → canonicalCharacters` 与反向引用形成环。
 */

/** 该名字（或其别名）是否有官方内置头像 —— 即是否为官方角色。 */
export function hasBuiltinAvatarIdentity(name?: string, aliases?: readonly string[]): boolean {
  const candidates = [name, ...(aliases ?? [])]
    .map((value) => (value ?? '').trim())
    .filter(Boolean);
  return candidates.some((candidate) => getBuiltinAvatarSet(candidate) !== undefined);
}

/** 原著身份判定 = 精简原著名单 ∪ 官方头像注册表。 */
export function isCanonicalIdentity(name?: string, aliases?: readonly string[]): boolean {
  if (matchCanonical((name ?? '').trim())) return true;
  return hasBuiltinAvatarIdentity(name, aliases);
}

/**
 * 与 `matchCanonical` 同形的便利入口：能拿到原著条目就用它（有性别/外貌/性格），
 * 只有头像没条目时返回 `null` —— 调用方对 `null` 的既有兜底逻辑全部保持有效。
 */
export function resolveCanonicalIdentity(name?: string, aliases?: readonly string[]): CanonicalCharacterDef | null {
  const matched = matchCanonical((name ?? '').trim());
  if (matched) return matched;
  if (!hasBuiltinAvatarIdentity(name, aliases)) return null;
  const trimmed = (name ?? '').trim();
  return { name: trimmed };
}
