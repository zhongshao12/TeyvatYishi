import { expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreStoryResources } from '@/core/content/storyCatalog';
import { attachCoreStoryResources } from '@/core/content/storyContext';
import { createCoreController } from '@/core/settlement/coreController';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { makeSeed } from './fixtures';

export function assertStoryContentContract(factory: () => Promise<CoreRepository>): void {
  it('preserves explicit story field edits across resource refresh, save forks and package transfer without making goals into facts', async () => {
    const repo = await factory(), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
    const original = { id: 'story-test', 标题: '蒙德主线', 分段列表: [{ id: 'chapter-test', 标题: '序章', 本段概括: '发现风的秘密', 场景节点: [{ id: 'node-test', 标题: '相遇', 目标: '结识侦察骑士', 地点: '低语森林', 完成证据: ['明确自我介绍'] }] }] };
    const controllerFor = (resource = original) => { const stories = createCoreStoryResources([resource.id], async () => structuredClone(resource)); return createCoreController({ repo, storyResources: stories, turnDependencies: () => attachCoreStoryResources({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => '', factModel: async () => ({ kind: 'extracted', attempts: 0, candidates: [] }) }, stories) }); };
    let controller = controllerFor();
    try {
      await controller.initialize(seed); await controller.readStoryCatalog();
      const story = controller.getView().snapshot!.records.find(row => row.domain === 'story')!;
      const edit = { type: 'story_content' as const, action: 'set' as const, seriesId: 'story-test', nodeId: 'node-test', field: 'goal' as const, expectedVersion: story.version, baseFingerprint: checksumUtf8(stableJson('结识侦察骑士')), value: '约好明天一起旅行' };
      await controller.command(edit, 'story-field-edit');
      expect((await controller.readStoryCatalog())[0]).toMatchObject({ goal: '约好明天一起旅行' });
      expect((await repo.queryCommitments({ scope: seed.head.scope, cutoffSeq: controller.getView().snapshot!.head.coreSeq })).items).toEqual([]);
      expect(controller.getView().snapshot!.records.find(row => row.domain === 'story')).toMatchObject({ value: { completedNodeIds: [] } });
      await expect(controller.command({ ...edit, value: '过期编辑' }, 'stale-story-edit')).rejects.toThrow();
      const slot = await controller.save({ scope: seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '剧情修改' });
      const child = await controller.restore(slot.snapshotId); expect((await controller.readStoryCatalog())[0]!.goal).toBe(edit.value);
      const imported = await prepareCoreImport(await exportCorePackage(repo, child.scope)); await repo.importPrepared(imported);
      controller.dispose();
      const updated = structuredClone(original); updated.分段列表[0]!.场景节点[0]!.目标 = '新版内置目标'; updated.分段列表[0]!.场景节点[0]!.地点 = '蒙德城';
      controller = controllerFor(updated); await controller.attach({ scope: imported.manifest.scope });
      const catalog = await controller.readStoryCatalog(); expect(catalog[0]).toMatchObject({ goal: edit.value, location: '蒙德城' });
      const version = controller.getView().snapshot!.records.find(row => row.domain === 'story')!.version;
      await controller.command({ type: 'story_content', action: 'reset', seriesId: 'story-test', nodeId: 'node-test', field: 'goal', expectedVersion: version, baseFingerprint: checksumUtf8(stableJson('新版内置目标')) });
      expect((await controller.readStoryCatalog())[0]!.goal).toBe('新版内置目标');
      expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'story')).toMatchObject({ value: { resourceEdits: [expect.objectContaining({ value: edit.value })] } });
    } finally { controller.dispose(); }
  });
}
