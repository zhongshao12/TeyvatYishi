import { matchCanonical } from '@/data/canonicalCharacters';
import { getAvatarCharacterProfile } from '@/data/avatarCharacterProfiles';
import type { NPC记录, NPC_NSFW档案, NPC外貌档案 } from '@/models/npc';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { canRevealNpcRecordMeasurements, normalizeNpcAppearanceFacts } from '@/services/npcAppearanceFacts';
import { reconcileNpcAppearanceRecord } from '@/utils/npcAppearanceReconciliation';
import { matchesNpcCodexIdentity } from '@/utils/npcCodexIdentity';
import { preserveFixedNpcImageBasics } from '@/utils/fixedNpcImageBasics';

export { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveBaseline';
export type { CanonicalArchiveBaseline } from '@/utils/npcArchiveBaseline';
import { CANONICAL_ARCHIVE_BASELINES, type CanonicalArchiveBaseline } from '@/utils/npcArchiveBaseline';

interface NpcArchiveEnrichmentCacheEntry {
  codexEntries?: ArchiveCodex['entries'];
  nsfwEnabled: boolean;
  maleNsfwArchiveEnabled: boolean;
  result: NPC记录;
}

const npcArchiveEnrichmentCache = new WeakMap<NPC记录, NpcArchiveEnrichmentCacheEntry>();


function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const WEAK_ARCHIVE_TEXT_RE = /^(未知|未记录|暂无|尚无|无|普通|一般|空|待补充|暂无记录|尚未记录|沉默寡言|冷静理性|开朗活泼)$/;

function isWeakArchiveText(value: unknown): boolean {
  if (!hasText(value)) return true;
  const text = value.trim();
  if (text.length <= 8) return true;
  if (WEAK_ARCHIVE_TEXT_RE.test(text)) return true;
  if (/^(性格|外貌|穿着|介绍|说话方式)[:：]?\s*(未知|暂无|待补充|未记录)?$/.test(text)) return true;
  return false;
}

function shouldPatchArchiveField(current: unknown, incoming: unknown): incoming is string {
  if (!hasText(incoming)) return false;
  if (!hasText(current)) return true;
  const currentText = current.trim();
  const incomingText = incoming.trim();
  return isWeakArchiveText(currentText) && incomingText.length >= currentText.length + 6;
}

function buildCodexArchiveBaseline(npc: NPC记录, codex?: ArchiveCodex): CanonicalArchiveBaseline | undefined {
  const entries = codex?.entries ?? [];
  if (!entries.length) return undefined;
  const matched = entries
    .filter((entry) => entry.category === 'character' && entry.linkable !== false)
    .filter((entry) => matchesNpcCodexIdentity(npc, entry))
    .sort((left, right) => right.importance - left.importance || left.name.localeCompare(right.name))
    .slice(0, 4);
  if (!matched.length) return undefined;

  const pickInjection = (selector: (entry: CodexEntry) => string | undefined) => {
    for (const entry of matched) {
      const value = selector(entry);
      if (hasText(value)) return value;
    }
    return undefined;
  };
  const pickSummary = (entries: CodexEntry[]) => {
    const subject = entries.find((entry) => entry.injection.type === 'character') ?? entries[0];
    return hasText(subject?.summary) ? subject.summary : hasText(subject?.description) ? subject.description : undefined;
  };

  return {
    外貌: pickInjection((entry) => entry.injection.appearanceAnchor),
    性格: pickInjection((entry) => entry.injection.personalityAndBehavior),
    说话方式: pickInjection((entry) => entry.injection.speechStyle),
    介绍: pickSummary(matched),
  };
}

function shouldCreateNsfwBaseline(
  npc: NPC记录,
  baseline: CanonicalArchiveBaseline | undefined,
  options: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean },
): boolean {
  if (!options.nsfwEnabled) return false;
  // 玩家在角色面板里**主动停用**过（`enabled: false`）就不再自动建档 ——
  // 否则「停用」会被下一次自动补齐立刻推翻，开关等于无效（2026-10-03）。
  if (npc.NSFW档案?.enabled === false) return false;
  if (!resolveNpcAdultEligibility({
    name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [],
    description: [npc.介绍, npc.外貌, npc.备注.join(' ')].filter(Boolean).join(' '),
    ageConfirmation: npc.NSFW档案?.年龄确认,
    ageSource: npc.NSFW档案?.年龄确认来源,
    canonicalBaselineAge: baseline?.nsfw年龄确认,
  }).confirmed) return false;
  const gender = baseline?.性别 ?? npc.性别;
  if (gender === '男' && !options.maleNsfwArchiveEnabled) return false;
  // 放宽：档案资格不再区分阶位。伙伴 / 同行 / 原著 / 普通路人，只要通过硬闸判定即可建档。
  return true;
}

