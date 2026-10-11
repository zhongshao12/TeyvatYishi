import { matchCanonicalIdentity } from '@/data/canonicalCharacters';
import { isRecord } from '@/utils/valueGuards';

const NAME = '娜布·玛莉卡塔';
const ID_FIELDS = new Set(['npcId', 'senderId', 'targetId']);
const ID_LIST_FIELDS = new Set(['relatedNpcIds', 'npcIds', 'mentionNpcIds', 'mentionIds', 'referenceTargets', 'participantIds', 'typingMemberIds']);

function isNabuRecord(record: unknown): record is Record<string, unknown> {
  if (!isRecord(record)) return false;
  // Old goddess records can have canonical:false because the registry lacked her.
  // Only an explicit original-character identity exempts a same-name NPC.
  if (/原创/.test(String(record.身份 ?? record.identity ?? ''))) return false;
  return matchCanonicalIdentity({ id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.姓名 === 'string' ? record.姓名 : '',
    aliases: Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
  })?.name === NAME;
}

function mergeRoster(records: unknown[], stableId: string): { records: unknown[]; ids: Map<string, string> } {
  const matches = records.filter(isNabuRecord);
  const ids = new Map<string, string>();
  if (!matches.length) return { records, ids };
  for (const record of matches) if (typeof record.id === 'string' && record.id) ids.set(record.id, stableId);
  const ordered = [...matches].sort((a, b) => (Number(a.lastSeenTurn) || 0) - (Number(b.lastSeenTurn) || 0));
  const merged = ordered.reduce<Record<string, unknown>>((acc, record) => mergeSavedFields(acc, record) as Record<string, unknown>, {});
  merged.id = stableId;
  merged.姓名 = NAME;
  merged.aliases = [...new Set(['花神', ...matches.flatMap(record => [record.姓名, ...(Array.isArray(record.aliases) ? record.aliases : [])])]
    .filter((name): name is string => typeof name === 'string' && name !== NAME))];
  merged.firstSeenTurn = Math.min(...matches.map(record => Number(record.firstSeenTurn) || 0));
  merged.lastSeenTurn = Math.max(...matches.map(record => Number(record.lastSeenTurn) || 0));
  const matchedSet = new Set(matches);
  return { records: records.flatMap(record => record === matches[0] ? [merged]
    : matchedSet.has(record as Record<string, unknown>) ? [] : [record]), ids };
}

/** Merge existing saved fields only: never invent memories or rewrite narrative text. */
function mergeSavedFields(older: unknown, newer: unknown): unknown {
  if (Array.isArray(older) && Array.isArray(newer)) {
    const seen = new Set<string>();
    return [...older, ...newer].filter(item => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (isRecord(older) && isRecord(newer)) {
    const result: Record<string, unknown> = { ...older };
    for (const [key, value] of Object.entries(newer)) result[key] = mergeSavedFields(older[key], value);
    return result;
  }
  return newer === undefined || newer === null || newer === '' ? older : newer;
}

/** Targeted old-save migration; unrelated same-name original NPCs are left alone. */
export function reconcileNabuMalikataSaveIdentity(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.NPC)) return input;
  const matches = input.NPC.filter(isNabuRecord);
  if (!matches.length) return input;
  const first = matches[0]!;
  const stableId = typeof first.id === 'string' && first.id ? first.id : matches.find(record => record.id)?.id;
  if (typeof stableId !== 'string') return input;
  // Only declared identity references are remapped. No string replacement in
  // chat content, labels, asset paths, player names, or arbitrary IDs.
  const remap = (value: unknown, field = '', idMap = new Map<string, string>(), contactIds = new Set<string>()): unknown => {
    const remapId = (id: string) => contactIds.has(id) ? id : idMap.get(id) ?? id;
    if (typeof value === 'string') return ID_FIELDS.has(field)
      ? (field === 'npcId' ? idMap.get(value) ?? value : remapId(value)) : value;
    if (Array.isArray(value)) {
      if (ID_LIST_FIELDS.has(field)) return value.map(id => typeof id === 'string'
        ? (field === 'participantIds' || field === 'typingMemberIds' ? remapId(id) : idMap.get(id) ?? id) : id);
      return value.map(item => remap(item, '', idMap, contactIds));
    }
    if (!isRecord(value)) return value;
    // Checkpoints carry their own roster and memories. Merge only their saved
    // records; never inject present-day relationship values into history.
    const rosterKey = Array.isArray(value.NPC) ? 'NPC' : Array.isArray(value.npc) ? 'npc' : undefined;
    let source = value;
    if (rosterKey) {
      const roster = mergeRoster(value[rosterKey] as unknown[], stableId);
      idMap = roster.ids;
      source = { ...value, [rosterKey]: roster.records };
    }
    if ((field === '手机' || field === 'courier') && Array.isArray(value.contacts)) {
      contactIds = new Set(value.contacts.flatMap(contact => isRecord(contact) && typeof contact.id === 'string' ? [contact.id] : []));
    }
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, remap(item, key, idMap, contactIds)]));
  };
  return remap(input);
}
