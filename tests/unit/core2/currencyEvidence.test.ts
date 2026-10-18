import { expect, it } from 'vitest';
import { reviewCoreFacts } from '@/core/settlement/evidenceReview';
import { makeCandidate, makeSeed, makeSource } from './fixtures';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { makeNodeRepository } from './nodeCorpusSession';

function fixture(text: string, delta: number) {
  const seed = makeSeed(), source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'currency', kind: 'narration', text }] });
  seed.records.push({ scope: seed.head.scope, domain: 'inventory', entityId: 'wallet', version: 1, value: { kind: 'wallet', mora: 100 } });
  const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, kind: 'currency', actors: [seed.playerId], targets: [seed.playerId], proposal: { kind: 'currency', delta }, evidenceRefs: [{ ref: source.ref, blockId: 'currency', start: 0, end: text.length, quote: text }] });
  return { seed, source, candidate, review: { candidates: [candidate], sources: [source], snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, policy: {} } };
}
it.each([
  ['玩家花了三枚摩拉。', 3000], ['玩家获得十二枚摩拉。', 1200], ['玩家获得十二枚摩拉。', -12],
  ['玩家看着安柏花了三枚摩拉。', -3], ['玩家得知安柏获得十二枚摩拉。', 12], ['玩家的钱包里有三枚摩拉。', 3],
  ['玩家获得十二枚摩拉，随后花了三枚摩拉。', 9], ['玩家获得了几枚摩拉。', 3],
])('does not verify an unsupported wallet direction or amount: %s / %s', (text, delta) => {
  expect(reviewCoreFacts(fixture(text, delta).review).verified).toEqual([]);
});
it.each([
  ['玩家花了三枚摩拉。', -3], ['玩家获得十二枚摩拉。', 12], ['云收到了一百零一摩拉。', 101],
  ['玩家获得一万摩拉。', 10000], ['安柏把二十枚摩拉交给玩家。', 20], ['玩家把二十枚摩拉交给安柏。', -20],
])('keeps precise proven wallet changes: %s / %s', (text, delta) => {
  expect(reviewCoreFacts(fixture(text, delta).review).verified).toHaveLength(1);
});
it('does not increase the durable wallet when model output reverses a documented expense', async () => {
  const f = fixture('玩家花了三枚摩拉。', 3000), repo = makeNodeRepository(`test-core2-wallet-proof-${crypto.randomUUID()}`); await repo.initialize(f.seed);
  const receipt = await settleCoreOperation({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: f.source.operationId, kind: 'main', sources: [f.source] }, { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [f.candidate], attempts: 1 }) });
  expect(receipt.status).toBe('committed');
  expect((await repo.readState(f.seed.head.scope)).records.find(row => row.entityId === 'wallet')?.value).toEqual({ kind: 'wallet', mora: 100 });
});
