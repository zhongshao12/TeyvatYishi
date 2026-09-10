import type { SaveUniverseClass } from './types';

type RecordValue = Record<string, unknown>;

const LEGACY_UNIVERSES = new Set(['legacy-hsr', 'hsr', 'honkai-star-rail', 'honkai_star_rail']);
const TEYVAT_REGION_IDS = new Set(['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai']);
const LEGACY_REGION_IDS = new Set(['herta-space-station', 'jarilo-vi', 'xianzhou-luofu', 'penacony', 'amphoreus']);
const TEYVAT_LOCATIONS = new Set(['蒙德城', '璃月港', '稻妻城', '须弥城', '枫丹廷', '纳塔']);
const LEGACY_LOCATIONS = new Set(['主控舱段', '行政区', '星槎海中枢', '黄金的时刻', '黑塔空间站', '贝洛伯格', '罗浮', '匹诺康尼']);
const TEYVAT_CHARACTERS = new Set(['安柏', '凯亚', '丽莎', '琴', '迪卢克', '空', '荧']);
const LEGACY_CHARACTERS = new Set(['三月七', '丹恒', '姬子', '瓦尔特', '帕姆', '星', '穹']);
const TEYVAT_STORY_SERIES = new Set(['mondstadt-prologue', 'liyue-chapter', 'inazuma-chapter', 'sumeru-chapter', 'fontaine-chapter', 'natlan-chapter']);
const LEGACY_STORY_SERIES = new Set(['trailblaze-mission-herta', 'trailblaze-mission-belobog', 'trailblaze-mission-xianzhou', 'trailblaze-mission-penacony']);

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringAt(record: RecordValue, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function childRecord(record: RecordValue, key: string): RecordValue | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function characterNames(record: RecordValue): string[] {
  const candidateLists = [record.NPC, record.角色, record.伙伴];
  return candidateLists.flatMap((candidate) => Array.isArray(candidate)
    ? candidate.flatMap((entry) => isRecord(entry) ? [stringAt(entry, '姓名', 'name')].filter((name): name is string => Boolean(name)) : [])
    : []);
}

function universeSignals(input: RecordValue): { teyvat: Set<string>; legacy: Set<string> } {
  const world = childRecord(input, '世界') ?? input;
  const region = stringAt(world, '开局地区', '地区ID', 'currentRegion', 'region');
  const location = stringAt(world, '当前地点', 'currentLocation', 'location');
  const story = stringAt(input, '剧情系列', 'storySeries', '主线系列');
  const names = characterNames(input);
  const teyvat = new Set<string>();
  const legacy = new Set<string>();

  if (region && TEYVAT_REGION_IDS.has(region)) teyvat.add('region');
  if (region && LEGACY_REGION_IDS.has(region)) legacy.add('region');
  if (location && TEYVAT_LOCATIONS.has(location)) teyvat.add('location');
  if (location && LEGACY_LOCATIONS.has(location)) legacy.add('location');
  if (story && TEYVAT_STORY_SERIES.has(story)) teyvat.add('story');
  if (story && LEGACY_STORY_SERIES.has(story)) legacy.add('story');
  if (names.some((name) => TEYVAT_CHARACTERS.has(name))) teyvat.add('character');
  if (names.some((name) => LEGACY_CHARACTERS.has(name))) legacy.add('character');

  return { teyvat, legacy };
}

/**
 * Treat unmarked data conservatively: two distinct, typed save structures are
 * required. Free-text narrative fields intentionally never participate.
 */
export function classifySaveUniverse(input: unknown): SaveUniverseClass {
  if (!isRecord(input)) return 'unknown';

  if (typeof input.universe === 'string') {
    if (input.universe === 'teyvat') return 'teyvat';
    if (input.universe === 'partial-teyvat') return 'partial-teyvat';
    if (LEGACY_UNIVERSES.has(input.universe)) return 'legacy-hsr';
    return 'unknown';
  }

  const { teyvat, legacy } = universeSignals(input);
  if (legacy.size >= 2 && teyvat.size < 2) return 'legacy-hsr';
  if (teyvat.size >= 2 && legacy.size < 2) return 'partial-teyvat';
  return 'unknown';
}
