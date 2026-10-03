import { describe, expect, it } from 'vitest';
import * as api from '@/data/storyWeavingPreset';
import bundledJson from '@/data/storyWeavingCanonDecomposed.json';
import { 归一化剧情编织系统, 归一化剧情编织系列, 归一化剧情编织分段 } from '@/models/storyWeaving';

function resource(text = '旧正文', end = '旧结束') {
  return 归一化剧情编织系统({ 系列列表: [归一化剧情编织系列({
    id: 'a', 来源类型: 'canon', 内置预设ID: 'a', 标题: '同名',
    分段列表: [归一化剧情编织分段({ id: 's', 组号: 1, 标题: '片段', 本段概括: '内置概括', 原文内容: text,
      本段结束状态: [end], 运行状态: '当前', 处理状态: '已完成', 启用注入: true }, 1)],
  })] });
}

describe('story persistence v4', () => {
  it('keeps an unedited builtin transport under the existing 64 KiB budget', () => {
    const bound = api.bindStoryResourceBaseline(api.hydratePersistedStoryWeavingSystem(bundledJson, { 系列列表: [] }));
    expect(new TextEncoder().encode(JSON.stringify(api.buildPersistedStoryWeavingSystem(bound))).length).toBeLessThan(64 * 1024);
  });
  it('preserves only edited content while updating unedited resource fields and runtime', () => {
    const old = api.bindStoryResourceBaseline(resource());
    old.系列列表[0]!.分段列表[0]!.本段概括 = '玩家概括';
    old.系列列表[0]!.分段列表[0]!.启用注入 = false;
    old.当前进度!.已完成摘要 = ['本档进度'];
    const restored = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(old), resource('新正文', '新结束'));
    const segment = restored.系列列表[0]!.分段列表[0]!;
    expect(segment.本段概括).toBe('玩家概括');
    expect(segment.原文内容).toBe('新正文');
    expect(segment.本段结束状态).toEqual(['新结束']);
    expect(segment.启用注入).toBe(false);
    expect(restored.当前进度!.已完成摘要).toEqual(['本档进度']);
    expect(restored.当前进度!.当前分段ID).toBe('s');
  });
  it('round trips explicit empty fields, arrays and edited prose', () => {
    const old = api.bindStoryResourceBaseline(resource());
    old.系列列表[0]!.标题 = '';
    const segment = old.系列列表[0]!.分段列表[0]!;
    segment.本段概括 = ''; segment.本段结束状态 = []; segment.原文内容 = '玩家全文';
    const restored = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(old), resource('新正文'));
    expect(restored.系列列表[0]!.标题).toBe('');
    expect(restored.系列列表[0]!.分段列表[0]!.本段概括).toBe('');
    expect(restored.系列列表[0]!.分段列表[0]!.本段结束状态).toEqual([]);
    expect(restored.系列列表[0]!.分段列表[0]!.原文内容).toBe('玩家全文');
    expect(restored.系列列表[0]!.分段列表[0]!.字数).toBe(4);
  });
  it('does not turn missing v2 fields into empty overrides', () => {
    const saved = { persistenceVersion: 2, 系列列表: [{ id: 'a', 来源类型: 'canon', 内置预设ID: 'a', 分段列表: [{ id: 's', 启用注入: false }] }] };
    const restored = api.hydratePersistedStoryWeavingSystem(saved, resource());
    expect(restored.系列列表[0]!.分段列表[0]!.本段概括).toBe('内置概括');
    expect(restored.builtinBindings!.a!.segmentOverrides.s).toEqual({});
    expect(restored.migrationWarnings).toEqual([]);
  });
  it('preserves unknown legacy differences with stable warning IDs', () => {
    const old = resource(); old.系列列表[0]!.分段列表[0]!.本段概括 = '旧档不明来源';
    const restored = api.hydratePersistedStoryWeavingSystem({ ...old, persistenceVersion: 3 }, resource());
    expect(restored.系列列表[0]!.分段列表[0]!.本段概括).toBe('旧档不明来源');
    expect(restored.migrationWarnings!.some(w => w.field === '本段概括' && w.reason === 'legacy_origin_unknown')).toBe(true);
    const twice = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(restored), resource());
    expect(twice.migrationWarnings).toEqual(restored.migrationWarnings);
  });
  it('restores one builtin field without erasing other edits', () => {
    const old = api.bindStoryResourceBaseline(resource());
    old.系列列表[0]!.分段列表[0]!.本段概括 = '玩家概括'; old.系列列表[0]!.分段列表[0]!.原文内容 = '玩家正文';
    const restored = api.restoreStoryBuiltinField(old, resource(), { seriesId: 'a', segmentId: 's', field: '本段概括' });
    const next = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(restored), resource('新正文'));
    expect(next.系列列表[0]!.分段列表[0]!.本段概括).toBe('内置概括');
    expect(next.系列列表[0]!.分段列表[0]!.原文内容).toBe('玩家正文');
  });
  it('retains removed segments and active anchors', () => {
    const old = api.bindStoryResourceBaseline(resource()); old.系列列表[0]!.分段列表[0]!.本段概括 = '本地保留';
    const updated = resource(); updated.系列列表[0]!.分段列表 = [];
    const restored = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(old), updated);
    expect(restored.系列列表[0]!.分段列表[0]!.id).toBe('s');
    expect(restored.系列列表[0]!.分段列表[0]!.本段概括).toBe('本地保留');
    expect(restored.当前进度!.当前分段ID).toBe('s');
    expect(restored.migrationWarnings!.some(w => w.reason === 'resource_removed')).toBe(true);
  });
  it('never borrows a same-title new series to replace a removed series', () => {
    const old = api.bindStoryResourceBaseline(resource()); old.系列列表[0]!.分段列表[0]!.本段概括 = '旧档';
    const next = resource('乙正文'); next.系列列表[0]!.id = 'b'; next.系列列表[0]!.内置预设ID = 'b';
    const restored = api.hydratePersistedStoryWeavingSystem(api.buildPersistedStoryWeavingSystem(old), next);
    expect(restored.系列列表.find(s => s.id === 'a')!.分段列表[0]!.本段概括).toBe('旧档');
    expect(restored.系列列表.find(s => s.id === 'b')!.分段列表[0]!.原文内容).toBe('乙正文');
    expect(restored.当前系列ID).toBe('a');
  });
  it('keeps custom series complete and avoids shared mutable metadata', () => {
    const old = api.bindStoryResourceBaseline(resource());
    const custom = 归一化剧情编织系列({ ...resource().系列列表[0]!, id: 'custom', 来源类型: 'custom', 内置预设ID: undefined });
    old.系列列表.push(custom);
    const persisted = api.buildPersistedStoryWeavingSystem(old);
    const restored = api.hydratePersistedStoryWeavingSystem(persisted, resource());
    expect(restored.系列列表.find(s => s.id === 'custom')!.分段列表[0]!.原文内容).toBe('旧正文');
    restored.builtinBindings!.a!.seriesOverrides.标题 = '别档';
    expect(persisted.builtinBindings.a!.seriesOverrides.标题).toBeUndefined();
  });
  it('never marks a removed lightweight resource as complete offline content', () => {
    const saved = { persistenceVersion: 3, 当前系列ID: 'a', 系列列表: [{ id: 'a', 标题: '同名', 来源类型: 'canon', 内置预设ID: 'a', 分段列表: [{ id: 's', 组号: 1, 本段概括: '已存概括' }] }] };
    const restored = api.hydratePersistedStoryWeavingSystem(saved, { 系列列表: [] });
    expect(restored.系列列表[0]!.分段列表[0]!.原文内容).toBe('');
    expect(api.isSelfContainedStoryWeavingSystem(restored)).toBe(false);
    expect(restored.migrationWarnings!.some(w => w.reason === 'resource_removed')).toBe(true);
  });
});
