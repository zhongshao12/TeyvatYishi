import { describe, expect, it } from 'vitest';
import { 创建空记忆系统, normalizeMemorySystem, type 记忆系统 } from '@/models/memory';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { applyLegacyGameStateOverrides, createLegacyGameViewSelector, toLegacyMemory, withLegacyMemory } from '@/hooks/useGameState';
import { addImmediateMemory } from '@/hooks/useGame/memoryUtils';
import { migratePartialTeyvatSave } from '@/compat/legacy-hsr/migrate';
import type { WorldMoment, WorldMomentRange } from '@/models/teyvat/worldMoment';
import { readMemorySourceItems, resolveRebuildTurnMoment } from '@/services/memorySources';
import { fingerprintMemoryText } from '@/models/memorySource';

const moment: WorldMoment = { worldName: '提瓦特', date: '旅行历 1000.03.05', clock: '09:30', weather: '晴',
  location: '蒙德城', travelDay: 5, turn: 5, settlementId: 'settlement-5' };
const range: WorldMomentRange = { start: moment, end: moment, sourceIds: ['short-5'] };
type SourceMetadata = { 来源回合?: Record<string, number[]>; 生成文本指纹?: Record<string, string> };
type RuntimeMetadata = { sourceTurnsById?: Record<string, number[]>; generatedTextFingerprints?: Record<string, string> };

