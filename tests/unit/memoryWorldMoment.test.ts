import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建空记忆系统, normalizeMemorySystem } from '@/models/memory';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { normalizeIrminsulMemory, createEmptyIrminsulMemory } from '@/models/teyvat/irminsul';
import { captureWorldMoment } from '@/services/worldMoment';
import { applyLegacyGameStateOverrides } from '@/hooks/useGameState';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { addImmediateMemory, compressToShortTerm, compressToMiddleTerm, compressToLongTerm } from '@/hooks/useGame/memoryUtils';
import { settlePostNarrativeMemory } from '@/hooks/useGame/postNarrativeMemoryStage';
import { runPostTurnIrminsulArchiveTask } from '@/hooks/useGame/postTurnIrminsulTask';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';

const model = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock('@/services/memoryCompression', () => ({ summarizeMemoryBatch: model.summarize }));

function moment(turn: number, clock: string) {
  const world = createEmptyTeyvatWorld();
  world.当前日期 = `旅行历 1000.03.0${turn}`;
  world.当前时间 = clock;
  world.当前天气 = turn === 1 ? '晴' : '雨';
  world.当前地点 = turn === 1 ? '蒙德城' : '风起地';
  world.旅程天数 = turn;
  return captureWorldMoment(world, turn, `turn-${turn}`);
}

