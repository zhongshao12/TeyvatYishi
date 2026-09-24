import { describe, expect, it } from 'vitest';
import type { NPC记录 } from '@/models/npc';
import { mergeNpcWriteBack } from '@/utils/npcWriteBack';

/**
 * 对抗审查 2026-09-20 第 4 条：手机回信的 NPC 写回曾整片替换，
 * 会把飞行期间结算（或玩家）对 NPC 的写入静默回退。
 * 这里先留反例证据（整片写回确实会丢），再断言现在的合并行为。
 */

function npc(id: string, overrides: Partial<NPC记录> = {}): NPC记录 {
  return {
    id,
    姓名: id,
    好感度: 0,
    关系: '陌生',
    当前关系阶段: '陌生',
    最近回合: 1,
    最近互动: '',
    同行记忆: [],
    ...overrides,
  } as unknown as NPC记录;
}

describe('mergeNpcWriteBack', () => {
  it('never appends NPCs from an old phone reply after the player switched saves', () => {
    const current = [npc('new-save-lisa', { 好感度: 30 })];
    const result = mergeNpcWriteBack({
      start: [npc('old-save-amber')],
      next: [npc('old-save-amber', { 好感度: 2 })],
      current,
      expectedSessionId: 1,
      currentSessionId: 2,
    });
    expect(result.records).toEqual(current);
    expect(result.concurrentNpcIds).toEqual([]);
  });

  it('keeps the phone affinity delta when a settlement updates the same NPC concurrently', () => {
    const start = [npc('amber', { 好感度: 10 })];
    const phoneMemory = { id: 'phone_exchange_1', 好感变动: 2 } as never;
    const produced = [npc('amber', { 好感度: 12, 同行记忆: [phoneMemory] })];
    const live = [npc('amber', { 好感度: 25 })];

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });
    expect(merged.records[0]!.好感度).toBe(27);
    expect(merged.records[0]!.同行记忆?.map((item) => item.id)).toEqual(['phone_exchange_1']);
  });

  it('documents what a whole-slice write-back did to a concurrent settlement write', () => {
    const start = [npc('amber', { 好感度: 10 })];
    // 回信作业产出的记录（它只加了同行记忆）
    const produced = [npc('amber', { 好感度: 10, 同行记忆: [{ id: 'phone_1' }] as never })];
    // 等待期间结算把好感度写到 25（活体）
    const live = [npc('amber', { 好感度: 25 })];

    // 反例：整片写回（修复前的 App.tsx:244）把结算的 25 顶回 10
    expect((produced as NPC记录[])[0]!.好感度).toBe(10);
    expect(live[0]!.好感度).toBe(25);

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });

    expect(merged.records[0]!.好感度).toBe(25);
    expect(merged.records[0]!.同行记忆?.map((memory) => memory.id)).toEqual(['phone_1']);
    expect(merged.concurrentNpcIds).toEqual(['amber']);
  });

  it('takes the job result when nobody else touched the record', () => {
    const start = [npc('amber')];
    const produced = [npc('amber', { 好感度: 2, 最近互动: '通过手机与旅行者交谈' })];
    const live = start;

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });

    expect(merged.records[0]!.好感度).toBe(2);
    expect(merged.records[0]!.最近互动).toBe('通过手机与旅行者交谈');
    expect(merged.concurrentNpcIds).toEqual([]);
  });

  it('keeps the live record when the job did not change it', () => {
    const start = [npc('amber')];
    // 作业原样带回（引用不变）
    const live = [npc('amber', { 好感度: 42 })];

    const merged = mergeNpcWriteBack({ start, next: start, current: live });

    expect(merged.records[0]!.好感度).toBe(42);
    expect(merged.concurrentNpcIds).toEqual([]);
  });

  it('appends records the job created and keeps records only the live root has', () => {
    const start: NPC记录[] = [];
    const produced = [npc('lisa')];
    const live = [npc('kaeya', { 好感度: 7 })];

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });

    expect(merged.records.map((record) => record.id)).toEqual(['kaeya', 'lisa']);
    expect(merged.records[0]!.好感度).toBe(7);
  });

  it('does not duplicate a memory line both sides already have', () => {
    const memory = { id: 'phone_1' } as never;
    const start = [npc('amber', { 同行记忆: [memory] })];
    const produced = [npc('amber', { 好感度: 2, 同行记忆: [memory] })];
    const live = [npc('amber', { 好感度: 25, 同行记忆: [memory] })];

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });

    expect(merged.records[0]!.同行记忆?.map((item) => item.id)).toEqual(['phone_1']);
    expect(merged.records[0]!.好感度).toBe(25);
  });

  it('does not resurrect a memory removed from the live record while the reply was in flight', () => {
    const oldMemory = { id: 'old_phone', 好感变动: 2 } as never;
    const newMemory = { id: 'new_phone', 好感变动: 1 } as never;
    const start = [npc('amber', { 好感度: 10, 同行记忆: [oldMemory] })];
    const produced = [npc('amber', { 好感度: 11, 同行记忆: [oldMemory, newMemory] })];
    const live = [npc('amber', { 好感度: 20, 同行记忆: [] })];

    const merged = mergeNpcWriteBack({ start, next: produced, current: live });

    expect(merged.records[0]!.同行记忆?.map((item) => item.id)).toEqual(['new_phone']);
    expect(merged.records[0]!.好感度).toBe(21);
  });
});
