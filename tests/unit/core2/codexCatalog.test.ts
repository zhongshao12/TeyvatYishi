import { expect, it, vi } from 'vitest';
import { createCoreCodexCatalog } from '@/core/content/codexCatalog';
import { makeSeed } from './fixtures';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const resource = { 条目: [
  { id: 'codex-amber', 标题: '安柏', 分类: 'character', 摘要: '蒙德侦察骑士。', 原文: '安柏的公开人物资料。', 关键词: ['安柏'], 资料版本: 2,
    注入内容: { 类型: 'character', 核心身份与阵营: '西风骑士团侦察骑士', 独立人格与行为: '热情、乐于助人', 说话方式: '爽朗自然', 外貌锚点: '红棕色长发', 精简角色故事: '尚未发生的剧情秘密，不应给其他NPC。' } },
  { id: 'codex-vision', 标题: '神之眼', 分类: 'term', 摘要: '引导元素力的外置器官。', 原文: '元素力相关的公开设定。', 关键词: ['神之眼', '元素力'] },
  { id: 'codex-story', 标题: '未来篇章', 分类: 'story', 摘要: '只作作者参考。', 原文: '未来发生的秘密事件。', 关键词: ['未来篇章'] },
] };
it('opens all categories without discovery writes and caches immutable content rather than another game state', async () => {
  const load = vi.fn(async () => resource), catalog = createCoreCodexCatalog(load);
  expect(load).not.toHaveBeenCalled(); const first = await catalog.read();
  expect(first.map(row => row.category)).toEqual(['character', 'term', 'story']);
  first[0]!.title = '外部修改'; expect((await catalog.read())[0]!.title).toBe('安柏'); expect(load).toHaveBeenCalledTimes(1);
});
it('separates author references from each NPC own characterization without granting future knowledge', async () => {
  const catalog = createCoreCodexCatalog(async () => resource), seed = makeSeed(), snapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  const before = structuredClone(snapshot);
  const author = await catalog.select({ snapshot, query: '未来篇章和神之眼', audience: { target: 'main', npcIds: [] } });
  expect(author.some(row => row.name === '未来篇章')).toBe(true); expect(author.every(row => row.use === 'author_reference')).toBe(true);
  const npc = await catalog.select({ snapshot, query: '未来篇章和神之眼', audience: { target: 'private', npcIds: ['npc-amber'] } });
  expect(npc).toHaveLength(1); expect(npc[0]).toMatchObject({ name: '安柏', use: 'known_background', npcIds: ['npc-amber'] });
  expect(npc[0]!.text).toContain('热情、乐于助人'); expect(npc[0]!.text).not.toContain('未来'); expect(npc[0]!.text).not.toContain('秘密');
  expect(await catalog.select({ snapshot, query: '神之眼', audience: { target: 'news', npcIds: [] } })).toEqual([]);
  expect(snapshot).toEqual(before);
});
it('adapts the actual bundled codex resources without rewriting them or accepting invalid content identities', async () => {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://assets.invalid').pathname;
    if (!/^\/codex-presets\/[a-zA-Z0-9_-]+\.json$/u.test(path)) throw Error(`Unexpected resource request: ${path}`);
    return new Response(await readFile(join(process.cwd(), 'public', path.slice(1)), 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const bundled = await import('@/data/codexPreset');
    const rows = await createCoreCodexCatalog(() => bundled.loadAllBundledCodexPresets({ cacheBust: 'core2-readonly-test' })).read();
    expect(rows.length).toBeGreaterThan(120); expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(rows.some(row => row.category === 'term')).toBe(true); expect(rows.some(row => row.category === 'story')).toBe(true);
    expect(rows.some(row => row.category === 'location')).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