/**
 * 玩家在角色面板里的主动操作（2026-10-03）：
 *  - 「确认为成年」：写入 `年龄确认: 'adult'` + `年龄确认来源: 'manual'`（玩家明确确认）；
 *  - 「启用 NSFW 档案」：按同一条基线规则建档并置 `enabled: true`。
 *
 * 三条硬闸（受保护幼态原著名单 / 未成年年龄证据 / 机械非人形）**不因玩家操作放宽**：
 * 命中时返回 `null` 与原因，调用方把原因显示给玩家，而不是写一个假标记。
 */
export interface EnableNpcNsfwArchiveResult {
  archive: NPC_NSFW档案 | null;
  reason: string;
}

export function enableNpcNsfwArchive(
  npc: NPC记录,
  options: { confirmAdult?: boolean; maleNsfwArchiveEnabled?: boolean; nsfwEnabled?: boolean } = {},
): EnableNpcNsfwArchiveResult {
  const existing = npc.NSFW档案 ?? {};
  const canonical = matchCanonical(npc.姓名) ?? (npc.别名 ? matchCanonical(npc.别名) : null);
  const baseline: CanonicalArchiveBaseline | undefined = canonical
    ? CANONICAL_ARCHIVE_BASELINES[canonical.name]
    : undefined;
  const 玩家确认成年 = options.confirmAdult === true;
  const 年龄确认 = 玩家确认成年 ? 'adult' : existing.年龄确认;
  const 年龄确认来源 = 玩家确认成年 ? 'manual' : existing.年龄确认来源;

  const eligibility = resolveNpcAdultEligibility({
    name: npc.姓名,
    aliases: npc.别名 ? [npc.别名] : [],
    description: [npc.介绍, npc.外貌, npc.备注.join(' ')].filter(Boolean).join(' '),
    ageConfirmation: 年龄确认,
    ageSource: 年龄确认来源,
    canonicalBaselineAge: baseline?.nsfw年龄确认,
  });
  if (!eligibility.confirmed) {
    return { archive: null, reason: eligibility.reason };
  }
  const gender = baseline?.性别 ?? npc.性别;
  if (gender === '男' && options.maleNsfwArchiveEnabled === false) {
    return { archive: null, reason: '男性档案开关未开启（设置 → NSFW 设置）。' };
  }
  const archive = buildNsfwBaseline(
    { ...npc, NSFW档案: { ...existing, 年龄确认, 年龄确认来源 } },
    baseline,
  );
  return { archive, reason: eligibility.reason };
}

/** 关闭该角色的 NSFW 档案（保留已写下的私密字段，只关开关）。 */
export function disableNpcNsfwArchive(npc: NPC记录): NPC_NSFW档案 {
  return { ...(npc.NSFW档案 ?? {}), enabled: false };
}

