// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryPanel } from '@/components/features/GameSystems/MemoryPanel';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { captureWorldMoment } from '@/services/worldMoment';
import { addImmediateMemory } from '@/hooks/useGame/memoryUtils';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = '';
});

it('shows the original game-world moment beside an immediate memory', () => {
  const world = createEmptyTeyvatWorld();
  world.当前日期 = '旅行历 1000.03.07';
  world.当前时间 = '10:00';
  world.当前天气 = '晴';
  world.当前地点 = '蒙德城';
  const memory = addImmediateMemory(创建空记忆系统(), '遇见安柏', 2, captureWorldMoment(world, 2, 'turn-2'));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<MemoryPanel memorySystem={memory} onMemorySystemChange={vi.fn()} turnCount={2} settings={创建默认记忆系统设置()} />));
  expect(host.textContent).toContain('遇见安柏');
  expect(host.textContent).toContain('旅行历 1000.03.07');
  expect(host.textContent).toContain('蒙德城');
});
