// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCore2Query } from '@/hooks/useCore2Query';
import type { CoreViewRequest } from '@/core/retrieval/viewModels';
import { recallFixture } from './recallFixture';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('cancels closed/replaced reads and refuses late results from the previous view', async () => {
  const f = await recallFixture(1); await f.publish({ memoryId: 'visible-memory', text: '当前分支的记忆' });
  const head = await f.repo.readHead(f.seed.head.scope), node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const original = f.repo.queryMemories.bind(f.repo); let release: (() => void) | undefined;
  vi.spyOn(f.repo, 'queryMemories').mockImplementationOnce(async request => { await new Promise<void>(resolve => { release = resolve; }); return original(request); });
  let view: ReturnType<typeof useCore2Query<'memory'>> | undefined;
  function Probe({ request }: { request: CoreViewRequest<'memory'> | null }) { view = useCore2Query(request, f.repo); return <p>{view.items.map(row => row.text).join(',')}</p>; }
  await act(async () => root.render(<Probe request={{ kind: 'memory', head }} />));
  expect(view!.loading).toBe(true);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await act(async () => root.render(<Probe request={null} />));
  await act(async () => { release!(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(node.textContent).toBe(''); expect(view!.loading).toBe(false);
  await act(async () => root.render(<Probe request={{ kind: 'memory', head }} />));
  for (let i = 0; i < 100 && view!.loading; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(node.textContent).toContain('当前分支的记忆');
  await act(async () => root.unmount()); node.remove();
});
