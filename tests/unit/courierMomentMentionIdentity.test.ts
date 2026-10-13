import { describe, expect, it } from 'vitest';
import { parseMomentMentions, shiftMomentMentionBindings } from '@/services/courierMoments';

const contacts = [
  { id: 'contact_first', npcId: 'first', name: '阿林', available: true },
  { id: 'contact_second', npcId: 'second', name: '阿林', available: true },
  { id: 'guide', npcId: 'guide', name: '向导', available: true },
];

describe('moment mentions use identity, not array order', () => {
  it('does not route an ambiguous typed name to the first namesake', () => {
    expect(parseMomentMentions('@阿林 明天见', contacts)).toEqual([]);
    expect(parseMomentMentions('@阿林 明天见', [...contacts].reverse())).toEqual([]);
    expect(parseMomentMentions('@向导 明天见', contacts)).toEqual(['guide']);
  });
  it('ignores locked contacts even when an imported available flag contradicts their status', () => {
    expect(parseMomentMentions('@向导 明天见', [{ ...contacts[2]!, status: 'story_locked' }])).toEqual([]);
  });
  it('uses a selected ID and never falls back to its namesake after removal', () => {
    const binding = [{ npcId: 'second', start: 0, token: '@阿林' }];
    expect(Reflect.apply(parseMomentMentions, undefined, ['@阿林 明天见', contacts, binding])).toEqual(['second']);
    expect(Reflect.apply(parseMomentMentions, undefined, ['@阿林 明天见', contacts.filter(contact => contact.npcId !== 'second'), binding])).toEqual([]);
  });
  it('does not retain a short-name binding when removing the separator turns it into a different name', () => {
    const bindings = [{ npcId: 'short', start: 0, token: '@阿' }, { npcId: 'long', start: 3, token: '@阿林' }];
    expect(shiftMomentMentionBindings('@阿 @阿林 ', '@阿林 ', bindings)).toEqual([]);
  });
  it('keeps the same identity when duplicate tokens both referred to the same NPC', () => {
    expect(shiftMomentMentionBindings('@阿林 @阿林 ', '@阿林 ', [{ npcId: 'second', start: 0, token: '@阿林' }, { npcId: 'second', start: 4, token: '@阿林' }]))
      .toEqual([{ npcId: 'second', start: 0, token: '@阿林' }]);
  });
});
