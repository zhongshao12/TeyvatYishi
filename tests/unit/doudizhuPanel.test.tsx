// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoudizhuPanel } from '../../components/features/GameSystems/DoudizhuPanel';
import { GAME_MENU_ITEMS } from '../../data/gameMenu';
import { createEmptyDoudizhuState } from '../../models/teyvat/doudizhu';
import { normalizeTeyvatNpcRecords } from '../../models/teyvat/character';
import { applyDoudizhuMove, startDoudizhuGame } from '../../services/doudizhu/game';
import { createEmptyTeyvatGameState } from '../../models/teyvat/state';
import { findDoudizhuTerminalTurn } from '../helpers/doudizhuScenario';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = '';
});

const npcs = normalizeTeyvatNpcRecords([
  { id: 'amber-id', 姓名: '安柏', affinity: 30, roleTier: 'companion' },
  { id: 'lisa-id', 姓名: '丽莎', affinity: 80, roleTier: 'companion' },
  { id: 'kaeya-id', 姓名: '凯亚', affinity: 50, roleTier: 'companion' },
]);

function renderPanel(state = createEmptyDoudizhuState(), onAction = vi.fn(), roster = npcs) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<DoudizhuPanel state={state} npcs={roster} onAction={onAction} />));
  return { host, onAction };
}

const click = (element: Element | null) => {
  if (!element) throw new Error('missing element');
  act(() => (element as HTMLElement).click());
};

describe('Dou Dizhu panel', () => {
  it('allows two distinct known companions to be invited', () => {
    const { host, onAction } = renderPanel();
    const selectors = host.querySelectorAll('select');
    expect(selectors).toHaveLength(2);
    expect(host.textContent).toContain('安柏');
    expect(host.textContent).toContain('丽莎');
    act(() => {
      selectors[0]!.value = 'amber-id';
      selectors[0]!.dispatchEvent(new Event('change', { bubbles: true }));
      selectors[1]!.value = 'amber-id';
      selectors[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('开始')) ?? null);
    expect(onAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain('不同');
    act(() => {
      selectors[1]!.value = 'lisa-id';
      selectors[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('开始')) ?? null);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', npcIds: ['amber-id', 'lisa-id'] }));
  });

  it('restores a bidding table with native keyboard-operable buttons', () => {
    const game = startDoudizhuGame(['amber-id', 'lisa-id'], 3, 'g');
    const { host, onAction } = renderPanel({ ...createEmptyDoudizhuState(), currentGame: game });
    expect(host.textContent).toContain('叫分');
    expect(host.textContent).toContain('17');
    expect(host.querySelectorAll('button[data-card-id]')).toHaveLength(17);
    const bid = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('叫 1 分'))!;
    expect(bid instanceof HTMLButtonElement).toBe(true);
    expect(bid.tabIndex).toBeGreaterThanOrEqual(0);
    click(bid);
    expect(onAction).toHaveBeenCalledWith({ type: 'bid', points: 1 });
  });

  it('reveals the landlord bottom cards after bidding', () => {
    let game = startDoudizhuGame(['amber-id', 'lisa-id'], 3, 'g');
    game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 3 });
    const { host } = renderPanel({ ...createEmptyDoudizhuState(), currentGame: game });
    expect(host.textContent).toContain('底牌');
    expect(host.querySelectorAll('button[data-card-id]')).toHaveLength(20);
  });

  it('selects hand cards, explains invalid play, and shows recent public moves', () => {
    let game = startDoudizhuGame(['amber-id', 'lisa-id'], 3, 'g');
    game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 3 });
    const { host, onAction } = renderPanel({ ...createEmptyDoudizhuState(), currentGame: game });
    click([...host.querySelectorAll('button')].find((button) => button.textContent === '出牌') ?? null);
    expect(host.textContent).toContain('选择');
    const card = host.querySelector<HTMLButtonElement>('button[data-card-id]')!;
    click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    click([...host.querySelectorAll('button')].find((button) => button.textContent === '出牌') ?? null);
    expect(onAction).toHaveBeenCalledWith({ type: 'play', cards: [Number(card.dataset.cardId)] });
    const progressed = applyDoudizhuMove(game, { type: 'play', seat: 0, cards: [game.hands[0][0]!] });
    const passed = applyDoudizhuMove(progressed, { type: 'pass', seat: 1 });
    const restored = renderPanel({ ...createEmptyDoudizhuState(), currentGame: passed });
    expect(restored.host.textContent).toContain('最近出牌');
    expect(restored.host.textContent).toContain('不要');
    expect(restored.host.textContent).toMatch(/交给你|由你继续|表现一下|观察下一轮|这轮不要/);
  });

  it('shows result rewards and recovery when an invited companion was archived', () => {
    let game = startDoudizhuGame(['amber-id', 'lisa-id'], 3, 'g');
    game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 3 });
    const { after } = findDoudizhuTerminalTurn(() => {
      const state = createEmptyTeyvatGameState();
      state.NPC = npcs;
      return state;
    }, ['amber-id', 'lisa-id'], 'landlord');
    const finished = after.斗地主.currentGame!;
    const { host } = renderPanel({ ...createEmptyDoudizhuState(), currentGame: finished });
    expect(host.textContent).toContain('地主获胜');
    expect(host.textContent).toContain('+5');
    const archived = renderPanel({ ...createEmptyDoudizhuState(), currentGame: game }, vi.fn(), [npcs[0]!, { ...npcs[1]!, archived: true }]);
    expect(archived.host.textContent).toMatch(/归档|无法继续/);
    expect([...archived.host.querySelectorAll('button')].some((button) => button.textContent?.includes('退出'))).toBe(true);
  });

  it('relabels the old timeline route without changing its ID', () => {
    expect(GAME_MENU_ITEMS.find((item) => item.id === 'timeline')).toMatchObject({ label: '斗地主' });
  });
});
