import { useMemo } from 'react';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';

export function StoryProvenancePanel({ system, seriesId, segmentId, onRestore }: {
  system: 剧情编织系统; seriesId: string; segmentId: string;
  onRestore: (field: string, segmentId?: string) => void;
}) {
  const binding = useMemo(() => buildPersistedStoryWeavingSystem({ ...system, 系列列表: system.系列列表.filter(series => series.id === seriesId) }).builtinBindings[seriesId], [system, seriesId]);
  const warnings = system.migrationWarnings?.filter(entry => entry.seriesId === seriesId) ?? [];
  if (!binding && !warnings.length) return null;
  const fields = [...Object.keys(binding?.seriesOverrides ?? {}).map(field => ({ field, segment: undefined })), ...Object.keys(binding?.segmentOverrides[segmentId] ?? {}).map(field => ({ field, segment: segmentId }))];
  return <section className="space-y-2 rounded border p-3 text-xs" aria-label="剧情字段来源" style={{ color: 'rgb(var(--tj-text-primary))', borderColor: 'rgba(var(--tj-accent-primary),0.3)' }}>
    <p>资源更新只刷新未编辑字段；当前进度独立保留。</p>
    {warnings.some(entry => entry.reason === 'legacy_origin_unknown') && <p role="note">旧档保留，来源未确认：差异已保守保留，可逐字段恢复。</p>}
    {warnings.some(entry => entry.reason === 'resource_removed') && <p role="note">资源已移除：本地资料与运行引用仍保留；未保存的原文资源不可用。</p>}
    {!fields.length && <p>内容来源：内置资源</p>}
    {fields.map(({ field, segment }) => <div key={`${segment ?? 'series'}:${field}`} className="flex flex-wrap items-center gap-2">
      <span>{field} · {warnings.some(entry => entry.field === field && entry.segmentId === segment) ? '旧档来源未确认' : '本地编辑'}</span>
      <button type="button" className="panel-btn" aria-label={`恢复${field}内置值`} onClick={() => onRestore(field, segment)}>恢复此字段内置值</button>
    </div>)}
  </section>;
}
