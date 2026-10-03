import {
  归一化剧情编织系统, 归一化剧情编织系列, 归一化剧情编织分段,
  type 剧情编织系统, type 剧情编织系列, type 剧情编织分段,
  type PersistedStoryWeavingV4, type PersistedStorySeries, type PersistedStoryBuiltinBinding, type StoryBuiltinBinding, type StoryMigrationWarning,
} from '@/models/storyWeaving';

const seriesFields = ['标题', '作品名', '来源文件名', '原始文本', '章节列表', '每段章数', '核心角色摘要', '核心角色', '涉及地点索引', '涉及派系索引'] as const;
const segmentFields = ['标题', '章节范围', '章节标题', '是否开局组', '起始章序号', '结束章序号', '原文内容', '原文摘要', '本段概括', '时间线起点', '时间线终点', '开局已成立事实', '前段延续事实', '本段结束状态', '给后续参考', '原著硬约束', '可提前铺垫', '登场角色', '涉及地点', '涉及派系', '角色档案', '势力档案', '地图地点档案', '关键事件', '场景节点', '时间线', '角色推进'] as const;
const seriesRuntime = ['激活注入', '当前分段组号', '当前阶段概括', 'createdAt', 'updatedAt'] as const;
const segmentRuntime = ['组号', '启用注入', '处理状态', '运行状态', '最近错误', 'updatedAt'] as const;
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const clone = <T,>(value: T): T => structuredClone(value);
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function fingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(stable(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return `${bytes.length.toString(36)}:${hash.toString(36)}`;
}
function pick(value: object, fields: readonly string[]): Record<string, unknown> {
  const raw = record(value);
  return Object.fromEntries(fields.filter(key => owns(raw, key)).map(key => [key, clone(raw[key])]));
}
function validField(key: string, value: unknown): boolean {
  if (['是否开局组'].includes(key)) return typeof value === 'boolean';
  if (['每段章数', '起始章序号', '结束章序号'].includes(key)) return typeof value === 'number' && Number.isFinite(value) && value >= 1;
  if (['标题', '作品名', '来源文件名', '原始文本', '章节范围', '原文内容', '原文摘要', '本段概括', '时间线起点', '时间线终点'].includes(key)) return typeof value === 'string';
  return Array.isArray(value);
}
function overrides(value: unknown, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record(value)).filter(([key, val]) => fields.includes(key) && validField(key, val)).map(([key, val]) => [key, clone(val)]));
}
function baseline(series: 剧情编织系列): StoryBuiltinBinding {
  return {
    resourceRevision: fingerprint([pick(series, seriesFields), series.分段列表.map(segment => [segment.id, pick(segment, segmentFields)])]),
    seriesFieldFingerprints: Object.fromEntries(seriesFields.map(key => [key, fingerprint(series[key])])),
    segmentFieldFingerprints: Object.fromEntries(series.分段列表.map(segment => [segment.id, Object.fromEntries(segmentFields.map(key => [key, fingerprint(segment[key])]))])),
    seriesOverrides: {}, segmentOverrides: Object.fromEntries(series.分段列表.map(segment => [segment.id, {}])), orphanedSegments: [],
  };
}
export function bindStoryResourceBaseline(bundled: 剧情编织系统): 剧情编织系统 {
  const normalized = 归一化剧情编织系统(bundled);
  return { ...normalized, builtinBindings: Object.fromEntries(normalized.系列列表.filter(series => series.来源类型 === 'canon' && series.内置预设ID).map(series => [series.id, baseline(series)])), migrationWarnings: [] };
}
function collect(raw: object, fields: readonly string[], hashes: unknown, prior: unknown): Record<string, unknown> {
  const values = overrides(raw, fields), fingerprints = record(hashes), result = overrides(prior, fields);
  for (const [key, value] of Object.entries(values)) {
    if (typeof fingerprints[key] === 'string' && fingerprint(value) === fingerprints[key]) delete result[key];
    else result[key] = value;
  }
  return result;
}
export function buildPersistedStoryWeavingSystem(system: 剧情编织系统): PersistedStoryWeavingV4 {
  const bindings: Record<string, PersistedStoryBuiltinBinding> = {};
  const seriesList: PersistedStorySeries[] = system.系列列表.map(series => {
    if (series.来源类型 !== 'canon' || !series.内置预设ID) return clone(series);
    const prior = system.builtinBindings?.[series.id];
    const binding: StoryBuiltinBinding = {
      resourceRevision: prior?.resourceRevision ?? 'unknown',
      seriesFieldFingerprints: clone(prior?.seriesFieldFingerprints ?? {}),
      segmentFieldFingerprints: clone(prior?.segmentFieldFingerprints ?? {}),
      seriesOverrides: collect(series, seriesFields, prior?.seriesFieldFingerprints, prior?.seriesOverrides),
      segmentOverrides: {}, orphanedSegments: clone(prior?.orphanedSegments ?? []),
    };
    const segments = series.分段列表.map(segment => {
      const edited = collect(segment, segmentFields, prior?.segmentFieldFingerprints[segment.id], prior?.segmentOverrides[segment.id]);
      binding.segmentOverrides[segment.id] = edited;
      return { id: segment.id, ...pick(segment, segmentRuntime), ...edited };
    });
    bindings[series.id] = { ...binding,
      segmentOverrides: Object.fromEntries(Object.entries(binding.segmentOverrides).filter(([, edits]) => Object.keys(edits).length)),
      seriesFieldFingerprints: seriesFields.map(key => binding.seriesFieldFingerprints[key] ?? ''),
      segmentFieldFingerprints: Object.fromEntries(Object.entries(binding.segmentFieldFingerprints).map(([id, hashes]) => [id, segmentFields.map(key => hashes[key] ?? '')])),
    };
    return { id: series.id, 来源类型: 'canon', 内置预设ID: series.内置预设ID, 来源图鉴条目ID: [], 章节列表: [], ...pick(series, seriesRuntime), ...binding.seriesOverrides, 分段列表: segments };
  });
  return { persistenceVersion: 4, 系列列表: seriesList, 当前系列ID: system.当前系列ID, 当前进度: clone(system.当前进度), builtinBindings: bindings, migrationWarnings: clone(system.migrationWarnings ?? []) };
}
function warning(seriesId: string, field: string, reason: StoryMigrationWarning['reason'], segmentId?: string): StoryMigrationWarning {
  return { id: JSON.stringify([reason, seriesId, segmentId ?? '', field]), seriesId, ...(segmentId ? { segmentId } : {}), field, reason };
}
/** Incoming raw field presence is inspected BEFORE normalizers add defaults. */
export function hydratePersistedStoryWeavingSystem(saved: unknown, bundled: 剧情编织系统): 剧情编织系统 {
  const root = record(saved), incoming = list(root.系列列表);
  const bound = bindStoryResourceBaseline(bundled);
  if (!incoming.length) return bound;
  const warnings = new Map<string, StoryMigrationWarning>();
  for (const raw of list(root.migrationWarnings)) {
    if (typeof raw.id === 'string' && typeof raw.seriesId === 'string' && typeof raw.field === 'string' && (raw.reason === 'resource_removed' || raw.reason === 'legacy_origin_unknown')) {
      const entry = warning(raw.seriesId, raw.field, raw.reason, typeof raw.segmentId === 'string' ? raw.segmentId : undefined); warnings.set(entry.id, entry);
    }
  }
  const addWarning = (entry: StoryMigrationWarning) => warnings.set(entry.id, entry);
  // Full live input must collect edits against ITS baseline before applying a new resource.
  const transport = root.persistenceVersion === 4 ? root : root.builtinBindings
    ? record(buildPersistedStoryWeavingSystem(saved as 剧情编织系统)) : root;
  const savedSeries = new Map(list(transport.系列列表).flatMap(raw => typeof raw.id === 'string' ? [[raw.id, raw] as const] : []));
  const oldBindings = record(transport.builtinBindings);
  const bindings = bound.builtinBindings!;
  const merged = bound.系列列表.filter(series => series.来源类型 === 'canon' && series.内置预设ID).map(resource => {
    const raw = savedSeries.get(resource.id);
    if (!raw) return resource;
    const binding = bindings[resource.id]!;
    const oldBinding = record(oldBindings[resource.id]);
    const hasProvenance = typeof oldBinding.resourceRevision === 'string' && oldBinding.resourceRevision !== 'unknown';
    function resolveContent(input: object, base: object, fields: readonly string[], prior: unknown, segmentId?: string) {
      const edits = overrides(prior, fields);
      if (!hasProvenance) for (const [field, value] of Object.entries(overrides(input, fields))) {
        // v2 lightweight chapters=[] is an omission sentinel, not a deliberate editor action.
        if (root.persistenceVersion === 2 && field === '章节列表' && Array.isArray(value) && !value.length) continue;
        if (fingerprint(value) !== fingerprint(record(base)[field])) { edits[field] = value; addWarning(warning(resource.id, field, 'legacy_origin_unknown', segmentId)); }
      }
      return edits;
    }
    binding.seriesOverrides = resolveContent(raw, resource, seriesFields, oldBinding.seriesOverrides);
    const rawSegments = new Map(list(raw.分段列表).flatMap(segment => typeof segment.id === 'string' ? [[segment.id, segment] as const] : []));
    const segments = resource.分段列表.map(segment => {
      const input = rawSegments.get(segment.id);
      if (!input) return segment;
      const edits = resolveContent(input, segment, segmentFields, record(oldBinding.segmentOverrides)[segment.id], segment.id);
      binding.segmentOverrides[segment.id] = edits;
      const mergedSegment = { ...segment, ...pick(input, segmentRuntime), ...edits };
      return { ...mergedSegment, 字数: [...mergedSegment.原文内容].length };
    });
    for (const [id, input] of rawSegments) if (!segments.some(segment => segment.id === id)) {
      const prior = list(oldBinding.orphanedSegments).find(segment => segment.id === id);
      const orphan = 归一化剧情编织系列({ id: resource.id, 分段列表: [归一化剧情编织分段({ ...prior, ...input, ...overrides(record(oldBinding.segmentOverrides)[id], segmentFields) }, Number(input.组号) || 1)] }).分段列表[0]!;
      segments.push(orphan); binding.orphanedSegments.push(clone(orphan));
      binding.segmentOverrides[id] = overrides(record(oldBinding.segmentOverrides)[id], segmentFields);
      addWarning(warning(resource.id, '分段列表', 'resource_removed', id));
    }
    const next = 归一化剧情编织系列({ ...resource, ...pick(raw, seriesRuntime), ...binding.seriesOverrides, 分段列表: segments });
    // Normalizers derive summaries and names; explicit editor values win afterwards.
    Object.assign(next, binding.seriesOverrides);
    next.分段列表 = segments;
    return next;
  });
  for (const [id, raw] of savedSeries) if (!merged.some(series => series.id === id)) {
    const item = 归一化剧情编织系列(raw);
    if (raw.来源类型 === 'canon' && raw.内置预设ID) {
      addWarning(warning(id, '系列列表', 'resource_removed'));
      const prior = record(oldBindings[id]);
      const expand = (value: unknown, fields: readonly string[]): Record<string, string> => Object.fromEntries(fields.flatMap((key, index) => {
        const hash = Array.isArray(value) ? value[index] : record(value)[key];
        return typeof hash === 'string' ? [[key, hash]] : [];
      }));
      bindings[id] = { ...baseline(item),
        resourceRevision: typeof prior.resourceRevision === 'string' ? prior.resourceRevision : 'unknown',
        seriesFieldFingerprints: expand(prior.seriesFieldFingerprints, seriesFields),
        segmentFieldFingerprints: Object.fromEntries(Object.entries(record(prior.segmentFieldFingerprints)).map(([segmentId, hashes]) => [segmentId, expand(hashes, segmentFields)])),
        seriesOverrides: overrides(prior.seriesOverrides, seriesFields),
        segmentOverrides: Object.fromEntries(Object.entries(record(prior.segmentOverrides)).map(([segmentId, edits]) => [segmentId, overrides(edits, segmentFields)])),
      };
    }
    merged.push(item);
  }
  const result = 归一化剧情编织系统({ 系列列表: merged, 当前系列ID: typeof root.当前系列ID === 'string' ? root.当前系列ID : bundled.当前系列ID, 当前进度: root.当前进度 as 剧情编织系统['当前进度'] });
  result.系列列表 = merged;
  return { ...result, builtinBindings: bindings, migrationWarnings: [...warnings.values()] };
}
export function restoreStoryBuiltinField(system: 剧情编织系统, bundled: 剧情编织系统, target: { seriesId: string; segmentId?: string; field: string }): 剧情编织系统 {
  const persisted = buildPersistedStoryWeavingSystem(system);
  const binding = persisted.builtinBindings[target.seriesId];
  const series = persisted.系列列表.find(item => item.id === target.seriesId);
  const resource = bundled.系列列表.find(item => item.id === target.seriesId);
  if (!binding || !series || !resource) return clone(system);
  if (target.segmentId) {
    const segment = series.分段列表.find(item => item.id === target.segmentId);
    if (!segment || !resource.分段列表.some(item => item.id === target.segmentId) || !segmentFields.includes(target.field as typeof segmentFields[number])) return clone(system);
    delete binding.segmentOverrides[target.segmentId]?.[target.field]; delete record(segment)[target.field];
  } else {
    if (!seriesFields.includes(target.field as typeof seriesFields[number])) return clone(system);
    delete binding.seriesOverrides[target.field]; delete record(series)[target.field];
  }
  persisted.migrationWarnings = persisted.migrationWarnings.filter(entry => !(entry.seriesId === target.seriesId && entry.segmentId === target.segmentId && entry.field === target.field));
  return hydratePersistedStoryWeavingSystem(persisted, bundled);
}
