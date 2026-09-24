import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * App.tsx 里给 ref 赋值必须是「提交后」发生的副作用（useEffect），不能写在渲染期。
 *
 * 理由：渲染期写 ref 在 React 19 并发渲染下会把 ref 指向**被丢弃的渲染**闭包——
 * 那次渲染可能永远不会提交，而 ref 已经被它改写，后续从 ref 取到的回调就是错的。
 * courierDispatchRef 是「从 ref 里取最新回调」的桥：
 * 它的取值方是异步手机回信队列，渲染期写入没有存在的必要。
 */
describe('App render-phase ref writes', () => {
  const app = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');

  it('assigns the courier dispatch ref inside an effect instead of during render', () => {
    const assignment = 'courierDispatchRef.current = dispatchCourierReply;';
    const assignmentIndex = app.indexOf(assignment);
    expect(assignmentIndex).toBeGreaterThan(-1);

    // 渲染期赋值的形态：组件体缩进（2 空格）顶格写着这条赋值。
    expect(app).not.toMatch(/^ {2}courierDispatchRef\.current = dispatchCourierReply;$/m);

    const effectIndex = app.lastIndexOf('useEffect(() => {', assignmentIndex);
    expect(effectIndex).toBeGreaterThan(-1);
    const effectEnd = app.indexOf('}, [dispatchCourierReply]);', effectIndex);
    expect(effectEnd).toBeGreaterThan(assignmentIndex);
  });

  it('keeps the courier reply handler bridged for its asynchronous callers', () => {
    // 守卫不能靠删除桥来满足：队列仍必须调用已提交的最新处理器。
    expect(app).toContain('dispatch: (batch) => courierDispatchRef.current(batch)');
    expect(app).toContain('courierReplyQueue.enqueue({ conversationId, messageId, sessionId: latestStateRef.current.getGameSessionId() });');
  });
});
