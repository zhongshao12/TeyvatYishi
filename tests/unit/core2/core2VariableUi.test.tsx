// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CoreReviewPanel } from '@/components/features/Core2/CoreReviewPanel';
import { makeCandidate } from './fixtures';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('shows the exact disputed evidence and exposes deliberate confirm/reject callbacks, not automatic writes', async () => {
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const onReview = vi.fn(async () => undefined), candidate = makeCandidate({ status: 'pending', reason: '数量待核对' });
  await act(async () => root.render(<CoreReviewPanel receipt={{ saved: true, memoryPending: true, status: 'committed', changes: [], sourceRefs: [] }} pending={[{ originOperationId: 'original', candidate }]} busy={false} onReview={onReview} />));
  expect(onReview).not.toHaveBeenCalled();
  expect(node.textContent).toContain(candidate.evidenceRefs[0]!.quote);
  expect(node.textContent).toContain('核心已保存'); expect(node.textContent).toContain('记忆整理尚未完成');
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === '拒绝此项')!.click());
  expect(onReview).toHaveBeenCalledWith('original', candidate, 'reject');
  await act(async () => root.unmount()); node.remove();
});
