// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TravelerProfileModal } from '@/components/features/Character/TravelerProfileModal';
import { CompanionPanel } from '@/components/features/GameSystems/CompanionPanel';
import { 创建空角色 } from '@/models/character';
import { 创建NPC记录 } from '@/models/npc';
import type { 变量命令批次 } from '@/models/variableCommand';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const amber = { ...创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 初见回合: 1 }), id: 'npc_amber', 好感度: 35 };
const lisa = { ...创建NPC记录({ 姓名: '丽莎', 阶位: 'extra', 初见回合: 1 }), id: 'npc_lisa', 好感度: 10 };
const extra = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'extra', 初见回合: 1, 原著角色: false }), id: 'npc_extra', 好感度: 10 };
const batches: 变量命令批次[] = [{
  id: 'batch-3', turn: 3, timestamp: 3, source: 'main',
  results: [{ command: { action: 'add', key: 'NPC.[id=npc_amber].affinity', value: 5 }, ok: true, kind: 'command' }],
}];

describe('traveler relationship graph navigation', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('graph_in_traveler_profile_opens_selected_npc', async () => {
    const onSelectNpc = vi.fn();
    await act(async () => root.render(createElement(TravelerProfileModal, {
      traveler: { ...创建空角色(), id: 'player', 姓名: '云' },
      npcRecords: [amber, lisa], variableBatches: batches, onSelectNpc, onClose: vi.fn(),
    })));
    expect(host.textContent).toContain('最近好感变化');
    expect(host.querySelector('svg')?.textContent).toContain('云');
    const lisaNode = host.querySelector<SVGGElement>('g[aria-label^="丽莎，"]');
    expect(lisaNode).not.toBeNull();
    await act(async () => lisaNode!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelectNpc).toHaveBeenCalledWith('npc_lisa');
  });

  it('focuses a selected extra after opening the companion page, without its old graph tab', async () => {
    await act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: [amber, extra], onNpcRecordsChange: vi.fn(), turnCount: 3,
      nsfwEnabled: false, focusNpcId: 'npc_extra',
    })));
    expect(host.querySelector('aside')?.textContent).not.toContain('关系图');
    expect(host.querySelector('main')?.textContent).toContain('阿明');
    expect(host.querySelector('main')?.textContent).not.toContain('安柏');
  });

  it('reveals a focused NPC beyond the initial roster window', async () => {
    const records = Array.from({ length: 75 }, (_, index) => ({
      ...创建NPC记录({ 姓名: `路人${String(index + 1).padStart(3, '0')}`, 阶位: 'extra', 初见回合: 1, 原著角色: false }),
      id: `extra-${index + 1}`,
    }));
    await act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: records, onNpcRecordsChange: vi.fn(), turnCount: 3,
      nsfwEnabled: false, focusNpcId: 'extra-75',
    })));
    expect(host.querySelector('aside')?.textContent).toContain('路人075');
    expect(host.querySelector('main')?.textContent).toContain('路人075');
  });

  it('can refocus the same NPC after the player browsed another companion', async () => {
    const base = {
      npcRecords: [amber, extra], onNpcRecordsChange: vi.fn(), turnCount: 3,
      nsfwEnabled: false, focusNpcId: 'npc_extra',
    };
    await act(async () => root.render(createElement(CompanionPanel, { ...base, focusNpcRequest: 1 })));
    expect(host.querySelector('main')?.textContent).toContain('阿明');
    const companionsTab = Array.from(host.querySelectorAll('aside button')).find((candidate) => candidate.textContent?.trim().startsWith('伙伴'));
    await act(async () => (companionsTab as HTMLButtonElement).click());
    expect(host.querySelector('main')?.textContent).toContain('安柏');
    await act(async () => root.render(createElement(CompanionPanel, { ...base, focusNpcRequest: 2 })));
    expect(host.querySelector('main')?.textContent).toContain('阿明');
  });
});
