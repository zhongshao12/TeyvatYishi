// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexManagerModal } from '@/components/features/Codex/CodexManagerModal';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';
import { clearContentResourceStatuses, markContentResourceFailed } from '@/services/contentResourceStatus';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(id: string, category: string, name: string, summary: string): CodexEntry {
  return {
    id, category, name, summary, description: summary, unlockedAtTurn: 1, tags: [], sourceText: '', source: 'test', keywords: [], triggerKeywords: [],
    injection: { publicText: `${name}的注入资料` }, runtimeUnlock: { status: 'unlocked', note: '' },
    usage: { narrative: true, courier: false, steambird: false, variables: false }, relatedEntryIds: [],
    importance: 1, linkable: true, builtin: true, createdAt: 1, updatedAt: 1,
  };
}

const codex: ArchiveCodex = {
  entries: [entry('person', 'character', '安柏', '侦察骑士资料'), entry('place', 'location', '风起地', '蒙德地理资料'), entry('word', 'term', '元素共鸣', '术语解释资料')],
  unlockedEntryIds: ['person', 'place', 'word'],
};

describe('codex category navigation', () => {
  const hosts: HTMLDivElement[] = [];
  afterEach(() => { hosts.forEach((host) => host.remove()); hosts.length = 0; clearContentResourceStatuses(); });

  it('switching_location_character_term_shows_matching_entries', async () => {
    const host = document.createElement('div'); hosts.push(host); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CodexManagerModal, { codex, onClose: () => undefined })));
      for (const [buttonName, expected, absent] of [
        ['地点', '蒙德地理资料', '侦察骑士资料'],
        ['角色', '侦察骑士资料', '术语解释资料'],
        ['术语', '术语解释资料', '蒙德地理资料'],
      ]) {
        const button = [...host.querySelectorAll('aside button')].find((node) => node.textContent?.trim() === buttonName);
        expect(button).toBeDefined();
        await act(async () => (button as HTMLButtonElement).click());
        expect(host.querySelector('main')?.textContent).toContain(expected);
        expect(host.querySelector('main')?.textContent).not.toContain(absent);
      }
    } finally { await act(async () => root.unmount()); }
  });

  it('old_selection_and_empty_search_do_not_leak_details', async () => {
    const host = document.createElement('div'); hosts.push(host); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CodexManagerModal, { codex, onClose: () => undefined })));
      const clickCategory = async (name: string) => {
        const button = [...host.querySelectorAll('aside button')].find((node) => node.textContent?.trim() === name);
        await act(async () => (button as HTMLButtonElement).click());
      };
      await clickCategory('地点');
      expect(host.querySelector('main')?.textContent).toContain('风起地');
      await clickCategory('角色');
      expect(host.querySelector('main')?.textContent).toContain('安柏');
      expect(host.querySelector('main')?.textContent).not.toContain('风起地');
      const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索图鉴条目"]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '没有这条词条');
        search?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(host.textContent).toContain('没有匹配的条目');
      expect(host.querySelector('main')?.textContent).not.toContain('侦察骑士资料');
    } finally { await act(async () => root.unmount()); }
  });

  it('locked_entry_hides_body_and_injection', async () => {
    const locked = { ...entry('sealed', 'term', '封存词条', 'SECRET_SUMMARY'), description: 'SECRET_DESCRIPTION', injection: { publicText: 'SECRET_INJECTION' }, runtimeUnlock: { status: 'locked', note: '继续探索解锁' } };
    const archive: ArchiveCodex = { entries: [locked], unlockedEntryIds: [] };
    const host = document.createElement('div'); hosts.push(host); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CodexManagerModal, { codex: archive, onClose: () => undefined })));
      expect(host.textContent).toContain('封存词条');
      expect(host.textContent).toContain('继续探索解锁');
      expect(host.textContent).not.toContain('SECRET_');
    } finally { await act(async () => root.unmount()); }
  });

  it('missing_catalog_reports_resource_failure instead of claiming the category is empty', async () => {
    markContentResourceFailed('codex:broken', 'parse', '请检查安装文件后刷新页面。');
    const host = document.createElement('div'); hosts.push(host); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CodexManagerModal, { codex: { entries: [], unlockedEntryIds: [] }, onClose: () => undefined })));
      expect(host.textContent).toContain('图鉴资源加载失败');
      expect(host.textContent).toContain('codex:broken');
      expect(host.textContent).toContain('请检查安装文件');
      expect(host.textContent).not.toContain('图鉴尚无条目');
    } finally { await act(async () => root.unmount()); }
  });

  it('navigates the bundled location character and term data without stale cross-category detail', async () => {
    const presets = [
      'teyvat-location-core.json', 'teyvat-characters-core.json', 'teyvat-term-core.json',
    ].map((filename) => JSON.parse(readFileSync(resolve('public', 'codex-presets', filename), 'utf8')) as {
      entries: Array<{ 标题: string; 分类: string; 摘要: string }>;
    });
    const builtins = presets.map((preset, index) => {
      const first = preset.entries[0];
      if (!first) throw new Error('内置图鉴资源为空');
      return entry(`builtin-${index}`, first.分类, first.标题, first.摘要);
    });
    expect(builtins.map((item) => item.category)).toEqual(['location', 'character', 'term']);
    const archive: ArchiveCodex = { entries: builtins, unlockedEntryIds: builtins.map((item) => item.id) };
    const host = document.createElement('div'); hosts.push(host); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CodexManagerModal, { codex: archive, onClose: () => undefined })));
      for (const [label, expected, other] of [
        ['地点', builtins[0]!.name, builtins[1]!.name],
        ['角色', builtins[1]!.name, builtins[2]!.name],
        ['术语', builtins[2]!.name, builtins[0]!.name],
      ]) {
        const button = [...host.querySelectorAll('aside button')].find((node) => node.textContent?.trim() === label);
        await act(async () => (button as HTMLButtonElement).click());
        expect(host.querySelector('main')?.textContent).toContain(expected);
        expect(host.querySelector('main')?.textContent).not.toContain(other);
      }
    } finally { await act(async () => root.unmount()); }
  });
});
