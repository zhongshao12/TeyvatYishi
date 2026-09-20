import { describe, expect, it } from 'vitest';
import {
  decideChunkReload,
  shouldClearChunkReloadMarker,
} from '@/utils/lazyWithRetry';

describe('lazy chunk retry marker ownership', () => {
  it('only lets the chunk that owns a marker clear it after loading', () => {
    expect(shouldClearChunkReloadMarker('map-panel', 'map-panel')).toBe(true);
    expect(shouldClearChunkReloadMarker('map-panel', 'album-panel')).toBe(false);
    expect(shouldClearChunkReloadMarker(null, 'map-panel')).toBe(false);
  });

  it('allows one reload and prevents a different chunk from starting a reload cascade', () => {
    expect(decideChunkReload(null, 'map-panel')).toBe('reload');
    expect(decideChunkReload('map-panel', 'map-panel')).toBe('fail');
    expect(decideChunkReload('album-panel', 'map-panel')).toBe('fail');
  });
});
