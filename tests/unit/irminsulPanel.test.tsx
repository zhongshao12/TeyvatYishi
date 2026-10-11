// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { IrminsulPanel } from '@/components/features/GameSystems/IrminsulPanel';
import type { IrminsulEntry } from '@/models/teyvat/irminsul';
import { promoteIrminsulEntry } from '@/services/irminsulPromotion';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = '';
});

it('starts one compression, disables repeat clicks, exposes cancel and reports no eligible batch', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  let finish!: () => void; let calls = 0; let cancelled = 0;
  const onCompress = () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); };
  await act(async () => root.render(<IrminsulPanel memory={{ entries: [] }} onCompress={onCompress} onCancelCompression={() => { cancelled++; }} />));
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === '一键压缩');
  expect(button).toBeDefined();
  await act(async () => { button!.click(); button!.click(); }); expect(calls).toBe(1); expect(button!.disabled).toBe(true);
  await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === '取消整理')!.click());
  expect(cancelled).toBe(1); await act(async () => finish());
  await act(async () => root.render(<IrminsulPanel memory={{ entries: [] }} onCompress={onCompress} maintenanceStatus="没有达到对应阈值的可处理完整批次。" />));
  expect(host.textContent).toContain('没有达到对应阈值');
});

it('shows_active_archive_and_pending_retry_status', () => {
  const source: IrminsulEntry = {
    id: 'short-1', title: '初遇安柏', summary: '安柏迎接玩家', sourceText: '城门原文', keywords: ['安柏'],
    sourceTurns: [1, 2], turn: 2, recordedAt: '第2回', archiveType: 'short',
  };
  const promoted: IrminsulEntry = {
    ...source, id: 'medium-1', title: '蒙德开端', summary: '城门原文；安柏陪同玩家进入蒙德', archiveType: 'medium',
    coveredEntryIds: ['short-1'],
    sourceMomentRange: {
      start: { worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00', weather: '晴', location: '蒙德城', travelDay: 1, turn: 1, settlementId: 'turn-1' },
      end: { worldName: '提瓦特', date: '旅行历 1000.03.08', clock: '18:00', weather: '雨', location: '风起地', travelDay: 2, turn: 2, settlementId: 'turn-2' },
      sourceIds: ['turn-1', 'turn-2'],
    },
  };
  const pending: IrminsulEntry = {
    ...source, id: 'pending-1', title: '压缩待重试', summary: '本地回退摘要', status: 'pending',
    coveredEntryIds: undefined,
  };
  const legacy: IrminsulEntry = {
    ...source, id: 'legacy-1', title: '旧档无覆盖链', summary: '旧档记忆', coveredEntryIds: undefined,
  };
  const memory = promoteIrminsulEntry({ entries: [source, pending, legacy] }, promoted);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<IrminsulPanel memory={memory} />));

  expect(host.textContent).toContain('可召回 2');
  expect(host.textContent).toContain('待重试 1');
  expect(host.textContent).toContain('来源回合 1、2');
  expect(host.textContent).toContain('多地点');
  expect(host.textContent).toContain('多天气');
  expect(host.textContent).toContain('未记录');
  expect(host.textContent).toContain('旧档无覆盖链');
  expect(host.textContent).not.toContain('初遇安柏');
  expect(host.textContent).not.toContain('已压缩删除');
});
