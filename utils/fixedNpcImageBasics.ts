import { normalizeImageCharacterEnglishCache } from '@/models/imageCharacterEnglish';
const fields = ['姓名', '别名', '性别', '外貌', '外貌档案', '穿着', '性格', 'gender', 'aliases', 'appearance', 'appearanceFacts', 'clothing', 'personality'] as const;
type Data = Record<string, unknown>;
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};

/** Recorded base fields are write-once for background work; only missing fields may be filled before English is prepared. */
export function preserveFixedNpcImageBasics<T extends object>(live: T, produced: T): T {
  const before = live as Data, after = produced as Data;
  const archiveKey = before.图像档案 ? '图像档案' : 'visualArchive', archive = record(before[archiveKey]);
  const fixedEnglish = normalizeImageCharacterEnglishCache(archive.englishFacts);
  const output = { ...after };
  for (const key of fields) {
    if (!Object.hasOwn(before, key)) continue;
    const value = before[key];
    if (fixedEnglish) output[key] = value;
    else if (key === '外貌档案' || key === 'appearanceFacts') { if (value && typeof value === 'object') output[key] = { ...record(after[key]), ...record(value) }; }
    else if (typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.length : value != null) output[key] = value;
  }
  if (!fixedEnglish) return output as T;
  const nextArchive = { ...record(after[archiveKey]), englishFacts: archive.englishFacts };
  for (const key of ['角色锚点', 'characterAnchor']) if (Object.hasOwn(archive, key)) (nextArchive as Data)[key] = archive[key];
  output[archiveKey] = nextArchive; return output as T;
}

/** Explicit player editing is the one boundary allowed to invalidate translation. */
export function resetNpcEnglishAfterManualEdit<T extends object>(before: T, after: T): T {
  const a = before as Data, b = after as Data;
  if (!fields.some(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))) return after;
  const output = { ...b };
  for (const key of ['图像档案', 'visualArchive']) if (b[key] && record(b[key]).englishFacts) { const archive = { ...record(b[key]) }; delete archive.englishFacts; output[key] = archive; }
  return output as T;
}
