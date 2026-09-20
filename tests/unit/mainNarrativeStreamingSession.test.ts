import { describe, expect, it } from 'vitest';
import { createMainNarrativeStreamingSession } from '@/hooks/useGame/mainNarrativeStreamingSession';

describe('main narrative streaming session', () => {
  it('publishes the accumulated response immediately when streaming preview is disabled', async () => {
    const published: string[] = [];
    const session = createMainNarrativeStreamingSession({
      enabled: false,
      signal: new AbortController().signal,
      set: (text) => { published.push(text); },
      flush: () => undefined,
      wait: async () => undefined,
      isHidden: () => false,
    });

    session.onDelta('第一段');
    session.onDelta('第二段');
    await session.waitForPending();

    expect(published).toEqual(['第一段', '第一段第二段']);
    expect(session.streamedText).toBe('第一段第二段');
    expect(session.eventCount).toBe(0);
  });

  it('resets all attempt-local text before a retry starts', async () => {
    const flushed: string[] = [];
    const session = createMainNarrativeStreamingSession({
      enabled: true,
      signal: new AbortController().signal,
      set: () => undefined,
      flush: (text) => { flushed.push(text); },
      wait: async () => undefined,
      isHidden: () => false,
    });

    session.onDelta('旧响应。');
    await session.waitForPending();
    session.reset();

    expect(session.streamedText).toBe('');
    expect(session.previewText).toBe('');
    expect(session.eventCount).toBe(0);
    expect(flushed.at(-1)).toBe('');
  });
});
