import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import type { 剧情编织系统, PersistedStoryWeavingV4 } from '@/models/storyWeaving';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function delta(base: unknown, proposed: unknown, live: unknown, key = ''): unknown {
  if (same(base, proposed)) return structuredClone(live);
  if (Array.isArray(base) && Array.isArray(proposed) && Array.isArray(live) && ['系列列表', '分段列表'].includes(key)) {
    const id = (entry: unknown) => object(entry) ? entry.id : undefined;
    const removed = new Set(base.filter(entry => !proposed.some(item => id(item) === id(entry))).map(id));
    const merged = live.filter(entry => !removed.has(id(entry))).map(entry => {
      const before = base.find(item => id(item) === id(entry)), next = proposed.find(item => id(item) === id(entry));
      return next ? delta(before, next, entry) : structuredClone(entry);
    });
    for (const entry of proposed) if (!merged.some(item => id(item) === id(entry))) merged.push(structuredClone(entry));
    return merged;
  }
  if (object(base) && object(proposed) && object(live)) {
    const merged = structuredClone(live);
    for (const field of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
      if (same(base[field], proposed[field])) continue;
      if (!(field in proposed)) delete merged[field];
      else merged[field] = delta(base[field], proposed[field], live[field], field);
    }
    return merged;
  }
  return structuredClone(proposed);
}
export function mergeStoryWeavingEdit(base: 剧情编织系统, proposed: 剧情编织系统, live: 剧情编织系统): 剧情编织系统 {
  return delta(base, proposed, live) as 剧情编织系统;
}
/** Save before publishing success. Rebase again if the game advances while storage awaits. */
export async function commitStoryWeavingEdit(input: {
  base: 剧情编织系统; proposed: 剧情编织系统; isCurrent: () => boolean;
  readLive: () => 剧情编织系统; save: (payload: PersistedStoryWeavingV4) => Promise<void>;
  commit: (update: (live: 剧情编织系统) => 剧情编织系统) => void;
}): Promise<void> {
  for (;;) {
    if (!input.isCurrent()) throw new Error('当前存档已切换，旧编辑未提交');
    const live = input.readLive();
    const next = mergeStoryWeavingEdit(input.base, input.proposed, live);
    await input.save(buildPersistedStoryWeavingSystem(next));
    if (!input.isCurrent()) throw new Error('当前存档已切换，旧编辑未提交');
    if (!same(live, input.readLive())) continue;
    input.commit(current => input.isCurrent() ? mergeStoryWeavingEdit(input.base, input.proposed, current) : current);
    return;
  }
}