function buildNsfwBaseline(npc: NPC记录, baseline?: CanonicalArchiveBaseline): NPC_NSFW档案 {  const existing = npc.NSFW档案 ?? {};
  const gender = baseline?.性别 ?? npc.性别;
  const age: NonNullable<NPC_NSFW档案['年龄确认']> = baseline?.nsfw年龄确认 === 'adult'
    || (existing.年龄确认 === 'adult' && existing.年龄确认来源 === 'manual')
    ? 'adult' : 'unknown';
  const ageSource = baseline?.nsfw年龄确认 === 'adult' ? 'canonical' : existing.年龄确认来源;
  return {
    ...existing,
    enabled: true,
    年龄确认: age,
    年龄确认来源: ageSource,
    ...(gender === '女' ? {
      // 女角色默认「是 / 无」，性爱事件结算后会由 nsfw_archive 事实改为「否 / 玩家」。
      // 资格由 resolveNpcAdultEligibility 的硬闸把关，这里不再按年龄确认二次过滤。
      是否处女: existing.是否处女 ?? '是',
      首次性行为对象: existing.首次性行为对象 ?? '无',
    } : {}),
    亲密阶段: existing.亲密阶段 ?? (npc.亲密关系 ? '已建立亲密关系（私密细节未记录）' : '未建立'),
  };
}

/**
 * 女角色档案默认值的补写条件（老存档也要生效）：
 * 年龄确认还不是 adult，或缺少「是否处女」字段时，用 buildNsfwBaseline 补齐。
 * 放宽后覆盖全部通过硬闸判定的女角色（伙伴 / 同行 / 原著 / 普通路人都包含），只受 NSFW 总开关约束。
 */
function shouldBackfillFemaleNsfwDefaults(
  npc: NPC记录,
  baseline: CanonicalArchiveBaseline | undefined,
  options: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean },
): boolean {
  if (!options.nsfwEnabled) return false;
  if (!resolveNpcAdultEligibility({
    name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [],
    description: [npc.介绍, npc.外貌, npc.备注.join(' ')].filter(Boolean).join(' '),
    ageConfirmation: npc.NSFW档案?.年龄确认,
    ageSource: npc.NSFW档案?.年龄确认来源,
    canonicalBaselineAge: baseline?.nsfw年龄确认,
  }).confirmed) return false;
  if ((baseline?.性别 ?? npc.性别) !== '女') return false;
  const archive = npc.NSFW档案;
  if (!archive?.enabled) return false;
  if (archive.年龄确认 === 'minor_blocked') return false;
  return archive.年龄确认 !== 'adult' || archive.是否处女 === undefined;
}

/**
 * 旧版保守基线写进 `长期事实` / `标签` / `备注` 的占位文案。
 * 只有命中这些文案的内容才该被清掉；真实长期事实必须原样保留。
 */
const LEGACY_NSFW_PLACEHOLDER_RE = /保守基线|等待剧情事实补充|不代表已发生亲密剧情/;

type 归一化NSFW档案 = NonNullable<NPC记录['NSFW档案']>;

function 清理旧版NSFW占位(nsfw: 归一化NSFW档案): 归一化NSFW档案 {
  const 长期事实 = (nsfw.长期事实 ?? []).filter((item) => !LEGACY_NSFW_PLACEHOLDER_RE.test(item));
  const 标签 = (nsfw.标签 ?? []).filter((item) => !LEGACY_NSFW_PLACEHOLDER_RE.test(item));
  const 备注 = typeof nsfw.备注 === 'string' && LEGACY_NSFW_PLACEHOLDER_RE.test(nsfw.备注) ? undefined : nsfw.备注;
  const unchanged = 长期事实.length === (nsfw.长期事实 ?? []).length
    && 标签.length === (nsfw.标签 ?? []).length
    && 备注 === nsfw.备注;
  if (unchanged) return nsfw;
  const next: 归一化NSFW档案 = { ...nsfw, 长期事实, 标签 };
  if (备注 === undefined) delete next.备注;
  return next;
}

/**
 * 玩家要求（2026-10-03）：「把坎蒂丝归入女角色中和去掉坎蒂丝的NSFW档案的男性器」。
 * 女性角色（特别是坎蒂丝）的 NSFW 档案中不得残留男性身体档案或男性器部位图。
 */