describe('memory source save integrity', () => {
  it('reads sparse provenance and verifies unique archive associations without granting duplicate IDs authority', () => {
    const memory = { ...创建空记忆系统(), 短期记忆: ['generated', 'edited', 'duplicate', 'duplicate'],
      短期归档ID: ['s', 'e', 'dup', 'dup'], 来源回合: { s: [5, 3], e: [5] },
      生成文本指纹: { s: fingerprintMemoryText('generated'), e: fingerprintMemoryText('before-edit') }, 来源时刻: { s: range } };
    const items = readMemorySourceItems({ memory, irminsul: { entries: [] } });
    expect(items[0]).toMatchObject({ id: 's', layer: 'short', text: 'generated', sourceTurns: [3, 5], momentRange: range });
    expect(items[1]?.generatedFingerprint).toBe(fingerprintMemoryText('before-edit'));
    expect(items.slice(2).map(item => item.id)).toEqual([null, null]);
  });

  it('resolves only a saved exact single-turn moment, never a cross-turn boundary or current world', () => {
    const message: import('@/models/chat').聊天消息 = { id: 'a5', role: 'assistant', content: '正文', timestamp: 123 };
    const state = { memory: 创建空记忆系统(), irminsul: { entries: [] } };
    expect(resolveRebuildTurnMoment(5, { ...message, worldMoment: moment }, state)).toEqual({ ...range, sourceIds: ['a5'] });
    expect(resolveRebuildTurnMoment(4, { ...message, worldMoment: moment }, state)).toBeNull();
    const memory = { ...state.memory, 短期记忆: ['single'], 短期归档ID: ['s'], 来源回合: { s: [5] }, 来源时刻: { s: range } };
    expect(resolveRebuildTurnMoment(5, message, { ...state, memory })).toEqual(range);
    expect(resolveRebuildTurnMoment(5, message, { ...state, memory: { ...memory, 来源回合: { s: [3, 5] } } })).toBeNull();
  });

  it('does not pick one of conflicting historical moments or resurrect metadata with no active source', () => {
    const message: import('@/models/chat').聊天消息 = { id: 'a5', role: 'assistant', content: '正文', timestamp: 123 };
    const changed = { ...moment, location: '璃月港', settlementId: 'other-5' };
    const memory = { ...创建空记忆系统(), 短期记忆: ['a', 'b'], 短期归档ID: ['a', 'b'], 来源回合: { a: [5], b: [5] },
      来源时刻: { a: range, b: { start: changed, end: changed, sourceIds: ['b'] } } };
    expect(resolveRebuildTurnMoment(5, message, { memory, irminsul: { entries: [] } })).toBeNull();
    expect(resolveRebuildTurnMoment(5, message, { memory: { ...memory, 短期记忆: [], 短期归档ID: [] }, irminsul: { entries: [] } })).toBeNull();
  });

  it('refuses conflicting same-ID world-tree associations as replaceable provenance', () => {
    const memory = { ...创建空记忆系统(), 短期记忆: ['summary'], 短期归档ID: ['s'], 来源回合: { s: [5] } };
    const entry: import('@/models/teyvat/irminsul').IrminsulEntry = {
      id: 's', summary: 'different summary', title: 's', sourceTurns: [5], keywords: [], recordedAt: '',
      archiveType: 'short', sourceText: 'raw', turn: 5,
    };
    expect(readMemorySourceItems({ memory, irminsul: { entries: [entry] } })[0]?.sourceTurns).toEqual([]);
    expect(readMemorySourceItems({ memory, irminsul: { entries: [{ ...entry, summary: 'summary' }, { ...entry, summary: 'summary' }] } })[0]?.sourceTurns).toEqual([]);
  });
  it('roundtrips sparse source turns and world moments through the actual memory adapters', () => {
    const memory = { ...创建空记忆系统(), 短期记忆: ['第三与第五回合摘要'], 短期归档ID: ['short-5'],
      来源回合: { 'short-5': [3, 5] }, 来源时刻: { 'short-5': range }, 生成文本指纹: { 'short-5': 'generated-original' } };
    const root = withLegacyMemory(createEmptyTeyvatGameState(), memory);
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(root)));
    const legacy = toLegacyMemory(restored) as 记忆系统 & SourceMetadata;
    expect(legacy.来源回合).toEqual({ 'short-5': [3, 5] });
    expect(legacy.生成文本指纹).toEqual({ 'short-5': 'generated-original' });
    expect(legacy.来源时刻?.['short-5']).toEqual(range);
  });

  it('retains the first of 2001 active world moment entries across normalization', () => {
    const ids = Array.from({ length: 2001 }, (_, index) => `source-${index}`);
    const root = createEmptyTeyvatGameState();
    root.记忆.immediate = ids.map(id => `原文 ${id}`);
    root.记忆.immediateIds = ids;
    root.记忆.sourceMoments = Object.fromEntries(ids.map(id => [id, range]));
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(root)));
    expect(Object.keys(restored.记忆.sourceMoments ?? {})).toHaveLength(2001);
    expect(restored.记忆.sourceMoments?.['source-0']).toEqual(range);
  });

  it('preserves the generated fingerprint after the player edits the associated text', () => {
    const generated = addImmediateMemory(创建空记忆系统(), '原来正文', 5, moment);
    const id = 'memory_settlement-5_5';
    const fingerprint = (generated as 记忆系统 & SourceMetadata).生成文本指纹?.[id];
    expect(fingerprint).toBeTypeOf('string');
    const edited = normalizeMemorySystem({ ...generated, 即时记忆: ['玩家校正正文'] });
    const saved = withLegacyMemory(createEmptyTeyvatGameState(), edited);
    const restored = toLegacyMemory(normalizeTeyvatGameState(JSON.parse(JSON.stringify(saved)))) as 记忆系统 & SourceMetadata;
    expect(restored.即时记忆).toEqual(['玩家校正正文']);
    expect(restored.生成文本指纹?.[id]).toBe(fingerprint);
    expect(restored.来源回合?.[id]).toEqual([5]);
  });

  it('records a content-dependent generation fingerprint instead of assigning one constant to all texts', () => {
    const hello = addImmediateMemory(创建空记忆系统(), 'hello', 5, moment) as 记忆系统 & SourceMetadata;
    const other = addImmediateMemory(创建空记忆系统(), 'world', 5, moment) as 记忆系统 & SourceMetadata;
    expect(hello.生成文本指纹?.['memory_settlement-5_5']).toBe('fnv1a:5:4f9f2cab');
    expect(other.生成文本指纹?.['memory_settlement-5_5']).not.toBe('fnv1a:5:4f9f2cab');
  });

  it('does not grant provenance to malformed IDs or invented numeric source turns', () => {
    const raw = { ...创建空记忆系统(), 来源回合: { '': [5], ' ': [2], valid: [5, 3, 5, -1, 1.5, '7', null, Infinity] },
      生成文本指纹: { '': 'x', valid: 'original', bad: 22 } };
    const normalized = normalizeMemorySystem(raw as unknown as 记忆系统) as 记忆系统 & SourceMetadata;
    expect(normalized.来源回合).toEqual({ valid: [3, 5] });
    expect(normalized.生成文本指纹).toEqual({ valid: 'original' });
  });

  it('leaves legacy memories without source information unknown', () => {
    const restored = toLegacyMemory(normalizeTeyvatGameState(withLegacyMemory(createEmptyTeyvatGameState(), {
      ...创建空记忆系统(), 即时记忆: ['旧档原文'],
    }))) as 记忆系统 & SourceMetadata;
    expect(restored.来源回合).toBeUndefined();
    expect(restored.来源时刻).toBeUndefined();
    expect(restored.生成文本指纹).toBeUndefined();
  });

  it('retains committed chat moments through both conversation projections', () => {
    const root = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), { chatHistory: [{ id: 'a5', role: 'assistant',
      content: '正文', timestamp: 123, gameTime: '5', worldMoment: moment } as import('@/models/chat').聊天消息] });
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(root)));
    const chat = createLegacyGameViewSelector()(restored).chatHistory;
    expect(chat[0]).toMatchObject({ id: 'a5', worldMoment: moment });
  });

  it('preserves source metadata when migrating a partial Teyvat legacy-format save', () => {
    const result = migratePartialTeyvatSave({ universe: 'partial-teyvat', 旅人: { 主元素: 'anemo' }, 背包: [],
      记忆: { ...创建空记忆系统(), 短期记忆: ['第三与第五回合摘要'], 短期归档ID: ['short-5'], 来源回合: { 'short-5': [3, 5] },
        来源时刻: { 'short-5': range }, 生成文本指纹: { 'short-5': 'generated-original' } } }, {});
    expect(result.status).toBe('migrated');
    if (result.status !== 'migrated') throw new Error('fixture must be migratable');
    expect((result.state.记忆 as typeof result.state.记忆 & RuntimeMetadata).sourceTurnsById).toEqual({ 'short-5': [3, 5] });
    expect(result.state.记忆.shortArchiveIds).toEqual(['short-5']);
    expect(result.state.记忆.sourceMoments?.['short-5']).toEqual(range);
  });
});
