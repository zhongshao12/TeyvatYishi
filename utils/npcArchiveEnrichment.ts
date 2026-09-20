import { matchCanonical } from '@/data/canonicalCharacters';
import type { NPC记录, NPC性别, NPC_NSFW档案 } from '@/models/npc';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';

export type CanonicalArchiveBaseline = {
  性别?: NPC性别;
  外貌?: string;
  性格?: string;
  穿着?: string;
  说话方式?: string;
  介绍?: string;
  nsfw年龄确认?: NonNullable<NPC_NSFW档案['年龄确认']>;
};

interface NpcArchiveEnrichmentCacheEntry {
  codexEntries?: ArchiveCodex['entries'];
  nsfwEnabled: boolean;
  maleNsfwArchiveEnabled: boolean;
  result: NPC记录;
}

const npcArchiveEnrichmentCache = new WeakMap<NPC记录, NpcArchiveEnrichmentCacheEntry>();

const CANONICAL_ARCHIVE_BASELINES: Record<string, CanonicalArchiveBaseline> = {
  空: {
    性别: '男',
    穿着: '白金异域短装配轻甲与披风，腰佩单手剑，衣饰上的元素光泽会随共鸣变化。',
    说话方式: '温和而坚定，话语简洁，重视承诺与同行者的选择。',
    介绍: '来自世界之外的旅行者，为寻找血亲踏遍提瓦特。',
    nsfw年龄确认: 'unknown',
  },
  荧: {
    性别: '女',
    穿着: '白金异域裙装配轻甲与飘带，腰佩单手剑，衣饰上的元素光泽会随共鸣变化。',
    说话方式: '冷静而坚定，语气轻快但不轻率，行动中始终牵挂血亲。',
    介绍: '来自世界之外的旅行者，为寻找血亲踏遍提瓦特。',
    nsfw年龄确认: 'unknown',
  },
  派蒙: {
    性别: '其他',
    穿着: '白金色漂浮衣装与星冠，体型小巧。',
    说话方式: '直率活泼，爱吐槽也爱给同伴起绰号，遇到美食尤其兴奋。',
    介绍: '旅行者最亲近的向导与伙伴，熟悉提瓦特常识。',
    nsfw年龄确认: 'unknown',
  },
  安柏: {
    性别: '女',
    穿着: '西风骑士团侦察骑士制服，红色兔耳发带醒目，随身携带弓箭。',
    说话方式: '热情明快，主动帮助陌生人，执行职责时认真果断。',
    介绍: '蒙德城的侦察骑士，也是旅行者最早结识的伙伴之一。',
    nsfw年龄确认: 'adult',
  },
  凯亚: {
    性别: '男',
    穿着: '华丽而便于行动的骑兵队长装束，肩披毛领，佩单手剑。',
    说话方式: '从容机敏，习惯用玩笑与试探隐藏真实判断。',
    介绍: '西风骑士团骑兵队长，擅长情报、交涉与临场布局。',
    nsfw年龄确认: 'adult',
  },
  琴: {
    性别: '女',
    穿着: '西风骑士团代理团长礼装，兼具骑士的端正与行动便利。',
    说话方式: '克制礼貌，安排事务清晰，面对危机时坚定可靠。',
    介绍: '西风骑士团代理团长，将蒙德的安宁视为首要责任。',
    nsfw年龄确认: 'adult',
  },
  丽莎: {
    性别: '女',
    穿着: '紫色蔷薇魔女装束与宽檐帽，随身携带法器。',
    说话方式: '慵懒亲切，善用含笑的提醒推动对方正视问题。',
    介绍: '西风骑士团图书管理员，学识渊博且精通雷元素。',
    nsfw年龄确认: 'adult',
  },
  温迪: {
    性别: '男',
    穿着: '绿白吟游诗人装束，帽檐别着塞西莉亚花，随身携弓。',
    说话方式: '轻快自由，常以诗歌与玩笑说出重要线索。',
    介绍: '蒙德的吟游诗人，也是尘世七执政中的风神巴巴托斯。',
    nsfw年龄确认: 'adult',
  },
};

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