function 清理女性角色NSFW男性字段(nsfw: 归一化NSFW档案): 归一化NSFW档案 {
  let changed = false;
  let partImages = nsfw.部位图片;
  if (nsfw.男性身体档案 !== undefined) {
    changed = true;
  }
  if (partImages?.男性器) {
    partImages = { ...partImages };
    delete partImages.男性器;
    changed = true;
  }
  if (!changed) return nsfw;
  const next: 归一化NSFW档案 = { ...nsfw };
  delete next.男性身体档案;
  if (partImages) next.部位图片 = partImages;
  return next;
}

function archiveChanged(a: NPC_NSFW档案 | undefined, b: NPC_NSFW档案): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b);
}

/**
 * 判断一个 NPC 是否需要变量模型补建 NSFW 基线档案。
 * 触发条件：NSFW 开启、通过门禁、档案缺少实质内容（身体档案/偏好/敏感点等都空）。
 * 已有实质内容的档案不重复生成。
 */
export function needsNsfwBaseline(
  npc: NPC记录,
  baseline: CanonicalArchiveBaseline | undefined,
  options: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean },
): boolean {
  if (!shouldCreateNsfwBaseline(npc, baseline, options)) return false;
  const archive = npc.NSFW档案;
  if (!archive?.enabled) return true;
  // 检查是否已有实质内容（任一字段有值即视为已填充，不重复生成）。
  const hasFemaleBody = archive.女性身体档案 && Object.values(archive.女性身体档案).some((v) => typeof v === 'string' && v.trim());
  const hasMaleBody = archive.男性身体档案 && Object.values(archive.男性身体档案).some((v) => typeof v === 'string' && v.trim());
  const gender = baseline?.性别 ?? npc.性别;
  const bodyFilled = gender === '男' ? hasMaleBody : (hasFemaleBody || hasMaleBody);
  const hasPrefs = (archive.偏好?.length ?? 0) > 0;
  const hasSensitive = (archive.敏感点?.length ?? 0) > 0;
  const hasExperiences = (archive.经历?.length ?? 0) > 0;
  // 只要有一个实质字段有值，就认为基线已建立，不重复生成。
  return !bodyFilled && !hasPrefs && !hasSensitive && !hasExperiences;
}

