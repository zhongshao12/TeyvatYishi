import type { NPC记录, NPC_NSFW档案 } from '@/models/npc';
import type { TeyvatNpcRecord } from '@/models/teyvat/character';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveEnrichment';

const LEGACY_ASSUMPTION = '旧档推定，具体回合未知';
const PLAYER_LABELS = new Set(['玩家', '用户', '主角', '{{user}}']);

function canAssumePlayer(value: string | undefined, playerName: string): boolean {
  const text = value?.trim() ?? '';
  return !text || text === '无' || PLAYER_LABELS.has(text) || Boolean(playerName.trim() && text === playerName.trim());
}

export function displayFirstPartner(archive: NPC_NSFW档案 | undefined, playerName: string): string {
  if (archive?.首次性行为对象引用 === 'player') return playerName.trim() || '玩家（姓名未设）';
  if (archive?.首次性行为对象来源 === 'manual' && !archive.首次性行为对象?.trim()) return '待确认';
  return archive?.首次性行为对象?.trim() || '无';
}

export function migrateLegacyFirstPartner(npc: NPC记录, playerName: string): NPC记录 {
  const archive = npc.NSFW档案;
  if (npc.性别 !== '女' || !archive || archive.是否处女 !== '否' || archive.首次性行为对象引用
    || archive.首次性行为对象来源 || !canAssumePlayer(archive.首次性行为对象, playerName)) return npc;
  const eligible = resolveNpcAdultEligibility({
    name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [],
    description: [npc.介绍, npc.外貌, npc.备注.join(' ')].filter(Boolean).join(' '),
    ageConfirmation: archive.年龄确认, ageSource: archive.年龄确认来源,
    canonicalBaselineAge: getCanonicalArchiveBaselineAge(npc.姓名),
  });
  if (!eligible.confirmed) return npc;
  return {
    ...npc,
    NSFW档案: {
      ...archive,
      首次性行为对象: undefined,
      首次性行为对象引用: 'player',
      首次性行为对象来源: 'legacy_assumed',
      经历: (archive.经历 ?? []).includes(LEGACY_ASSUMPTION)
        ? archive.经历 : [...(archive.经历 ?? []), LEGACY_ASSUMPTION],
    },
  };
}

export function migrateTeyvatFirstPartner(npc: TeyvatNpcRecord, playerName: string): TeyvatNpcRecord {
  const archive = npc.matureArchive;
  if (npc.gender !== '女' || !archive || archive.virginityStatus !== 'not_virgin' || archive.firstSexualPartnerRef
    || archive.firstSexualPartnerSource || !canAssumePlayer(archive.firstSexualPartner, playerName)) return npc;
  const eligible = resolveNpcAdultEligibility({
    name: npc.姓名, aliases: npc.aliases,
    description: [npc.说明, npc.appearance, ...npc.notes].filter(Boolean).join(' '),
    ageConfirmation: archive.ageConfirmation, ageSource: archive.ageConfirmationSource,
    canonicalBaselineAge: getCanonicalArchiveBaselineAge(npc.姓名),
  });
  if (!eligible.confirmed) return npc;
  return {
    ...npc,
    matureArchive: {
      ...archive,
      firstSexualPartner: undefined,
      firstSexualPartnerRef: 'player',
      firstSexualPartnerSource: 'legacy_assumed',
      experiences: archive.experiences.includes(LEGACY_ASSUMPTION)
        ? archive.experiences : [...archive.experiences, LEGACY_ASSUMPTION],
    },
  };
}
