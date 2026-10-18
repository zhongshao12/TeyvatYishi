import type { CoreSnapshot } from '../contracts/state';
import { validateCoreDto } from '../contracts/validation';
import { projectCoreStoryCatalog } from './storyEdits';

interface StoryScene { id: string; 标题: string; 地点: string; 目标: string; 完成证据: string[]; 开场事实?: unknown[]; 完成后事实?: unknown[]; 可偏离切口?: string[] }
export interface CoreStoryResource { id: string; 标题: string; 分段列表: { id: string; 标题: string; 本段概括: string; 原文摘要?: string; 原著硬约束?: unknown[]; 场景节点?: StoryScene[] }[] }
export interface CoreStoryNode { seriesId: string; chapterId: string; nodeId: string; prerequisites: string[]; seriesTitle: string; chapterTitle: string; title: string; location: string; goal: string; completionEvidence: string[]; referenceText?: string; baseFingerprints?: Partial<Record<import('../contracts/state').StoryContentField, string>> }
const validId = (id: string) => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok;

/** Read-only adaptation. Resource IDs are not replaced with array positions or mutable titles. */
export function buildCoreStoryCatalog(resource: CoreStoryResource): CoreStoryNode[] {
  if (!resource || !validId(resource.id) || !Array.isArray(resource.分段列表)) throw Error('CORE2_STORY_RESOURCE_INVALID');
  const nodes: CoreStoryNode[] = [], ids = new Set<string>();
  for (const chapter of resource.分段列表) {
    if (!validId(chapter.id)) throw Error('CORE2_STORY_CHAPTER_INVALID');
    const scenes = chapter.场景节点?.length ? chapter.场景节点 : [{ id: chapter.id, 标题: chapter.标题, 地点: '', 目标: chapter.本段概括, 完成证据: [] }];
    for (const scene of scenes) {
      if (!validId(scene.id) || ids.has(scene.id) || !scene.标题?.trim() || !Array.isArray(scene.完成证据)) throw Error('CORE2_STORY_NODE_INVALID');
      ids.add(scene.id); nodes.push({ seriesId: resource.id, chapterId: chapter.id, nodeId: scene.id, prerequisites: nodes.length ? [nodes.at(-1)!.nodeId] : [],
        seriesTitle: resource.标题, chapterTitle: chapter.标题, title: scene.标题, location: scene.地点, goal: scene.目标, completionEvidence: [...scene.完成证据],
        referenceText: [chapter.原文摘要, chapter.原著硬约束?.length ? `原著约束：${JSON.stringify(chapter.原著硬约束)}` : '', scene.开场事实?.length ? `开场背景（保留知情标记）：${JSON.stringify(scene.开场事实)}` : '', scene.完成后事实?.length ? `完成后才成立：${JSON.stringify(scene.完成后事实)}` : '', scene.可偏离切口?.length ? `可偏离分支：${JSON.stringify(scene.可偏离切口)}` : ''].filter(Boolean).join('\n') });
    }
  }
  if (!nodes.length) throw Error('CORE2_STORY_RESOURCE_EMPTY'); return nodes;
}

export function createCoreStoryResources(seriesOrder: readonly string[], load: (id: string) => Promise<CoreStoryResource>) {
  const order = [...seriesOrder], cached = new Map<string, CoreStoryNode[]>(), pending = new Map<string, Promise<void>>();
  if (!order.length || new Set(order).size !== order.length || order.some(id => !validId(id))) throw Error('CORE2_STORY_ORDER_INVALID');
  const ensure = async (id: string) => {
    if (cached.has(id)) return; if (pending.has(id)) return pending.get(id)!;
    const work = (async () => { const resource = await load(id); if (resource.id !== id) throw Error('CORE2_STORY_RESOURCE_ID_MISMATCH'); cached.set(id, buildCoreStoryCatalog(resource)); })();
    pending.set(id, work); try { await work; } finally { if (pending.get(id) === work) pending.delete(id); }
  };
  const getNodes = (snapshot?: CoreSnapshot) => {
    const result: CoreStoryNode[] = [], ids = new Set<string>();
    for (let index = 0; index < order.length; index++) {
      const rows = cached.get(order[index]!); if (!rows) continue;
      const previous = index > 0 ? cached.get(order[index - 1]!)?.at(-1) : null;
      for (const [position, source] of rows.entries()) {
        if (ids.has(source.nodeId)) throw Error('CORE2_STORY_NODE_COLLISION'); ids.add(source.nodeId);
        result.push({ ...structuredClone(source), prerequisites: position === 0 && previous ? [previous.nodeId] : [...source.prerequisites] });
      }
    }
    return projectCoreStoryCatalog(result, snapshot);
  };
  return { getNodes, async prepare(snapshot: CoreSnapshot, signal?: AbortSignal) {
    if (signal?.aborted) throw Error('CORE2_STORY_PREPARATION_CANCELLED');
    const story = snapshot.records.find(row => row.domain === 'story'); if (story?.domain !== 'story') throw Error('CORE2_STORY_STATE_MISSING');
    const index = story.value.seriesId ? order.indexOf(story.value.seriesId) : 0; if (index < 0) throw Error('当前剧情资源未注册，没有擅自重置进度。');
    await ensure(order[index]!); if (index > 0) await ensure(order[index - 1]!);
    const current = cached.get(order[index]!)!;
    const next = story.value.status === 'completed' && story.value.nodeId === current.at(-1)!.nodeId && story.value.completedNodeIds.includes(story.value.nodeId) ? order[index + 1] : undefined;
    if (next) await ensure(next); if (signal?.aborted) throw Error('CORE2_STORY_PREPARATION_CANCELLED');
    const baselineCatalog = getNodes().filter(row => row.seriesId === order[index] || row.seriesId === next);
    const catalog = projectCoreStoryCatalog(baselineCatalog, snapshot);
    const nodes = catalog.filter(row => row.nodeId === story.value.nodeId || !story.value.completedNodeIds.includes(row.nodeId) && row.prerequisites.every(id => story.value.completedNodeIds.includes(id)));
    return { baselineCatalog, catalog, nodes, prompt: `原著剧情参考，仅供作者规划；未来目标不算已发生事实，也不授予NPC知识。只能以明确正文证据更新进度，不替玩家完成节点。\n${JSON.stringify(nodes)}` };
  } };
}