export function enrichNpcArchives(
  records: NPC记录[],
  options: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean; codex?: ArchiveCodex },
): { records: NPC记录[]; changed: boolean } {
  let changed = false;
  const next = records.map((npc) => {
    const cached = npcArchiveEnrichmentCache.get(npc);
    if (cached
      && cached.codexEntries === options.codex?.entries
      && cached.nsfwEnabled === options.nsfwEnabled
      && cached.maleNsfwArchiveEnabled === options.maleNsfwArchiveEnabled) {
      if (cached.result !== npc) changed = true;
      return cached.result;
    }
    const canonical = matchCanonical(npc.姓名) ?? (npc.别名 ? matchCanonical(npc.别名) : null);
    const avatarProfile = getAvatarCharacterProfile(npc.姓名, npc.别名 ? [npc.别名] : undefined);
    const codexBaseline = buildCodexArchiveBaseline(npc, options.codex);
    const baseline: CanonicalArchiveBaseline = {
      ...(canonical ? {
        外貌: canonical.appearance,
        性格: canonical.personality,
      } : {}),
      ...(avatarProfile ? {
        穿着: avatarProfile.常用穿着,
        性别: avatarProfile.gender,
        发色: avatarProfile.发色,
        瞳色: avatarProfile.瞳色,
        身高: avatarProfile.身高,
        体重: avatarProfile.体重,
      } : {}),
      ...(canonical ? CANONICAL_ARCHIVE_BASELINES[canonical.name] : {}),
      ...(codexBaseline ?? {}),
    };
    let updated = npc;
    const patch: Partial<NPC记录> = {};

    if (shouldPatchArchiveField(updated.外貌, baseline.外貌)) patch.外貌 = baseline.外貌;
    if (shouldPatchArchiveField(updated.性格, baseline.性格)) patch.性格 = baseline.性格;
    if (shouldPatchArchiveField(updated.穿着, baseline.穿着)) patch.穿着 = baseline.穿着;
    if (shouldPatchArchiveField(updated.说话方式, baseline.说话方式)) patch.说话方式 = baseline.说话方式;
    if (shouldPatchArchiveField(updated.介绍, baseline.介绍)) patch.介绍 = baseline.介绍;
    // 坎蒂丝明确为女角色；其他角色若无性别则按基线补齐
    const forcedFemale = updated.姓名 === '坎蒂丝' || updated.别名 === 'Candace' || canonical?.name === '坎蒂丝';
    if (forcedFemale && updated.性别 !== '女') patch.性别 = '女';
    else if (!updated.性别 && baseline?.性别) patch.性别 = baseline.性别;

    if (avatarProfile) {
      const currentAppearance: NPC外貌档案 = { ...(updated.外貌档案 ?? {}) };
      let appearanceChanged = false;
      const keys = ['发色', '瞳色', '身高', '体重'] as const;
      for (const key of keys) {
        const val = avatarProfile[key];
        if (val) {
          const existing = currentAppearance[key];
          if (!existing || (existing.source !== 'manual' && existing.value !== val)) {
            currentAppearance[key] = { value: val, source: 'canon' };
            appearanceChanged = true;
          }
        }
      }
      if (appearanceChanged) {
        patch.外貌档案 = currentAppearance;
      }
    }
    // 图鉴匹配只用于补全文本，不能把原创路人误判成原著角色。
    // 只有真正命中内置原著角色库时，才升级为原著同伴。
    if (canonical) {
      if (!updated.原著角色) patch.原著角色 = true;
      if (!updated.已归档 && updated.阶位 !== 'companion') patch.阶位 = 'companion';
    } else if (updated.原著角色 === undefined) {
      patch.原著角色 = false;
    }

    if (Object.keys(patch).length) {
      updated = { ...updated, ...patch };
    }

    if (shouldCreateNsfwBaseline(updated, baseline, options)
      || shouldBackfillFemaleNsfwDefaults(updated, baseline, options)) {
      const archive = buildNsfwBaseline(updated, baseline);
      if (archiveChanged(updated.NSFW档案, archive)) {
        updated = { ...updated, NSFW档案: archive };
      }
    }

    // 清理女性角色（特别是坎蒂丝）NSFW档案里的男性身体档案与男性器部位图
    if (updated.NSFW档案 && (updated.性别 === '女' || forcedFemale)) {
      const stripped = 清理女性角色NSFW男性字段(updated.NSFW档案);
      if (stripped !== updated.NSFW档案) {
        updated = { ...updated, NSFW档案: stripped };
      }
    }

    // 清理旧版「保守基线」留下的占位文案。
    //
    // 这里**只**删命中占位文案的条目。此前写成「标签/备注/长期事实 任一非空就整体删除」，
    // 结果把玩家和模型真实写入的长期事实一起删了 —— 表现就是
    // 「NSFW 档案里的长期事实没有发生作用」（下一回合补全时被清空）。
    if (updated.NSFW档案) {
      const cleaned = 清理旧版NSFW占位(updated.NSFW档案);
      if (cleaned !== updated.NSFW档案) {
        updated = { ...updated, NSFW档案: cleaned };
      }
    }

    // Preserve the existing canonical identity correction (Candace), not an AI
    // profile rewrite. This check still precedes the unchanged privacy gates.
    updated = preserveFixedNpcImageBasics(forcedFemale ? { ...npc, 性别: '女' } : npc, updated);
    updated = reconcileNpcAppearanceRecord(updated, normalizeNpcAppearanceFacts(updated.外貌档案, canRevealNpcRecordMeasurements(updated)));
    const cacheEntry: NpcArchiveEnrichmentCacheEntry = {
      codexEntries: options.codex?.entries,
      nsfwEnabled: options.nsfwEnabled,
      maleNsfwArchiveEnabled: options.maleNsfwArchiveEnabled,
      result: updated,
    };
    npcArchiveEnrichmentCache.set(npc, cacheEntry);
    npcArchiveEnrichmentCache.set(updated, cacheEntry);
    if (updated !== npc) changed = true;
    return updated;
  });

  return { records: next, changed };
}
