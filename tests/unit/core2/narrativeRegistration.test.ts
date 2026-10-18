import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { runCoreTurn } from '@/core/settlement/turnRunner';
import { makeSeed, makeCandidate } from './fixtures';
import type { FactProposal } from '@/core/contracts/state';
import type { SourceRecord } from '@/core/contracts/event';

async function fixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-registration-' + crypto.randomUUID() }), seed = makeSeed();
  seed.records = seed.records.filter(row => row.domain !== 'quest' && (row.domain !== 'inventory' || row.value.kind === 'wallet'));
  await repo.initialize(seed);
  const send = (operationId: string, text: string, proposal: FactProposal) => runCoreTurn({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId, text: '继续' }, { repo,
    assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] },
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }),
    factModel: async ({ source }: { source: SourceRecord }) => ({ kind: 'extracted', attempts: 0, candidates: [makeCandidate({ scope: source.scope, operationId, kind: proposal.kind, actors: [seed.playerId], targets: [], proposal,
      evidenceRefs: [{ ref: source.ref, blockId: source.blocks[0]!.blockId, start: 0, end: text.length, quote: text }] })] }),
  });
  return { repo, seed, send };
}
it('registers an explicitly gained new item by host identity, then consumes it without duplicate rewards on replay', async () => {
  const f = await fixture(), gain: FactProposal = { kind: 'inventory', action: 'gain', itemId: 'model-invented-id', itemName: '晶核', quantity: 2 };
  expect((await f.send('new-item-gain', '云获得两枚晶核。', gain)).kind).toBe('committed');
  const item = (await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'inventory' && row.value.kind === 'item');
  expect(item).toMatchObject({ value: { name: '晶核', quantity: 2 } }); expect(item!.entityId).not.toBe('model-invented-id');
  await f.send('new-item-gain', '云获得两枚晶核。', gain);
  expect((await f.send('new-item-use', '云使用一枚晶核。', { kind: 'inventory', action: 'consume', itemId: item!.entityId, quantity: 1 })).kind).toBe('committed');
  expect((await f.repo.readState(f.seed.head.scope)).records.find(row => row.entityId === item!.entityId)).toMatchObject({ value: { quantity: 1 } });
});
it('does not manufacture an unknown consumable, an uncertain gain, or a fabricated item name', async () => {
  const f = await fixture();
  for (const [operationId, text, proposal] of [
    ['unknown-consume', '云使用一枚晶核。', { kind: 'inventory', action: 'consume', itemId: 'unknown', itemName: '晶核', quantity: 1 }],
    ['planned-gain', '云准备获得两枚晶核。', { kind: 'inventory', action: 'gain', itemId: 'unknown', itemName: '晶核', quantity: 2 }],
    ['wrong-name', '云获得两枚苹果。', { kind: 'inventory', action: 'gain', itemId: 'unknown', itemName: '晶核', quantity: 2 }],
  ] as const) expect((await f.send(operationId, text, proposal)).kind).toBe('pending');
  expect((await f.repo.readState(f.seed.head.scope)).records.some(row => row.domain === 'inventory' && row.value.kind === 'item')).toBe(false);
});
it('starts a new evidenced quest with explicit objectives but no invented rewards or completed progress', async () => {
  const f = await fixture();
  const result = await f.send('new-quest-start', '云接取任务「寻找风车」，目标是与安柏交谈。', { kind: 'quest', action: 'start', questId: 'model-quest', definition: { title: '寻找风车', objectives: [{ description: '与安柏交谈', type: 'talk', targetCount: 1 }] } });
  expect(result.kind).toBe('committed');
  const quest = (await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'quest');
  expect(quest).toMatchObject({ value: { title: '寻找风车', status: 'active', rewards: [], objectives: [{ description: '与安柏交谈', currentCount: 0, targetCount: 1, completed: false }] } });
  expect(quest!.entityId).not.toBe('model-quest');
});
it('does not create a quest from absent objectives or ungrounded target counts', async () => {
  const f = await fixture();
  for (const [id, description, count] of [['missing-description', '击败丘丘王', 1], ['wrong-count', '与安柏交谈', 50]] as const) {
    expect((await f.send(id, '云接取任务「寻找风车」，目标是与安柏交谈。', { kind: 'quest', action: 'start', questId: 'model-quest', definition: { title: '寻找风车', objectives: [{ description, type: 'talk', targetCount: count }] } })).kind).toBe('pending');
  }
  expect((await f.repo.readState(f.seed.head.scope)).records.some(row => row.domain === 'quest')).toBe(false);
});
