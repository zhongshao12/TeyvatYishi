import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';

/**
 * 契约来源：utils/rafCoalescedSetter.ts
 * 生产调用点：hooks/useGame/aiMessageStage.ts:48、hooks/useGame/mainNarrativeStreamingStage.ts:47、
 *             hooks/useGame/sendWorkflow.ts:238。
 * 关键行为：高频 set 每帧最多提交一次、最新值胜出；flush 必须同步提交并取消挂起的帧；
 * cancel 只取消不提交（否则流式结束时会把半截文本写进 state 或漏掉最终文本）。
 */
describe('rafCoalescedSetter', () => {
  let frames: FrameRequestCallback[];
  let cancelSpy: ReturnType<typeof vi.fn>;
  let nextFrameId: number;

  beforeEach(() => {
    frames = [];
    nextFrameId = 0;
    cancelSpy = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const runFrame = () => {
    const frame = frames.shift();
    frame?.(0);
  };

  it('coalesces repeated set calls into a single commit with the latest value', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.set('a');
    setter.set('ab');
    setter.set('abc');

    expect(frames).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();

    runFrame();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith('abc');
  });

  it('schedules a fresh frame for each animation frame boundary', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.set('a');
    runFrame();
    setter.set('b');
    runFrame();
    setter.set('c');
    runFrame();

    expect(commit.mock.calls.map(([value]) => value)).toEqual(['a', 'b', 'c']);
    expect(frames).toHaveLength(0);
  });

  it('flushes immediately, cancels the pending frame and does not double-commit', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.set('partial');
    setter.flush('final');

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith('final');
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    runFrame();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('flushes even when there is nothing pending, so terminal states are never delayed', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.flush('');
    setter.flush('done');

    expect(commit.mock.calls.map(([value]) => value)).toEqual(['', 'done']);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('cancels a pending frame without committing', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.set('dropped');
    setter.cancel();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    runFrame();
    expect(commit).not.toHaveBeenCalled();
  });

  it('is safe to cancel twice and to set again after a cancel', () => {
    const commit = vi.fn();
    const setter = createRafCoalescedSetter(commit);

    setter.set('a');
    setter.cancel();
    setter.cancel();
    setter.set('b');
    runFrame();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith('b');
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