describe('memory world-moment provenance', () => {
  beforeEach(() => model.summarize.mockReset());

  it('keeps immediate IDs aligned when the oldest memory is trimmed', () => {
    let memory = 创建空记忆系统();
    for (let turn = 1; turn <= 51; turn += 1) {
      memory = addImmediateMemory(memory, `回合 ${turn}`, turn, moment(1, '10:00'));
    }
    expect(memory.即时记忆).toHaveLength(50);
    expect(memory.即时记忆[0]).toBe('回合 2');
    expect(memory.即时记忆ID).toHaveLength(50);
    expect(memory.即时记忆ID?.[0]).toBe('memory_turn-1_2');
    expect(memory.来源时刻?.[memory.即时记忆ID?.[0] ?? '']?.start?.clock).toBe('10:00');
    expect(Object.keys(memory.来源时刻 ?? {})).toHaveLength(50);
  });

  it('carries first-to-last source moments into a compressed archive', async () => {
    model.summarize.mockResolvedValue({ summary: '两回合旅程摘要', usedFallback: false, usedModel: true, usedLocal: false });
    const first = addImmediateMemory(创建空记忆系统(), '抵达蒙德', 1, moment(1, '10:00'));
    const result = await settlePostNarrativeMemory({
      memory: first, irminsul: createEmptyIrminsulMemory(), userInput: '去风起地',
      narrativeSummary: '抵达风起地', body: '众人在风起地停下。', turn: 2,
      moment: moment(2, '18:00'),
      settings: { ...创建默认记忆系统设置(), 即时转短期阈值: 2, 短期转中期阈值: 9, 中期转长期阈值: 9 },
      mainConfig: {} as API配置项,
    });
    const archive = result.irminsul.entries[0];
    expect(archive?.sourceMomentRange?.start).toMatchObject({ date: '旅行历 1000.03.01', clock: '10:00', weather: '晴', location: '蒙德城' });
    expect(archive?.sourceMomentRange?.end).toMatchObject({ date: '旅行历 1000.03.02', clock: '18:00', weather: '雨', location: '风起地' });
    expect(archive?.sourceMomentRange?.sourceIds).toHaveLength(2);
    expect(result.memory.来源时刻?.[archive!.id]).toEqual(archive?.sourceMomentRange);
  });

  it('retains the original event moment through short, medium and long promotion', async () => {
    model.summarize.mockResolvedValue({ summary: '玩家输入：见安柏\n剧情回应：本回合小结：抵达蒙德\n\n安柏在城门迎接。',
      usedFallback: false, usedModel: true, usedLocal: false });
    const sourceMoment = moment(1, '10:00');
    const input = {
      memory: 创建空记忆系统(), irminsul: createEmptyIrminsulMemory(),
      userInput: '见安柏', narrativeSummary: '抵达蒙德', body: '安柏在城门迎接。', turn: 1,
      moment: sourceMoment,
      settings: { ...创建默认记忆系统设置(), 即时转短期阈值: 1, 短期转中期阈值: 1, 中期转长期阈值: 1 },
      mainConfig: {} as API配置项,
    };
    const first = await settlePostNarrativeMemory(input);
    expect(first.irminsul.entries).toHaveLength(1);
    expect(first.irminsul.entries[0]?.archiveType).toBe('long');
    expect(first.irminsul.entries[0]?.sourceMomentRange).toEqual({
      start: sourceMoment, end: sourceMoment, sourceIds: ['memory_turn-1_1'],
    });
    const replay = await settlePostNarrativeMemory({ ...input, memory: first.memory, irminsul: first.irminsul });
    expect(replay.irminsul.entries).toHaveLength(1);
    expect(replay.irminsul.entries[0]?.sourceMomentRange).toEqual(first.irminsul.entries[0]?.sourceMomentRange);
    expect(replay.memory).toEqual(first.memory);
  });

  it.each(['short', 'middle', 'long'] as const)('does not restore a settled event already covered by %s memory', (layer) => {
    const sourceMoment = moment(1, '10:00');
    const source = addImmediateMemory(创建空记忆系统(), '遇见安柏', 1, sourceMoment);
    const short = compressToShortTerm(source, 1, 1);
    const middle = layer === 'short' ? short : compressToMiddleTerm(short, 1, 1);
    const archived = layer === 'long' ? compressToLongTerm(middle, 1, 1) : middle;
    const recovered = addImmediateMemory(archived, '遇见安柏', 1, sourceMoment);
    expect(recovered).toBe(archived);
    expect(recovered.即时记忆).toEqual([]);
    const next = addImmediateMemory(recovered, '第二次遇见安柏', 2, moment(2, '18:00'));
    expect(next.即时记忆).toEqual(['第二次遇见安柏']);
  });

  it('leaves old records without provenance unknown', () => {
    const memory = normalizeMemorySystem({ 即时记忆: ['旧对话'], 短期记忆: ['旧摘要'] });
    const archive = normalizeIrminsulMemory({ entries: [{
      id: 'legacy', title: '旧档', summary: '旧摘要', sourceTurns: [1], keywords: [],
      recordedAt: '旧日期', archiveType: 'short', sourceText: '旧文本', turn: 1,
    }] }).entries[0];
    expect(memory.即时记忆ID).toBeUndefined();
    expect(memory.来源时刻).toBeUndefined();
    expect(archive?.sourceMomentRange).toBeUndefined();
  });

  it('retains provenance across the legacy memory adapter and save normalization', () => {
    const sourceMoment = moment(1, '10:00');
    const memory = addImmediateMemory(创建空记忆系统(), '抵达蒙德', 1, sourceMoment);
    const game = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), { 记忆: memory });
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(game)));
    expect(restored.记忆.immediateIds).toEqual(['memory_turn-1_1']);
    expect(restored.记忆.sourceMoments?.['memory_turn-1_1']?.start).toEqual(sourceMoment);
  });

  it('archives the turn summary with its committed moment', () => {
    const sourceMoment = moment(2, '18:00');
    const result = runPostTurnIrminsulArchiveTask({
      base: createEmptyIrminsulMemory(), committedGame: createEmptyTeyvatGameState(),
      turn: 2, summary: '抵达风起地', body: '众人抵达风起地。',
      worldEvents: [], questFactCandidates: [], recallEnabled: false,
      recallEligible: false, earliestRecallTurn: 10, recallHitCount: 0, recallUsedModel: false,
      moment: sourceMoment,
    });
    expect(result.memory.entries[0]?.sourceMomentRange).toEqual({
      start: sourceMoment, end: sourceMoment, sourceIds: ['turn-2'],
    });
  });

  it('preserves provenance when the player manually compresses each layer', () => {
    const sourceMoment = moment(1, '10:00');
    const immediate = addImmediateMemory(创建空记忆系统(), '遇见安柏', 1, sourceMoment);
    const short = compressToShortTerm(immediate, 1, 1);
    const middle = compressToMiddleTerm(short, 1, 1);
    const long = compressToLongTerm(middle, 1, 1);
    const id = long.长期归档ID?.[0];
    expect(id).toBeTruthy();
    expect(long.即时记忆ID).toEqual([]);
    expect(long.来源时刻?.[id!]).toEqual({
      start: sourceMoment, end: sourceMoment, sourceIds: ['memory_turn-1_1'],
    });
  });
});
