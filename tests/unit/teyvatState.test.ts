import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat';

describe('teyvat runtime state', () => {
  it('creates the only writable universe state', () => {
    const state = createEmptyTeyvatGameState();
    expect(state.universe).toBe('teyvat');
    expect(state.schemaVersion).toBe(2);
    expect(state).toHaveProperty('手机');
    expect(state).not.toHaveProperty('信使');
    expect(state).not.toHaveProperty('忆庭');
  });

  it('rejects a non-teyvat runtime state', () => {
    expect(() => normalizeTeyvatGameState({ universe: 'hsr' })).toThrow('UNSUPPORTED_RUNTIME_UNIVERSE');
  });
});
