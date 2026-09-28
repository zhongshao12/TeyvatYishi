import { expect, it, vi } from 'vitest';
import { 创建NPC记录, type NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import { appendMomentComment, createMoment, deleteMoment, editMoment, markMomentTarget } from '@/services/courierMoments';
import { runMomentComments, type MomentWorkflowDeps } from '@/hooks/useGame/courierMomentWorkflow';

const config: API配置项 = {
  id: 'phone', name: 'phone', provider: 'openai_compatible', baseUrl: 'https://invalid.example',
  apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};

function friend(id: string, name: string, affinity = 101): NPC记录 {
  return { ...创建NPC记录({ 姓名: name, 初见回合: 1 }), id, 好感度: affinity };
}

function harness(npcs: NPC记录[], generateComment: MomentWorkflowDeps['generateComment']) {
  let session = 1;
  let records = npcs;
  let courier: CourierSystem = createMoment({
    ...createEmptyCourierSystem(),
    contacts: npcs.map((npc) => ({ id: `${npc.id}-contact`, npcId: npc.id, name: npc.姓名, available: true })),
  }, { id: 'p1', content: '今天的风很温柔', turn: 2, now: 1 });
  const deps: MomentWorkflowDeps = {
    getSessionId: () => session,
    getCourier: () => courier,
    setCourier: (update) => { courier = update(courier); },
    getNpcs: () => records,
    getApiConfig: () => config,
    generateComment,
  };
  return {
    deps,
    read: () => courier,
    setSession: (value: number) => { session = value; },
    setRecords: (value: NPC记录[]) => { records = value; },
    edit: () => { courier = editMoment(courier, 'p1', '新动态', 2); },
    remove: () => { courier = deleteMoment(courier, 'p1'); },
    target: (npcId: string, status: 'failed' | 'done' | 'generating') => {
      courier = markMomentTarget(courier, 'p1', 1, npcId, status);
    },
  };
}

it('retries only one failed target when two characters failed', async () => {
  const generator = vi.fn(async (_config: API配置项, input: Parameters<MomentWorkflowDeps['generateComment']>[1]) => `${input.npc.姓名}已读`);
  const job = harness([friend('amber', '安柏'), friend('lisa', '丽莎')], generator);
  job.target('amber', 'failed');
  job.target('lisa', 'failed');
  await runMomentComments(job.deps, 'p1', 1, 'amber');
  expect(job.read().moments?.[0]?.comments.map((comment) => comment.npcId)).toEqual(['amber']);
  expect(job.read().moments?.[0]?.targets).toEqual([
    { npcId: 'amber', status: 'done' }, { npcId: 'lisa', status: 'failed' },
  ]);
  expect(generator).toHaveBeenCalledTimes(1);
});

it.each([['absent', 'missing'], ['done', 'amber'], ['generating', 'amber']] as const)(
  'does not dispatch a targeted retry when target is %s', async (status, npcId) => {
    const generator = vi.fn(async () => '不应生成');
    const job = harness([friend('amber', '安柏')], generator);
    if (status !== 'absent') job.target('amber', status);
    await runMomentComments(job.deps, 'p1', 1, npcId);
    expect(job.read().moments?.[0]?.comments).toEqual([]);
    expect(generator).not.toHaveBeenCalled();
  },
);

it('keeps a targeted comment failed when the API is unconfigured', async () => {
  const generator = vi.fn(async () => '不应生成');
  const job = harness([friend('amber', '安柏')], generator);
  job.target('amber', 'failed');
  job.deps.getApiConfig = () => null;
  await runMomentComments(job.deps, 'p1', 1, 'amber');
  expect(job.read().moments?.[0]?.targets).toEqual([{ npcId: 'amber', status: 'failed' }]);
  expect(job.read().moments?.[0]?.comments).toEqual([]);
  expect(generator).not.toHaveBeenCalled();
});

it('does not start two API calls when a second retry arrives before React commits generating state', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const generator = vi.fn(() => pending);
  const job = harness([friend('amber', '安柏')], generator);
  job.target('amber', 'failed');
  const deferredUpdates: Array<Parameters<MomentWorkflowDeps['setCourier']>[0]> = [];
  job.deps.setCourier = (update) => { deferredUpdates.push(update); };
  const first = runMomentComments(job.deps, 'p1', 1, 'amber');
  const second = runMomentComments(job.deps, 'p1', 1, 'amber');
  expect(generator).toHaveBeenCalledTimes(1);
  expect(deferredUpdates).toHaveLength(1);
  resolve('记下啦');
  await Promise.all([first, second]);
});

