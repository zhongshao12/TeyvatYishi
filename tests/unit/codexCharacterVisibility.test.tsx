// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexManagerModal } from '@/components/features/Codex/CodexManagerModal';
import { buildCodexArchiveItems } from '@/components/features/Codex/productionAdapter';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { 创建NPC记录 } from '@/models/npc';
import type { NPC记录 } from '@/models/npc';
import { retrieveCodexEntries } from '@/services/codexRetrieval';
import { readFileSync } from 'node:fs';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const codex = normalizeArchiveCodex({ entries: [
  { id: 'lisa', name: '丽莎', category: 'character', summary: '外貌：银白色长发的图书管理员', description: '公开描述词', sourceText: '完整正文词', injection: { appearanceAnchor: '银白色长发，金色眼睛，戴银白色帽子', speechStyle: '独特说话词', publicText: '外貌：银白色长发的注入文本' }, runtimeUnlock: { status: 'locked' } },
  ...['location', 'term', 'lore'].map(category => ({ id: category, category, name: category, summary: '封存内容', runtimeUnlock: { status: 'locked' } })),
] });
const npc = { ...创建NPC记录({ 姓名: '丽莎', 初见回合: 1, 性别: '女' }), 外貌: '棕色长发，绿色眼睛，戴银白色帽子', 外貌档案: { 发色: { value: '棕色', source: 'manual' as const }, 瞳色: { value: '绿色', source: 'narrative' as const }, 身高: { value: '168 cm', source: 'ai_estimate' as const } }, NSFW档案: { 常用内衣: 'PRIVATE_SENTINEL', 备注: 'PRIVATE_NOTES' } };
const hosts: HTMLDivElement[] = [];
afterEach(() => { hosts.forEach(host => host.remove()); hosts.length = 0; });
async function render(records: NPC记录[] = [npc], archive = codex) {
  const host = document.createElement('div'); hosts.push(host); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(CodexManagerModal, { codex: archive, onClose: () => undefined, npcRecords: records })));
  return { host, root };
}
describe('public character codex visibility', () => {
  it('makes characters readable while keeping actual unlock and AI retrieval unchanged', () => {
    const items = buildCodexArchiveItems(codex);
    expect(items[0]?.summary).toContain('图书管理员'); expect(items[0]?.unlocked).toBe(false);
    expect(items.slice(1).every(item => item.summary === '')).toBe(true);
    expect(retrieveCodexEntries(codex, '丽莎').entries).toEqual([]); expect(codex.unlockedEntryIds).toEqual([]);
  });
  it('shows current public appearance and sourced details without two contradictory anchors or private archives', async () => {
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('168 cm'); expect(host.textContent).toContain('手动记录'); expect(host.textContent).toContain('AI 推测');
      expect(host.textContent).toContain('棕色长发'); expect(host.textContent).not.toContain('银白色长发'); expect(host.textContent).not.toContain('金色眼睛');
      expect(host.textContent).toContain('银白色帽子'); expect(host.textContent).not.toContain('PRIVATE_');
    } finally { await act(async () => root.unmount()); }
  });
  it.each(['完整正文词', '独特说话词', '168 cm'])('searches the full public character projection: %s', async query => {
    const { host, root } = await render();
    try {
      const input = host.querySelector('input');
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '无匹配内容XYZ'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(host.querySelector('main')?.textContent).not.toContain('丽莎');
      expect(host.querySelectorAll('aside button strong')).toHaveLength(0);
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query); input?.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(host.querySelector('main')?.textContent).toContain('丽莎');
      expect(host.querySelectorAll('aside button strong')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
  });
  it('falls back to the original codex without matching a contains-only NPC name', async () => {
    const { host, root } = await render([{ ...npc, 姓名: '丽莎的学徒', 别名: undefined }]);
    try { expect(host.textContent).toContain('银白色长发'); expect(host.textContent).not.toContain('168 cm'); }
    finally { await act(async () => root.unmount()); }
  });
  it('keeps other peoples appearance in stories and dialogue rather than rewriting it to the current NPC', async () => {
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], sourceText: '她与金发蓝眼的琴共事。金色长发的琴与她共事。', description: '与金色眼睛的同伴交流。', injection: { ...codex.entries[0]?.injection, dialogueSamples: '你的金色眼睛很漂亮。', conciseStory: '她与金色长发的琴共事。' } }] });
    const { host, root } = await render([npc], archive);
    try {
      expect(host.textContent).toContain('你的金色眼睛很漂亮'); expect(host.textContent).toContain('金色长发的琴共事');
      expect(host.textContent).toContain('与金色眼睛的同伴交流'); expect(host.textContent).toContain('她与金发蓝眼的琴共事');
      expect(host.textContent).toContain('金色长发的琴与她共事');
      expect(host.textContent).toContain('棕色长发');
    } finally { await act(async () => root.unmount()); }
  });
  it('requires an explicit appearance section before reconciling mixed public documents, including unnamed strangers', () => {
    const story = '金色长发的陌生少女走过街角。';
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], sourceText: `外貌：银白色长发，金色眼睛。\n${story}`, injection: { ...codex.entries[0]?.injection, publicText: `${story}\n外貌：银白色长发，金色眼睛。` } }] });
    const projected = buildCodexArchiveItems(archive, [npc])[0]!;
    expect(projected.entry.sourceText).toContain(story); expect(projected.entry.injection.publicText).toContain(story);
    expect(projected.entry.sourceText).toContain('外貌：棕色长发，绿色眼睛'); expect(projected.entry.injection.publicText).toContain('外貌：棕色长发，绿色眼睛');
    expect(projected.searchText).toContain(story); expect(projected.searchText).not.toContain('棕色长发的陌生少女');
  });
  it('preserves crown pin and cord colors in the real codex adapter and current NPC projection', () => {
    const text = '银白色长发，银白色发冠，金色发簪，蓝色发绳。';
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], sourceText: `外貌：${text}`, injection: { appearanceAnchor: text } }] });
    const projected = buildCodexArchiveItems(archive, [{ ...npc, 外貌: text }])[0]!;
    const expected = '棕色长发，银白色发冠，金色发簪，蓝色发绳。';
    expect(projected.characterFacts?.appearance).toBe(expected); expect(projected.entry.injection.appearanceAnchor).toBe(expected);
    expect(projected.entry.sourceText).toBe(`外貌：${expected}`);
  });
  it('reconciles every appearance sentence of a labeled paragraph while preserving adjacent stories in every generic public field', () => {
    const text = '外貌：银白色长发。金色眼眸，戴银白色帽子。\n金色长发的陌生少女走过街角。\n金色长发的琴走过街角。';
    const expected = '外貌：棕色长发。绿色眼眸，戴银白色帽子。\n金色长发的陌生少女走过街角。\n金色长发的琴走过街角。';
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], summary: text, description: text, sourceText: text, injection: { publicText: text } }] });
    const projected = buildCodexArchiveItems(archive, [npc])[0]!;
    expect(projected.entry.summary).toBe(expected); expect(projected.entry.description).toBe(expected);
    expect(projected.entry.sourceText).toBe(expected); expect(projected.entry.injection.publicText).toBe(expected);
    expect(projected.searchText).toContain('金色长发的陌生少女走过街角'); expect(projected.searchText).toContain('金色长发的琴走过街角');
  });
  it.each([
    ['description', '金色长发的琴走过街角。'], ['description', '金色长发的陌生少女走过街角。'],
    ['summary', '金色长发的琴走过街角。'], ['summary', '金色长发的陌生少女走过街角。'],
  ] as const)('does not treat a generic %s as a dedicated current-NPC appearance field: %s', (field, story) => {
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], [field]: story }] });
    const projected = buildCodexArchiveItems(archive, [npc])[0]!;
    expect(projected.entry[field]).toBe(story); expect(projected.searchText).toContain(story);
  });
  it('preserves actual bundled canonical content while reconciling only the explicit appearance line and dedicated anchor', () => {
    const preset = JSON.parse(readFileSync('public/codex-presets/teyvat-characters-core.json', 'utf8')) as { entries: Array<{ id: string; 标题: string; 分类: string; 摘要: string; 原文: string; 注入内容: { 说话方式: string; 台词语料: string; 外貌锚点: string; 精简角色故事: string } }> };
    const original = preset.entries.find(entry => entry.标题 === '丽莎')!;
    const archive = normalizeArchiveCodex({ entries: [{ id: original.id, name: original.标题, category: original.分类, summary: original.摘要, description: original.摘要, sourceText: original.原文, injection: { speechStyle: original.注入内容.说话方式, dialogueSamples: original.注入内容.台词语料, appearanceAnchor: original.注入内容.外貌锚点, conciseStory: original.注入内容.精简角色故事 } }] });
    const projected = buildCodexArchiveItems(archive, [npc])[0]!;
    expect(projected.entry.summary).toBe(original.摘要); expect(projected.entry.description).toBe(original.摘要);
    expect(projected.entry.injection.speechStyle).toBe(original.注入内容.说话方式); expect(projected.entry.injection.dialogueSamples).toBe(original.注入内容.台词语料);
    expect(projected.entry.injection.conciseStory).toBe(original.注入内容.精简角色故事);
    expect(projected.entry.injection.appearanceAnchor).toContain('棕色长发'); expect(projected.entry.injection.appearanceAnchor).toContain('绿色瞳');
    const originalLines = original.原文.split('\n'); const projectedLines = projected.entry.sourceText.split('\n');
    expect(projectedLines).toHaveLength(originalLines.length);
    originalLines.forEach((line, index) => {
      if (line.startsWith('- 外貌：')) { expect(projectedLines[index]).toContain('- 外貌：棕色长发'); expect(projectedLines[index]).toContain('绿色瞳'); }
      else expect(projectedLines[index]).toBe(line);
    });
  });
  it.each(['测试学徒', '可莉'])('filters disallowed measurements in the shared outfit projection and UI/search: %s', async name => {
    const archive = normalizeArchiveCodex({ entries: [{ id: name, category: 'character', name, summary: '公开角色' }] });
    const record = { ...npc, 姓名: name, 穿着: '蓝色长裙，三围90/60/90 cm', NSFW档案: undefined };
    const projected = buildCodexArchiveItems(archive, [record])[0]!;
    expect(projected.characterFacts?.outfit).toContain('蓝色长裙'); expect(projected.characterFacts?.outfit).not.toContain('90/60/90');
    expect(projected.searchText).not.toContain('90/60/90');
    const { host, root } = await render([record], archive);
    try { expect(host.textContent).toContain('蓝色长裙'); expect(host.textContent).not.toContain('90/60/90'); }
    finally { await act(async () => root.unmount()); }
  });
  it('explains that readable locked characters are not injected into a turn', async () => {
    const { host, root } = await render();
    try { expect(host.textContent).toContain('仅供阅读，未解锁时不会在回合中注入'); expect(retrieveCodexEntries(codex, '丽莎').entries).toEqual([]); }
    finally { await act(async () => root.unmount()); }
  });
  it('hides unverified and protected measurements including explicit prose, without hiding height', async () => {
    const archive = normalizeArchiveCodex({ entries: [{ ...codex.entries[0], id: 'unknown', name: '测试学徒', summary: '三围 90/60/90 cm', injection: { appearanceAnchor: '身高 168 cm，三围 90/60/90 cm' } }] });
    for (const record of [{ ...npc, 姓名: '测试学徒', 外貌: '身高 168 cm，三围 90/60/90 cm', 外貌档案: { ...npc.外貌档案, 三围: { value: '90/60/90 cm', source: 'manual' as const } } }, { ...npc, 姓名: '测试学徒', 介绍: '十岁的学徒', 外貌: '身高 168 cm，三围 90/60/90 cm', NSFW档案: { 年龄确认: 'adult' as const, 年龄确认来源: 'manual' as const }, 外貌档案: { ...npc.外貌档案, 三围: { value: '90/60/90 cm', source: 'manual' as const } } }]) {
      const { host, root } = await render([record], archive);
      try { expect(host.textContent).toContain('168 cm'); expect(host.textContent).not.toContain('90/60/90'); }
      finally { await act(async () => root.unmount()); }
    }
  });
  it.each(['测试学徒', '可莉'])('retains the original public codex but hides disallowed measurements without a current NPC: %s', async name => {
    const archive = normalizeArchiveCodex({ entries: [{ id: name, category: 'character', name, summary: '公开概述，三围为90/60/90 cm', sourceText: '公开完整正文，三围 90/60/90 cm', tags: ['三围 90/60/90 cm'], injection: { appearanceAnchor: '红色长发，三围 90/60/90 cm' } }] });
    const { host, root } = await render([], archive);
    try { expect(host.textContent).toContain('公开概述'); expect(host.textContent).toContain('公开完整正文'); expect(host.textContent).toContain('红色长发'); expect(host.textContent).not.toContain('90/60/90'); }
    finally { await act(async () => root.unmount()); }
  });
});
