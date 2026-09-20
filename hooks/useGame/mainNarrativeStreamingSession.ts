export interface MainNarrativeStreamingSessionOptions {
  enabled: boolean;
  signal: AbortSignal;
  set: (text: string) => void;
  flush: (text: string) => void;
  wait: (delayMs: number) => Promise<void>;
  isHidden: () => boolean;
  bufferWhenHidden?: (text: string) => boolean;
  revealDelayMs?: number;
}

export interface MainNarrativeStreamingSession {
  readonly streamedText: string;
  readonly previewText: string;
  readonly eventCount: number;
  onDelta: (delta: string) => void;
  reset: () => void;
  acceptBufferedText: (text: string) => void;
  waitForPending: () => Promise<void>;
}

export function createMainNarrativeStreamingSession(
  options: MainNarrativeStreamingSessionOptions,
): MainNarrativeStreamingSession {
  let streamedText = '';
  let previewText = '';
  let eventCount = 0;
  let previewEpoch = 0;
  let previewChain: Promise<void> = Promise.resolve();

  const reset = () => {
    streamedText = '';
    previewText = '';
    eventCount = 0;
    previewEpoch += 1;
    previewChain = Promise.resolve();
    options.flush('');
  };

  const onDelta = (delta: string) => {
    streamedText += delta;
    if (!options.enabled) {
      options.set(streamedText);
      return;
    }
    if (options.bufferWhenHidden?.(streamedText)) {
      previewEpoch += 1;
      previewText = streamedText;
      return;
    }
    eventCount += 1;
    const deltaPreviewEpoch = previewEpoch;
    previewChain = previewChain.then(async () => {
      const chunks = splitStreamingReveal(delta);
      for (const chunk of chunks) {
        if (options.signal.aborted || deltaPreviewEpoch !== previewEpoch) return;
        if (options.isHidden()) {
          previewEpoch += 1;
          previewText = streamedText;
          options.bufferWhenHidden?.(streamedText);
          return;
        }
        previewText += chunk;
        options.set(previewText);
        await options.wait(options.revealDelayMs ?? 14);
        if (options.isHidden()) {
          previewEpoch += 1;
          previewText = streamedText;
          options.bufferWhenHidden?.(streamedText);
          return;
        }
      }
    });
  };

  return {
    get streamedText() { return streamedText; },
    get previewText() { return previewText; },
    get eventCount() { return eventCount; },
    onDelta,
    reset,
    acceptBufferedText: (text) => {
      previewEpoch += 1;
      previewText = text;
      options.flush(text);
    },
    waitForPending: () => previewChain,
  };
}

export function splitStreamingReveal(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sentenceChunks = trimmed.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)?.filter(Boolean) ?? [];
  if (sentenceChunks.length > 1) return sentenceChunks;
  const chars = Array.from(trimmed);
  if (chars.length <= 16) return [trimmed];
  const chunkSize = Math.max(4, Math.ceil(chars.length / 10));
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(''));
  }
  return chunks;
}
