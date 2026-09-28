// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CodexManagerModal } from '@/components/features/Codex/CodexManagerModal';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat/codex';

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
  afterEach(() => { hosts.forEach((host) => host.remove()); hosts.length = 0; });

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
});
