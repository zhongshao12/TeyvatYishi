// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { bindStoryResourceBaseline, buildPersistedStoryWeavingSystem, hydratePersistedStoryWeavingSystem, loadAllBundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import { 归一化剧情编织系统, 归一化剧情编织系列, type 剧情编织系统 } from '@/models/storyWeaving';
import { fromLegacyStoryWeaving, toLegacyStoryWeaving } from '@/hooks/useGameState';
import { normalizeNarrativeRuntime } from '@/models/teyvat/runtimeSlices';
import { 创建默认游戏设置, 创建空API设置 } from '@/models/settings';
import { PlotPanel } from '@/components/features/GameSystems/PlotPanel';
import { normalizeCanonTrack } from '@/services/canonDeviationService';
import { commitStoryWeavingEdit } from '@/services/storyWeavingEdits';
import * as storyEdits from '@/services/storyWeavingEdits';
import { resolveStoryWeavingForBackgroundWrite } from '@/hooks/useGame/postSettlementCommitStage';

const storage = vi.hoisted(() => ({ save: vi.fn<(key: string, payload: unknown) => Promise<void>>(async () => {} ) }));
vi.mock('@/services/dbService', async importOriginal => ({ ...await importOriginal<object>(), saveSetting: storage.save }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public/${new URL(String(url), 'http://local').pathname.replace(/^\//, '')}`, 'utf8'), { headers: { 'content-type': 'application/json' } })));
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); storage.save.mockReset(); storage.save.mockResolvedValue(undefined); vi.unstubAllGlobals(); });
function resource() {
  const raw = JSON.parse(readFileSync('public/data/story-weaving-canon/story_canon_teyvat_mondstadt_prologue_act1.json', 'utf8'));
  return bindStoryResourceBaseline(归一化剧情编织系统({ 系列列表: [归一化剧情编织系列(raw)] }));
}
function edited() { const old = resource(); old.系列列表[0]!.分段列表[0]!.本段概括 = '玩家自定概括'; return old; }
async function mount(initial = edited()) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  function Harness() { const [system, setSystem] = useState(initial); return createElement(PlotPanel, { storyWeaving: system, onStoryWeavingChange: setSystem, gameSettings: 创建默认游戏设置(), apiSettings: 创建空API设置(), canonTrack: normalizeCanonTrack(undefined) }); }
  await act(async () => root.render(createElement(Harness)));
  return container;
}
describe('story provenance boundary integration', () => {
  it('merges actual custom-only export JSON without replacing existing custom or canon edits', () => {
    const current = edited();
    current.系列列表.push(归一化剧情编织系列({ id: 'custom-A', 来源类型: 'custom', 标题: 'A' }));
    const incoming = { 系列列表: [归一化剧情编织系列({ id: 'custom-B', 来源类型: 'custom', 标题: 'B' })] };
    const next = storyEdits.prepareStoryWeavingImport(JSON.parse(JSON.stringify(incoming)), resource(), current);
    expect(next.系列列表.map(series => series.id)).toContain('custom-A');
    expect(next.系列列表.map(series => series.id)).toContain('custom-B');
    expect(next.系列列表[0]!.分段列表[0]!.本段概括).toBe('玩家自定概括');
  });
  it.each(['segment', 'series'])('retains orphan scene progress when resource %s is removed and restored', kind => {
    const old = resource(), first = old.系列列表[0]!.分段列表[0]!.场景节点![0]!.id, second = old.系列列表[0]!.分段列表[0]!.场景节点![1]!.id;
    old.当前进度!.当前场景ID = second; old.当前进度!.已完成场景ID = [first];
    const missing = resource(); if (kind === 'series') missing.系列列表 = []; else missing.系列列表[0]!.分段列表.shift();
    const orphan = hydratePersistedStoryWeavingSystem(buildPersistedStoryWeavingSystem(old), missing);
    const projected = toLegacyStoryWeaving(fromLegacyStoryWeaving(orphan));
    expect(projected.当前进度!.当前场景ID).toBe(second); expect(projected.当前进度!.已完成场景ID).toEqual([first]);
    const restored = hydratePersistedStoryWeavingSystem(buildPersistedStoryWeavingSystem(projected), resource());
    expect(restored.当前进度!.当前场景ID).toBe(second); expect(restored.当前进度!.已完成场景ID).toEqual([first]);
  });
  it('does not normalize an explicit blank name back to a resource name', () => {
    const old = edited(); old.系列列表[0]!.标题 = ''; old.系列列表[0]!.分段列表[0]!.标题 = ''; old.系列列表[0]!.核心角色 = [];
    const restored = toLegacyStoryWeaving(fromLegacyStoryWeaving(old));
    expect(restored.系列列表[0]!.标题).toBe('');
    expect(restored.系列列表[0]!.分段列表[0]!.标题).toBe('');
    expect(restored.系列列表[0]!.核心角色).toEqual([]);
  });
  it('preserves overrides, scene IDs and progress through real DTO normalization and JSON save/export', () => {
    const old = edited(); const sceneId = old.系列列表[0]!.分段列表[0]!.场景节点![0]!.id;
    const nextSceneId = old.系列列表[0]!.分段列表[0]!.场景节点![1]!.id;
    old.当前进度!.当前场景ID = nextSceneId; old.当前进度!.已完成场景ID = [sceneId];
    const projected = normalizeNarrativeRuntime({ storyWeaving: fromLegacyStoryWeaving(old) }).storyWeaving;
    expect(projected?.builtinBindings).toEqual(old.builtinBindings);
    const restored = hydratePersistedStoryWeavingSystem(JSON.parse(JSON.stringify(buildPersistedStoryWeavingSystem(toLegacyStoryWeaving(projected)))), resource());
    expect(restored.系列列表[0]!.分段列表[0]!.本段概括).toBe('玩家自定概括');
    expect(restored.系列列表[0]!.分段列表[0]!.场景节点![0]!.id).toBe(sceneId);
    expect(restored.当前进度!.当前场景ID).toBe(nextSceneId);
    expect(restored.当前进度!.已完成场景ID).toEqual([sceneId]);
    expect(restored.builtinBindings!.story_canon_teyvat_mondstadt_prologue_act1!.segmentOverrides[old.系列列表[0]!.分段列表[0]!.id]!.本段概括).toBe('玩家自定概括');
  });
  it('keeps two same-name save payloads isolated and runtime advancement out of content overrides', () => {
    const first = edited(), second = resource(); first.当前进度!.已完成摘要 = ['甲档']; second.当前进度!.已完成摘要 = ['乙档'];
    const a = hydratePersistedStoryWeavingSystem(buildPersistedStoryWeavingSystem(toLegacyStoryWeaving(fromLegacyStoryWeaving(first))), resource());
    const b = hydratePersistedStoryWeavingSystem(buildPersistedStoryWeavingSystem(toLegacyStoryWeaving(fromLegacyStoryWeaving(second))), resource());
    expect(a.系列列表[0]!.分段列表[0]!.本段概括).toBe('玩家自定概括');
    expect(b.系列列表[0]!.分段列表[0]!.本段概括).not.toBe('玩家自定概括');
    expect(a.当前进度!.已完成摘要).toEqual(['甲档']); expect(b.当前进度!.已完成摘要).toEqual(['乙档']);
    expect(buildPersistedStoryWeavingSystem(b).builtinBindings[b.系列列表[0]!.id]!.segmentOverrides).toEqual({});
  });
  it('shows legacy provenance once and restores one field without removing another edit', async () => {
    const old = edited(); old.系列列表[0]!.分段列表[0]!.给后续参考 = ['玩家后续']; delete old.builtinBindings;
    const container = await mount(hydratePersistedStoryWeavingSystem(old, resource()));
    expect(container.textContent).toContain('旧档保留，来源未确认');
    const button = [...container.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === '恢复本段概括内置值');
    expect(button).toBeDefined();
    await act(async () => { button!.click(); await vi.waitFor(() => expect(storage.save.mock.calls.length).toBeGreaterThan(0)); });
    const payload = storage.save.mock.calls.at(-1)?.[1];
    expect(payload).toHaveProperty('persistenceVersion', 4);
    const next = hydratePersistedStoryWeavingSystem(payload, resource());
    expect(next.系列列表[0]!.分段列表[0]!.本段概括).toBe(resource().系列列表[0]!.分段列表[0]!.本段概括);
    expect(next.系列列表[0]!.分段列表[0]!.给后续参考).toEqual(['玩家后续']);
  });
  it('reports a failed edit save without declaring the draft saved', async () => {
    const container = await mount(); storage.save.mockRejectedValueOnce(new Error('磁盘不可写'));
    const button = [...container.querySelectorAll('button')].find(el => el.textContent === '保存修改');
    expect(button).toBeDefined(); await act(async () => button!.click());
    expect(container.textContent).toContain('保存失败'); expect(container.textContent).not.toContain('已保存分段');
  });
  it('discards delayed commits after switching sessions', async () => {
    const base = resource(), proposed = edited(); let live = base, session = 1;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const pending = commitStoryWeavingEdit({ base, proposed, readLive: () => live, isCurrent: () => session === 1,
      save: async () => wait, commit: updater => { live = updater(live); } });
    session = 2; live = resource(); release();
    await expect(pending).rejects.toThrow('存档已切换');
    expect(live.系列列表[0]!.分段列表[0]!.本段概括).not.toBe('玩家自定概括');
  });
  it('rebases an edit over game advancement during an asynchronous save', async () => {
    const base = resource(), proposed = edited(); let live = structuredClone(base), saves = 0;
    await commitStoryWeavingEdit({ base, proposed, readLive: () => live, isCurrent: () => true,
      save: async () => { if (saves++ === 0) live = { ...live, 当前进度: { ...live.当前进度!, 已完成摘要: ['异步期间新进度'] } }; },
      commit: updater => { live = updater(live); } });
    expect(saves).toBe(2); expect(live.当前进度!.已完成摘要).toEqual(['异步期间新进度']);
    expect(live.系列列表[0]!.分段列表[0]!.本段概括).toBe('玩家自定概括');
  });
  it('detects content-only concurrent changes even when updatedAt has not changed', async () => {
    const base = await loadAllBundledStoryWeavingPresets(), latest = structuredClone(base);
    latest.系列列表[0]!.分段列表[0]!.本段概括 = '保存期间的校订';
    const resolved = await resolveStoryWeavingForBackgroundWrite({ workflowBase: base, proposed: base, loadLatest: async () => buildPersistedStoryWeavingSystem(latest) });
    expect(resolved.concurrentChange).toBe(true);
    expect(resolved.system.系列列表[0]!.分段列表[0]!.本段概括).toBe('保存期间的校订');
  });
});
