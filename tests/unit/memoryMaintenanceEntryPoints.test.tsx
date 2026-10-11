// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryPanel } from '@/components/features/GameSystems/MemoryPanel';
import { settlePostNarrativeMemory, rebasePostNarrativeMemorySettlement } from '@/hooks/useGame/postNarrativeMemoryStage';
import { addImmediateMemory } from '@/hooks/useGame/memoryUtils';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { tryAcquireMemoryMaintenanceLease, isMemoryMaintenanceBusy } from '@/services/memoryMaintenanceRegistry';
import { runMemoryLayerCompression } from '@/services/memoryLayerCompression';
import { captureWorldMoment } from '@/services/worldMoment';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import type { MemorySourceLayer } from '@/models/memorySource';

const model = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock('@/services/memoryCompression', async actual => ({ ...await actual<typeof import('@/services/memoryCompression')>(), summarizeMemoryBatch: model.summarize }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settings = { ...创建默认记忆系统设置(), 即时转短期阈值: 2, 短期转中期阈值: 9, 中期转长期阈值: 9 };
const config = {} as API配置项;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())); document.body.innerHTML = ''; model.summarize.mockReset(); });
function input(sessionId?: number) {
  return { memory: addImmediateMemory(创建空记忆系统(), '第一回原文', 1), irminsul: { entries: [] },
    userInput: '交还信物', narrativeSummary: '', body: '安柏收下信物。', turn: 2, settings, mainConfig: config, sessionId };
}

it.each(['immediate', 'short', 'middle'] as const)('routes %s button through the coordinator without a text-only write or undo', async layer => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  let finish!: () => void; const requests: MemorySourceLayer[] = []; const write = vi.fn();
  const onCompress = (selected: MemorySourceLayer) => { requests.push(selected); return new Promise<void>(resolve => { finish = resolve; }); };
  await act(async () => root.render(<MemoryPanel memorySystem={input().memory} onMemorySystemChange={write} turnCount={2} settings={settings} onCompress={onCompress} />));
  if (layer !== 'immediate') {
    const label = layer === 'short' ? '短期' : '中期';
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim().startsWith(label))!.click());
  }
  const button = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.startsWith('压缩到'))!;
  await act(async () => { button.click(); button.click(); });
  expect(requests).toEqual([layer]); expect(button.disabled).toBe(true); expect(write).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('撤销');
  await act(async () => finish()); expect(button.disabled).toBe(false);
});

it('defers automatic compression during a manual lease but retains this turn raw memory', async () => {
  const lease = tryAcquireMemoryMaintenanceLease(6001, 'root-A')!;
  try {
    const result = await settlePostNarrativeMemory(input(6001));
    expect(result.memory.即时记忆).toHaveLength(2); expect(result.memory.即时记忆[1]).toContain('安柏收下信物');
    expect(model.summarize).not.toHaveBeenCalled(); expect(result.feedback.detail).toContain('暂缓');
    expect(isMemoryMaintenanceBusy(6001)).toBe(true);
  } finally { lease.release(); }
});

it('releases its automatic lease when the provider cancels and leaves other session leases intact', async () => {
  const other = tryAcquireMemoryMaintenanceLease(6003, null)!;
  model.summarize.mockRejectedValue(new DOMException('cancel', 'AbortError'));
  try {
    await expect(settlePostNarrativeMemory(input(6002))).rejects.toMatchObject({ name: 'AbortError' });
    expect(isMemoryMaintenanceBusy(6002)).toBe(false); expect(isMemoryMaintenanceBusy(6003)).toBe(true);
  } finally { other.release(); }
});

it('reports threshold and API-local mode honestly without making a model request', async () => {
  const none = await settlePostNarrativeMemory({ ...input(), settings: { ...settings, 即时转短期阈值: 3 } });
  expect(none.feedback.detail).toContain('阈值'); expect(none.feedback.detail).not.toContain('完成整理');
  const local = await settlePostNarrativeMemory({ ...input(), settings: { ...settings, 启用中短长期API总结: false } });
  expect(local.feedback.detail).toContain('API 已关闭'); expect(local.feedback.detail).toContain('本地');
  expect(model.summarize).not.toHaveBeenCalled();
});

it('uses identical source materials and provenance for automatic, manual and world-tree promotion', async () => {
  const state = { memory: addImmediateMemory(input().memory, '第二回原文', 2), irminsul: { entries: [] } };
  const payloads: string[][] = [];
  for (const mode of ['automatic', 'manual', 'irminsul'] as const) {
    const result = await runMemoryLayerCompression({ state, turn: 2, settings, mode, summarizer: async source => {
      payloads.push(source.items); return { ok: true, summary: source.items.join('\n') };
    } });
    expect(result.state.memory.即时记忆).toEqual([]); expect(result.state.memory.短期记忆).toHaveLength(1);
    expect(result.state.irminsul.entries[0]?.sourceTurns).toEqual([1, 2]);
  }
  expect(payloads).toEqual([['第一回原文', '第二回原文'], ['第一回原文', '第二回原文'], ['第一回原文', '第二回原文']]);
});

it('does not automatically re-request ignored failures, but permits explicit manual processing', async () => {
  const state = { memory: addImmediateMemory(input().memory, '第二回原文', 2), irminsul: { entries: [] } };
  const failed = await runMemoryLayerCompression({ state, turn: 2, settings, mode: 'automatic',
    summarizer: async () => ({ ok: false, code: 'request_failed', message: 'offline' }) });
  failed.state.memory.失败草稿![0]!.status = 'ignored';
  const requests: string[] = [];
  const summarizer = async () => { requests.push('call'); return { ok: true as const, summary: '已手动整理' }; };
  await runMemoryLayerCompression({ state: failed.state, turn: 3, settings, mode: 'automatic', summarizer });
  expect(requests).toEqual([]);
  const manual = await runMemoryLayerCompression({ state: failed.state, turn: 3, settings, mode: 'manual', summarizer });
  expect(requests).toEqual(['call']); expect(manual.state.memory.即时记忆).toEqual([]);
});

it('distinguishes a missing API configuration from provider failure', async () => {
  model.summarize.mockResolvedValue({ summary: '', usedFallback: true, failureCode: 'unconfigured', failureMessage: '未配置' });
  const result = await settlePostNarrativeMemory(input());
  expect(result.feedback.detail).toContain('配置'); expect(result.memory.即时记忆).toHaveLength(2);
});

it('merges automatic delta with unrelated live additions instead of deferring the entire compression', async () => {
  model.summarize.mockResolvedValue({ summary: '第一回原文；交还信物；安柏收下信物。', usedModel: true, usedFallback: false });
  const moment = captureWorldMoment(createEmptyTeyvatGameState().世界, 2, 'settled-2');
  const source = { ...input(), moment }; const compressed = await settlePostNarrativeMemory(source);
  const live = addImmediateMemory(source.memory, '玩家另行补充第3回', 3);
  const committed = rebasePostNarrativeMemorySettlement({ baseMemory: source.memory, liveMemory: live,
    compressedMemory: compressed.memory, baseIrminsul: source.irminsul, liveIrminsul: source.irminsul,
    compressedIrminsul: compressed.irminsul, userInput: source.userInput, narrativeSummary: '', body: source.body,
    moment, patch: compressed.patch });
  expect(committed.compressionDeferred).toBe(false); expect(committed.memory.即时记忆).toEqual(['玩家另行补充第3回']);
  expect(committed.memory.短期记忆).toHaveLength(1);
});
