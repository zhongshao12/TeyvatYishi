import type { MemoryRecord, MemorySettings } from '../contracts/memory';
import type { MaintenanceStep } from './maintenancePlan';
import type { MemoryModelDependencies } from './turnSummary';
import { buildFallbackSummary } from '@/services/memoryCompression';
import { compareCoreIds } from '../persistence/repositoryValidation';

/** Never cascade unpublished outputs inside one atomic plan. Each layer uses its own threshold. */
export function planLayerCompression(memories: MemoryRecord[], settings: MemorySettings): MaintenanceStep[] {
  if (![settings.shortThreshold, settings.middleThreshold, settings.longThreshold].every(value => Number.isSafeInteger(value) && value >= 2)) throw Error('各层整理阈值必须是至少 2 的整数。');
  const steps: MaintenanceStep[] = [];
  for (const [source, target, threshold] of [['short', 'middle', settings.shortThreshold], ['middle', 'long', settings.middleThreshold], ['long', 'long', settings.longThreshold]] as const) {
    const selected = memories.filter(memory => memory.layer === source).sort((a, b) => Math.min(...a.turns) - Math.min(...b.turns) || compareCoreIds(a.memoryId, b.memoryId));
    for (let start = 0; start + threshold <= selected.length; start += threshold) steps.push({ stepId: `layer-${source}-${start / threshold}`, kind: 'layer', layer: target, memoryRefs: selected.slice(start, start + threshold).map(memory => ({ memoryId: memory.memoryId, version: memory.version })) });
  }
  return steps;
}
export async function summarizeCoreLayer(memories: MemoryRecord[], layer: 'short' | 'middle' | 'long', settings: MemorySettings, deps: MemoryModelDependencies, signal?: AbortSignal): Promise<string> {
  const items = memories.map(memory => memory.text), turn = Math.max(...memories.flatMap(memory => memory.turns));
  if (signal?.aborted) throw Error('记忆整理已停止。');
  if (settings.mode === 'local') return buildFallbackSummary(items, turn, layer);
  if (!deps.summarize) throw Error('记忆模型尚未配置，未用本地摘录冒充成功。');
  const result = await deps.summarize({ items, turn, layer, prompt: settings.prompt, signal });
  if (signal?.aborted) throw Error('记忆整理已停止。');
  if (result.kind === 'failed') throw Error(`${result.code}: ${result.detail}`);
  if (!result.text.trim() || /<(?:char_seven|time_format|变量事实)(?:\s|>)/iu.test(result.text)) throw Error('摘要为空或含技术面板，未发布。');
  return result.text;
}
