import type { TeyvatGameState } from '@/models/teyvat';

export type SaveSource = 'manual' | 'auto' | 'loaded';
export type SavePhase = 'unsaved' | 'saving' | 'saved' | 'failed';

export interface SaveStatusSnapshot {
  sessionId: number;
  phase: SavePhase;
  source: SaveSource | null;
  savedAt: number | null;
  hadFailure: boolean;
}

interface SaveToken {
  sessionId: number;
  sequence: number;
  source: Exclude<SaveSource, 'loaded'>;
  signature: readonly unknown[];
}

/** Compare persisted gameplay slices by identity, omitting the feedback-only background queue. */
function gameSignature(game: TeyvatGameState): readonly unknown[] {
  return [
    game.turnCount, game.旅行者, game.世界, game.NPC, game.背包, game.手机,
    game.世界树, game.图鉴, game.蒸汽鸟报, game.原著轨道, game.对话,
    game.记忆, game.相册, game.任务, game.叙事, game.地图,
  ];
}

function sameSignature(left: readonly unknown[] | null, right: readonly unknown[]): boolean {
  return left !== null && left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createSaveStatusStore() {
  let snapshot: SaveStatusSnapshot = { sessionId: 0, phase: 'unsaved', source: null, savedAt: null, hadFailure: false };
  let savedSignature: readonly unknown[] | null = null;
  let sequence = 0;
  let latestSequence = 0;
  const listeners = new Set<() => void>();

  const publish = (next: SaveStatusSnapshot) => {
    if (Object.entries(next).every(([key, value]) => snapshot[key as keyof SaveStatusSnapshot] === value)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const ensureSession = (sessionId: number) => {
    if (snapshot.sessionId === sessionId) return;
    savedSignature = null;
    latestSequence = ++sequence;
    publish({ sessionId, phase: 'unsaved', source: null, savedAt: null, hadFailure: false });
  };
  const tokenIsCurrent = (token: SaveToken) => token.sessionId === snapshot.sessionId && token.sequence === latestSequence;

  const store = {
    getSnapshot: (): SaveStatusSnapshot => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    observeGame: (sessionId: number, game: TeyvatGameState) => {
      ensureSession(sessionId);
      const current = gameSignature(game);
      if (snapshot.phase !== 'saved') return;
      if (savedSignature === null) {
        savedSignature = current;
      } else if (!sameSignature(savedSignature, current)) {
        publish({ ...snapshot, phase: 'unsaved' });
      }
    },
    markLoaded: (sessionId: number, savedAt: number | null) => {
      ensureSession(sessionId);
      latestSequence = ++sequence;
      savedSignature = null; // Adopt the normalized game on its first committed render.
      publish({ sessionId, phase: 'saved', source: 'loaded', savedAt, hadFailure: false });
    },
    begin: (sessionId: number, game: TeyvatGameState, source: SaveToken['source']): SaveToken => {
      store.observeGame(sessionId, game);
      const token = { sessionId, sequence: ++sequence, source, signature: gameSignature(game) };
      latestSequence = token.sequence;
      publish({ ...snapshot, phase: 'saving', source, hadFailure: snapshot.hadFailure });
      return token;
    },
    succeed: (token: SaveToken, currentGame: TeyvatGameState, savedAt = Date.now()) => {
      if (!tokenIsCurrent(token)) return;
      savedSignature = token.signature;
      publish({
        sessionId: token.sessionId,
        phase: sameSignature(savedSignature, gameSignature(currentGame)) ? 'saved' : 'unsaved',
        source: token.source,
        savedAt,
        hadFailure: false,
      });
    },
    fail: (token: SaveToken) => {
      if (!tokenIsCurrent(token)) return;
      publish({ ...snapshot, phase: 'failed', source: token.source, hadFailure: true });
    },
    cancel: (token: SaveToken) => {
      if (!tokenIsCurrent(token)) return;
      publish({ ...snapshot, phase: snapshot.hadFailure ? 'failed' : 'unsaved' });
    },
  };
  return store;
}

export const saveStatusStore = createSaveStatusStore();

export async function runTrackedSave<T>(
  store: ReturnType<typeof createSaveStatusStore>,
  sessionId: number,
  gameAtStart: TeyvatGameState,
  source: 'manual' | 'auto',
  work: () => Promise<T>,
  getCurrentGame: () => TeyvatGameState,
  isSaved: (result: T) => boolean = () => true,
): Promise<T> {
  const token = store.begin(sessionId, gameAtStart, source);
  try {
    const result = await work();
    if (isSaved(result)) store.succeed(token, getCurrentGame());
    else store.cancel(token);
    return result;
  } catch (error) {
    store.fail(token);
    throw error;
  }
}
