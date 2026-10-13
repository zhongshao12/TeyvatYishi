import { describe, expect, it } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { createMoment } from '@/services/courierMoments';
import { removeCourierContact } from '@/services/ai/courierService';
import { runMomentComments } from '@/hooks/useGame/courierMomentWorkflow';
import type { API配置项 } from '@/models/settings';

const config: API配置项 = { id: 'fake', name: 'fake', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'fake', createdAt: 1, updatedAt: 1 };

function fixture() {
  let live = createMoment({ ...createEmptyCourierSystem(), contacts: [{ id: 'contact_guide', npcId: 'guide', name: '向导', available: true }] },
    { id: 'post', content: '@向导 出发吧', mentionIds: ['guide'], turn: 1, now: 1 });
  let npcs = [{ ...创建NPC记录({ 姓名: '向导', 初见回合: 1 }), id: 'guide', 好感度: 20 }];
  let session = 1;
  let resolve!: (value: string) => void; let reject!: (error: Error) => void;
  const response = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return {
    get live() { return live; }, set live(value) { live = value; },
    get npcs() { return npcs; }, set npcs(value) { npcs = value; },
    get session() { return session; }, set session(value) { session = value; },
    resolve, reject,
    run: () => runMomentComments({ getSessionId: () => session, getCourier: () => live,
      setCourier: update => { live = update(live); }, getNpcs: () => npcs, getApiConfig: () => config,
      generateComment: () => response }, 'post', 1),
  };
}

describe('moment comment eligibility at final commit', () => {
  it.each(['model', 'local'] as const)('does not comment after contact deletion on the %s path', async (path) => {
    const state = fixture(); const job = state.run();
    state.live = removeCourierContact(state.live, 'contact_guide');
    if (path === 'model') state.resolve('收到。'); else state.reject(new Error('MODEL_FAILED'));
    await job;
    expect(state.live.moments?.[0]?.comments).toEqual([]);
    expect(state.live.moments?.[0]?.targets[0]?.status).toBe('failed');
  });

  it.each(['model', 'local'] as const)('does not comment after explicit lock on the %s path', async (path) => {
    const state = fixture(); const job = state.run();
    state.live = { ...state.live, contacts: state.live.contacts.map(contact => ({ ...contact, status: 'story_locked' })) };
    if (path === 'model') state.resolve('收到。'); else state.reject(new Error('MODEL_FAILED'));
    await job;
    expect(state.live.moments?.[0]?.comments).toEqual([]);
  });

  it('uses the latest NPC identity for a legitimate local fallback', async () => {
    const state = fixture(); const job = state.run();
    state.npcs = [{ ...state.npcs[0]!, 姓名: '新向导姓名' }];
    state.reject(new Error('MODEL_FAILED')); await job;
    expect(state.live.moments?.[0]?.comments[0]).toMatchObject({ npcId: 'guide', npcName: '新向导姓名', source: 'local' });
  });

  it('keeps a legitimate low-affinity mentioned fallback and rejects it after a save switch', async () => {
    const state = fixture(); const job = state.run();
    state.reject(new Error('MODEL_FAILED')); await job;
    expect(state.live.moments?.[0]?.comments).toHaveLength(1);
    const switched = fixture(); const oldJob = switched.run(); switched.session = 2;
    switched.reject(new Error('MODEL_FAILED')); await oldJob;
    expect(switched.live.moments?.[0]?.comments).toHaveLength(0);
  });
});