function namesLikelySame(a: string | undefined, b: string | undefined): boolean {
  const left = a?.replace(/\s+/g, '').trim();
  const right = b?.replace(/\s+/g, '').trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function buildCodexArchiveBaseline(npc: NPC记录, codex?: ArchiveCodex): CanonicalArchiveBaseline | undefined {
  const entries = codex?.entries ?? [];
  if (!entries.length) return undefined;
  const matched = entries
    .filter((entry) => entry.category === 'character' && entry.linkable !== false)
    .filter((entry) => {
      const names = [entry.name, ...entry.tags];
      return names.some((name) => namesLikelySame(name, npc.姓名) || namesLikelySame(name, npc.别名));
    })
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
  if (getNsfwArchiveBlockReason(npc, npc.姓名)) return false;
  const gender = baseline?.性别 ?? npc.性别;
  if (gender === '男' && !options.maleNsfwArchiveEnabled) return false;
  return npc.阶位 === 'companion' || npc.同行 || npc.原著角色 === true;
}

function buildNsfwBaseline(npc: NPC记录, baseline?: CanonicalArchiveBaseline): NPC_NSFW档案 {
  const existing = npc.NSFW档案 ?? {};
  const age = existing.年龄确认 ?? baseline?.nsfw年龄确认 ?? 'unknown';
  // NSFW 年龄门禁已解除：年龄确认降级为纯展示信息，不再限制档案写入或显示。
  // 基线档案只建一个干净空壳（enabled + 年龄 + 亲密阶段占位），把内容留给事实填充，
  // 不再写「保守基线」「等待剧情事实补充」等占位文案。
  return {
    ...existing,
    enabled: true,
    年龄确认: age,
    ...((baseline?.性别 ?? npc.性别) === '女' && age === 'adult' ? {
      是否处女: existing.是否处女 ?? '是',
      首次性行为对象: existing.首次性行为对象 ?? '无',
    } : {}),
    亲密阶段: existing.亲密阶段 ?? (npc.亲密关系 ? '已建立亲密关系（私密细节未记录）' : '未建立'),
  };
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
    const codexBaseline = buildCodexArchiveBaseline(npc, options.codex);
    const baseline: CanonicalArchiveBaseline = {
      ...(canonical ? {
        外貌: canonical.appearance,
        性格: canonical.personality,
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
    if (!updated.性别 && baseline?.性别) patch.性别 = baseline.性别;
    // 图鉴匹配只用于补全文本，不能把原创路人误判成原著角色。
    // 只有真正命中内置原著角色库时，才升级为原著同伴。
    if (canonical) {
      if (!updated.原著角色) patch.原著角色 = true;
      if (updated.阶位 !== 'companion') patch.阶位 = 'companion';
    } else if (updated.原著角色 === undefined) {
      patch.原著角色 = false;
    }

    if (Object.keys(patch).length) {
      updated = { ...updated, ...patch };
    }

    if (shouldCreateNsfwBaseline(updated, baseline, options)) {
      const archive = buildNsfwBaseline(updated, baseline);
      if (archiveChanged(updated.NSFW档案, archive)) {
        updated = { ...updated, NSFW档案: archive };
      }
    }

    // 清理 NSFW 档案中的占位字段：这些字段只有发生实际亲密剧情后才有意义，基线阶段不应存在。
    if (updated.NSFW档案) {
      const nsfw = updated.NSFW档案;
      const hasPlaceholder = nsfw.标签?.length || nsfw.备注 || nsfw.长期事实?.length;
      if (hasPlaceholder) {
        const { 标签, 备注, 长期事实, ...rest } = nsfw as NPC记录['NSFW档案'] & { 标签?: unknown; 备注?: unknown; 长期事实?: unknown };
        updated = { ...updated, NSFW档案: rest as NPC记录['NSFW档案'] };
      }
    }

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
