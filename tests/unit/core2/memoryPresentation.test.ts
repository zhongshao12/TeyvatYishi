import { expect, it } from 'vitest';
import { displayCoreMemoryText } from '@/core/retrieval/memoryPresentation';
import { makeMemory } from './fixtures';
it('shows local records as readable text, preserving utterance attribution and manual originals', () => {
  const memory = makeMemory({ text: '- ' + JSON.stringify({ kind: 'recorded_utterance', actorIds: ['npc-amber'], text: '明天陪你去风起地吧。' }) });
  expect(displayCoreMemoryText(memory)).toContain('原话记录'); expect(displayCoreMemoryText(memory)).toContain('明天陪你去风起地吧。');
  expect(displayCoreMemoryText(memory)).not.toMatch(/actorIds|recorded_utterance|\{/);
  const manual = { ...memory, generation: { mode: 'manual' as const, version: '1' }, text: '我自己写的格式 {保持}' };
  expect(displayCoreMemoryText(manual)).toBe(manual.text);
});
