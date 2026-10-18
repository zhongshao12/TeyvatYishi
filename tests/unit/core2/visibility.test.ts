import { describe, expect, it } from 'vitest';
import { checkMemoryVisibility } from '@/core/knowledge/visibility';
import type { Audience, KnowledgeRecord } from '@/core/contracts/knowledge';
import { makeMemory } from './fixtures';
const audience: Audience = { target: 'private', npcIds: ['npc-amber'] };
function knowledge(eventId = 'event-apple-1'): KnowledgeRecord {
  const memory = makeMemory();
  return { knowledgeId: `knows-${eventId}`, scope: memory.scope, npcId: 'npc-amber', eventId, mode: 'witnessed', evidenceRefs: [{ ref: memory.sourceRefs[0]!, blockId: 'b', start: 0, end: 2, quote: '原文' }], learnedMoment: memory.momentRange.start!, nature: 'fact', version: 1 };
}
describe('core2 memory visibility', () => {
  it('requires actual knowledge even when the NPC is listed as a participant or the event is public', () => {
    const memory = makeMemory();
    expect(checkMemoryVisibility(memory, audience, []).allowed).toBe(false);
    memory.visibility.kind = 'public';
    expect(checkMemoryVisibility(memory, audience, []).allowed).toBe(false);
    expect(checkMemoryVisibility(memory, audience, [knowledge()]).allowed).toBe(true);
  });
  it('returns only permitted leaf events and refuses to inject a partially visible mixed summary', () => {
    const memory = makeMemory({ eventIds: ['event-apple-1', 'secret-2'] });
    expect(checkMemoryVisibility(memory, audience, [knowledge()])).toMatchObject({ allowed: false, leafIds: ['event-apple-1'] });
    expect(checkMemoryVisibility(memory, { target: 'group', npcIds: ['npc-amber', 'npc-jean'] }, [knowledge()]).allowed).toBe(false);
  });
  it('does not grant factual knowledge based on rumor, belief, a foreign branch, or an unresolved memory reference', () => {
    const memory = makeMemory(); const known = knowledge();
    expect(checkMemoryVisibility(memory, audience, [{ ...known, mode: 'rumor', nature: 'belief' }]).allowed).toBe(false);
    expect(checkMemoryVisibility(memory, audience, [{ ...known, scope: { ...known.scope, branchId: 'other' } }]).allowed).toBe(false);
    expect(checkMemoryVisibility({ ...memory, memoryRefs: [{ memoryId: 'unresolved', version: 1 }] }, audience, [known]).allowed).toBe(false);
  });
  it('allows player-only history but keeps private data out of news', () => {
    const memory = makeMemory({ visibility: { kind: 'private', npcIds: [] } });
    expect(checkMemoryVisibility(memory, { target: 'main', npcIds: [] }, []).allowed).toBe(true);
    expect(checkMemoryVisibility(memory, { target: 'news', npcIds: [] }, []).allowed).toBe(false);
  });
});
