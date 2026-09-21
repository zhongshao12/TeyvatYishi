import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, getToasts, pushToast } from '@/utils/toastStore';

/**
 * B1：错误提示与带「撤销」的提示**不得被后续提示挤掉**。
 * 修复前 `toasts.slice(-(MAX_VISIBLE - 1))` 不分 kind：error 因为不自动消失而长期占位，
 * 一旦同一回合再推 4 条提示就被静默挤出数组 —— 「自动保存失败」消失、撤销窗被提前掐断。
 */

const titles = () => getToasts().map((toast) => toast.title);

describe('toast 淘汰策略', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const toast of [...getToasts()]) dismissToast(toast.id);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const toast of [...getToasts()]) dismissToast(toast.id);
  });

  it('evicts the oldest plain toast beyond the visible limit', () => {
    for (let index = 0; index < 5; index += 1) pushToast({ title: `提示${index}` });

    expect(titles()).toEqual(['提示1', '提示2', '提示3', '提示4']);
  });

  it('never evicts an error toast', () => {
    pushToast({ kind: 'error', title: '自动保存失败' });
    for (let index = 0; index < 6; index += 1) pushToast({ title: `提示${index}` });

    expect(titles()).toContain('自动保存失败');
  });

  it('never evicts a toast that carries an undo action', () => {
    pushToast({ title: '已丢弃物品', action: { label: '撤销', run: () => undefined } });
    for (let index = 0; index < 6; index += 1) pushToast({ title: `提示${index}` });

    expect(titles()).toContain('已丢弃物品');
  });

  it('keeps the visible limit for plain toasts even when pinned toasts exist', () => {
    pushToast({ kind: 'error', title: '错误一' });
    pushToast({ kind: 'error', title: '错误二' });
    for (let index = 0; index < 6; index += 1) pushToast({ title: `提示${index}` });

    expect(titles()).toContain('错误一');
    expect(titles()).toContain('错误二');
    // 4 个可见名额 - 2 个常驻错误 = 2 个普通提示
    expect(titles().filter((title) => title.startsWith('提示'))).toEqual(['提示4', '提示5']);
  });

  it('drops a new plain toast instead of evicting pinned ones when every slot is pinned', () => {
    for (let index = 0; index < 4; index += 1) pushToast({ kind: 'error', title: `错误${index}` });
    pushToast({ title: '普通提示' });

    expect(titles()).not.toContain('普通提示');
    expect(titles()).toHaveLength(4);
  });

  it('still auto-dismisses a plain toast after its duration', () => {
    pushToast({ title: '短提示' });
    vi.advanceTimersByTime(5000);

    expect(titles()).toEqual([]);
  });

  it('keeps an error toast after the plain duration elapses', () => {
    pushToast({ kind: 'error', title: '错误' });
    vi.advanceTimersByTime(60_000);

    expect(titles()).toEqual(['错误']);
  });
});
