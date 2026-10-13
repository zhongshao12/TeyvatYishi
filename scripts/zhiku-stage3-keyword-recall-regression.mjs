import assert from 'node:assert/strict';
import './lib/tsAliasRegister.mjs';

const { normalizeArchiveCodex } = await import('../models/teyvat/codex.ts');
const { retrieveCodexEntries } = await import('../services/codexRetrieval.ts');

const categories = ['character', 'place', 'term', 'story'];
const codex = normalizeArchiveCodex({
  entries: [
    ...categories.map((category) => ({
      id: `locked-${category}`, category, name: `暮灯${category}`, summary: `${category}档案`,
      description: `${category}说明`, sourceText: `${category}来源正文`, source: 'regression-fixture',
      keywords: ['shared-recall-signal', `keyword-${category}`], triggerKeywords: [`trigger-${category}`],
      injection: { publicText: `${category}写作参考事实` },
      runtimeUnlock: { status: 'locked', note: '尚未发现', condition: '故事进度' },
      relatedEntryIds: ['related-entry'], usage: { narrative: true },
    })),
    { id: 'unrelated', category: 'organization', name: 'Other Guild', keywords: ['other-guild'],
      injection: { publicText: 'UNRELATED_SENTINEL' }, runtimeUnlock: { status: 'unlocked' } },
  ],
  unlockedEntryIds: ['unrelated'],
});
const before = JSON.stringify(codex);
assert.deepEqual(codex.unlockedEntryIds, ['unrelated'], 'The formal Codex contract must retain discovery progress.');

for (const category of categories) {
  const source = codex.entries.find((entry) => entry.id === `locked-${category}`);
  assert(source, `The formal Codex contract must retain the locked ${category} resource.`);
  assert.deepEqual(source.keywords, ['shared-recall-signal', `keyword-${category}`], 'The data contract must preserve explicit keywords.');
  assert.deepEqual(source.triggerKeywords, [`trigger-${category}`], 'The data contract must preserve trigger keywords.');
  assert.deepEqual(source.runtimeUnlock, { status: 'locked', note: '尚未发现', condition: '故事进度' }, 'The data contract must preserve the locked resource state.');
  for (const query of [`keyword-${category}`, `trigger-${category}`]) {
    const result = retrieveCodexEntries(codex, query, 1);
    assert.deepEqual(result.entries.map((entry) => entry.id), [source.id], `Relevant locked ${category} must remain recallable by ${query}.`);
    assert.deepEqual(result.entries[0], source, 'Recall must preserve all source data fields, including discovery progress.');
    assert(result.injection.includes(`${category}写作参考事实`), 'Relevant reference facts must be included.');
    assert(result.injection.includes('不是 NPC 已知信息') && result.injection.includes('NPC 仍只知道亲历、被直接告知或确认公开获知的事实'), 'Player recall must retain the NPC knowledge boundary.');
    assert(result.injection.includes('未发生剧情不能当作已发生'), 'Locked story references must not become completed events.');
    assert(!result.injection.includes('UNRELATED_SENTINEL'), 'Unrelated unlocked resources must not be injected.');
  }
}

assert.equal(retrieveCodexEntries(codex, 'shared-recall-signal', 2).entries.length, 2, 'Recall must retain the configured entry limit.');
assert.deepEqual(retrieveCodexEntries(codex, 'completely-unrelated-signal').entries, [], 'Unrelated queries must not inject the library.');
assert.deepEqual(retrieveCodexEntries(codex, '').entries, [], 'Empty input must not inject the library.');
assert.equal(JSON.stringify(codex), before, 'Recall must not mutate unlock flags or any source data.');

const detached = retrieveCodexEntries(codex, 'keyword-character', 1).entries[0];
detached.keywords.push('result-only');
detached.runtimeUnlock.status = 'unlocked';
detached.injection.publicText = 'result-only';
assert.equal(JSON.stringify(codex), before, 'Returned records must not alias mutable source arrays or discovery fields.');

console.log('codex stage3 keyword recall regression ok');
