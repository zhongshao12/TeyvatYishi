import { describe, expect, it } from 'vitest';
import { coreSchemaDescriptions } from '@/core/contracts/validation';
import { checkDescription } from '@/core/contracts/validationSchema';
import { makeSeed, makeSource } from './fixtures';
import saved from '@/core/contracts/nativeSchemas.json';

describe('portable native structural whitelist', () => {
  it('keeps the actual native-consumed contract synchronized with the sole field definitions', () => {
    expect(saved.formatVersion).toBe(1);
    expect(saved.checks).toEqual(coreSchemaDescriptions());
  });
  it('accepts declared state and rejects undeclared history at the consuming schema boundary', () => {
    const schemas = coreSchemaDescriptions();
    const seed = makeSeed();
    expect(checkDescription(schemas, 'seed', seed)).toBe(true);
    const npc = seed.records.find(record => record.domain === 'npc')!;
    expect(checkDescription(schemas, 'state', npc)).toBe(true);
    expect(checkDescription(schemas, 'state', { ...npc, value: { ...npc.value, sharedMemories: [] } })).toBe(false);
    expect(checkDescription(schemas, 'seed', { ...seed, hiddenPrompt: 'injected' })).toBe(false);
  });

  it('rejects hidden reasoning, invalid scalar types and unknown schema/rule names', () => {
    const schemas = coreSchemaDescriptions();
    expect(checkDescription(schemas, 'source', makeSource())).toBe(true);
    expect(checkDescription(schemas, 'source', { ...makeSource(), blocks: [{ blockId: 'a', kind: 'analysis', text: 'hidden' }] })).toBe(false);
    expect(checkDescription(schemas, 'scope', { journeyId: 'journey-a', branchId: 7 })).toBe(false);
    expect(checkDescription(schemas, 'unknown', {})).toBe(false);
    expect(checkDescription({ entry: { kind: 'rule', name: 'not-registered', base: { kind: 'any' } } }, 'entry', {})).toBe(false);
  });
});