it.each(['edit', 'remove'] as const)('drops a targeted retry after %s', async (change) => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏')], vi.fn(() => pending));
  job.target('amber', 'failed');
  const run = runMomentComments(job.deps, 'p1', 1, 'amber');
  job[change]();
  resolve('旧评论');
  await run;
  expect(job.read().moments?.[0]?.comments ?? []).toEqual([]);
});

it('drops a targeted retry after switching game sessions', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏')], vi.fn(() => pending));
  job.target('amber', 'failed');
  const run = runMomentComments(job.deps, 'p1', 1, 'amber');
  job.setSession(2);
  resolve('旧存档评论');
  await run;
  expect(job.read().moments?.[0]?.comments).toEqual([]);
});

it('drops an old model result after switching game sessions', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏')], vi.fn(() => pending));
  const run = runMomentComments(job.deps, 'p1', 1);
  job.setSession(2);
  resolve('下次叫上我！');
  await run;
  expect(job.read().moments?.[0]?.comments).toEqual([]);
});

it.each(['edit', 'remove'] as const)('drops an old result after %s', async (change) => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏')], vi.fn(() => pending));
  const run = runMomentComments(job.deps, 'p1', 1);
  job[change]();
  resolve('下次叫上我！');
  await run;
  expect(job.read().moments?.[0]?.comments ?? []).toEqual([]);
});

it('stale_revision_cannot_append_comment_or_erase_another_comment', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏'), friend('lisa', '丽莎')], vi.fn(() => pending));
  job.target('amber', 'failed');
  const run = runMomentComments(job.deps, 'p1', 1, 'amber');
  job.edit();
  job.deps.setCourier((old) => appendMomentComment(old, 'p1', 2, {
    id: 'p1:2:lisa', npcId: 'lisa', npcName: '丽莎', content: '新动态真有趣！', createdAt: 3,
  }));
  resolve('安柏的旧版评论！');
  await run;
  expect(job.read().moments?.[0]?.revision).toBe(2);
  expect(job.read().moments?.[0]?.comments.map((comment) => comment.npcId)).toEqual(['lisa']);
  expect(job.read().moments?.[0]?.targets).toEqual([]);
});

it('discards a result when the commenter falls back to 100 affinity', async () => {
  let resolve!: (text: string) => void;
  const pending = new Promise<string>((done) => { resolve = done; });
  const job = harness([friend('amber', '安柏')], vi.fn(() => pending));
  const run = runMomentComments(job.deps, 'p1', 1);
  job.setRecords([friend('amber', '安柏', 100)]);
  resolve('下次叫上我！');
  await run;
  expect(job.read().moments?.[0]?.comments).toEqual([]);
  expect(job.read().moments?.[0]?.targets).toEqual([{ npcId: 'amber', status: 'failed' }]);
});

it('lets at most three eligible NPCs comment independently', async () => {
  const generator = vi.fn(async (_config: API配置项, input: Parameters<MomentWorkflowDeps['generateComment']>[1]) => `${input.npc.姓名}来啦`);
  const job = harness([friend('amber', '安柏'), friend('lisa', '丽莎'), friend('jean', '琴'), friend('noelle', '诺艾尔')], generator);
  await runMomentComments(job.deps, 'p1', 1);
  expect(job.read().moments?.[0]?.comments).toHaveLength(3);
  expect(new Set(job.read().moments?.[0]?.comments.map((item) => item.npcId)).size).toBe(3);
  expect(generator).toHaveBeenCalledTimes(3);
});

it('leaves a failed model comment retryable without a template fallback', async () => {
  const generator = vi.fn().mockRejectedValueOnce(new Error('API_OFFLINE')).mockResolvedValueOnce('路上小心！');
  const job = harness([friend('amber', '安柏')], generator);
  await runMomentComments(job.deps, 'p1', 1);
  expect(job.read().moments?.[0]?.comments).toEqual([]);
  expect(job.read().moments?.[0]?.targets).toEqual([{ npcId: 'amber', status: 'failed' }]);
  await runMomentComments(job.deps, 'p1', 1);
  expect(job.read().moments?.[0]?.comments).toHaveLength(1);
  expect(generator).toHaveBeenCalledTimes(2);
});
