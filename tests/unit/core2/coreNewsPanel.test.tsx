// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { recallFixture } from './recallFixture';
import { createCoreController } from '@/core/settlement/coreController';
import { Core2App } from '@/components/features/Core2/Core2App';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('opens the news page without generation and explicitly publishes a readable issue on request', async () => {
  const f = await recallFixture(), generate = vi.fn(async () => ({ kind: 'generated' as const, articles: [{ title: '城中见闻', lead: '安柏送来苹果。', body: '这是一段完整而简短的报道。', sourceFactIds: [f.batches[0]!.events[0]!.eventId] }], bundle: { bundleId: 'news-ui-context', mandatoryText: '', optionalText: '', selectedLeafIds: [], estimatedTokens: 0, budgetOverflow: false, diagnostics: [] } }));
  const controller = createCoreController({ repo: f.repo, newsModels: { generate, getModelIdentity: () => 'ui-news-test' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => '' }) });
  await controller.attach({ scope: f.seed.head.scope });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), request = vi.spyOn(controller, 'requestNews');
  const button = (name: string) => [...node.querySelectorAll('button')].find(row => row.textContent === name);
  try {
    await act(async () => root.render(<Core2App repo={f.repo} controller={controller} />));
    expect(button('蒸汽鸟报')).toBeTruthy(); await act(async () => button('蒸汽鸟报')!.click()); expect(generate).not.toHaveBeenCalled();
    await act(async () => { button('生成本期简报')!.click(); await request.mock.results.at(-1)!.value; await controller.waitForBackground(); });
    expect(generate).toHaveBeenCalledTimes(1);
    const issue = [...node.querySelectorAll('button')].find(row => row.textContent?.startsWith('阅读简报') && row.getAttribute('data-issue-id') !== 'news-1'); expect(issue).toBeTruthy();
    await act(async () => { issue!.click(); });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(node.textContent).toContain('这是一段完整而简短的报道。'); });
    expect(node.textContent).toContain('城中见闻'); expect(generate).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
