import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';

export function assertJourneyDirectoryContract(factory: () => Promise<CoreRepository>): void {
  it('aborts an old journey request when selecting another journey and refuses its late result', async () => {
    const repo = await factory(), a = makeSeed(), b = makeSeed(); await repo.initialize(b);
    let enter!: () => void, release!: () => void, signal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', attempts: 0, candidates: [] }), generateNarrative: async input => { signal = input.signal; enter(); await held; return JSON.stringify({ body: [{ kind: 'narration', text: '不能串到另一份旅程' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }); } }) });
    try {
      await controller.initialize(a); const turn = controller.send({ scope: a.head.scope, sessionId: a.head.sessionId, operationId: 'switch-main', text: '出发' }); await entered;
      await controller.attach({ scope: b.head.scope }); expect(signal?.aborted).toBe(true); release(); expect((await turn).kind).toBe('cancelled');
      expect(controller.getView().snapshot!.head.scope).toEqual(b.head.scope); expect(controller.getView().busy).toBe(false);
      expect((await repo.readHead(a.head.scope)).coreSeq).toBe(0); expect((await repo.readHead(b.head.scope)).coreSeq).toBe(0);
    } finally { release(); controller.dispose(); }
  });
  it('lists distinct same-name journeys with bounded metadata and persists explicit selection without mixing their records', async () => {
    const repo = await factory(), first = makeSeed(), second = makeSeed();
    const pointers: unknown[] = [], model = vi.fn();
    const controller = createCoreController({ repo, savePointer: pointer => { pointers.push(structuredClone(pointer)); }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
    try {
      await controller.initialize(first); await controller.initialize(second);
      const source = vi.spyOn(repo, 'readSource'); source.mockClear(); const state = vi.spyOn(repo, 'readState'); state.mockClear();
      const page = await repo.queryJourneys({ limit: 1 }); expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeTruthy();
      const next = await repo.queryJourneys({ limit: 1, cursor: page.nextCursor! }); expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeUndefined();
      expect(new Set([...page.items, ...next.items].map(row => row.scope.journeyId)).size).toBe(2);
      expect([...page.items, ...next.items].map(row => row.name)).toEqual(['云', '云']); expect(source).not.toHaveBeenCalled(); expect(state).not.toHaveBeenCalled();
      await expect(repo.queryJourneys({ limit: 2, cursor: page.nextCursor! })).rejects.toThrow('CORE2_CURSOR_MISMATCH');
      await controller.attach({ scope: first.head.scope });
      expect(pointers.at(-1)).toEqual({ scope: first.head.scope });
      await controller.command({ type: 'edit_traveler', field: '姓名', value: '云甲' });
      expect((await repo.readState(second.head.scope)).records.find(row => row.domain === 'traveler')).toMatchObject({ value: { 姓名: '云' } });
      expect((await repo.queryJourneys({})).items.find(row => row.scope.journeyId === first.head.scope.journeyId)?.name).toBe('云甲');
      expect(model).not.toHaveBeenCalled();
    } finally { controller.dispose(); }
  });
}
