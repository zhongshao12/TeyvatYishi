import assert from 'node:assert/strict';
import { readWorkflowSources, readWorkflowFile } from './lib/workflowSources.mjs';
import { createVisibilityBufferedPublisher } from '../utils/visibilityBufferedPublisher.ts';

let hidden = true;
let listener = null;
let unsubscribeCount = 0;
const commits = [];

const publisher = createVisibilityBufferedPublisher({
  source: {
    isHidden: () => hidden,
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
        unsubscribeCount += 1;
      };
    },
  },
  commit: (text) => commits.push(text),
});

for (let index = 1; index <= 100; index += 1) {
  assert.equal(publisher.bufferWhenHidden(`chunk-${index}`), true);
}
assert.deepEqual(commits, [], 'hidden chunks must not commit UI updates');

hidden = false;
listener?.();
assert.deepEqual(commits, ['chunk-100'], 'visibility restore must flush only the latest text once');

listener?.();
publisher.flush();
assert.deepEqual(commits, ['chunk-100'], 'clean buffers must not be committed twice');
assert.equal(publisher.bufferWhenHidden('visible'), false, 'visible text must remain on the normal preview path');

hidden = true;
publisher.bufferWhenHidden('after-dispose');
publisher.dispose();
hidden = false;
listener?.();
publisher.flush();
assert.equal(unsubscribeCount, 1, 'dispose must remove the visibility listener exactly once');
assert.deepEqual(commits, ['chunk-100'], 'disposed publishers must never flush buffered content');

// 迁移: 主叙事流式会话已从 sendWorkflow.ts 抽到 hooks/useGame/mainNarrativeStreamingSession.ts，
// 理由: 可见预览 epoch 失效逻辑随流式会话一起搬迁；按「主剧情工作流」整体读取。
// 两个文件都在 WORKFLOW_FILES 登记表中，所以手工双文件数组收敛为 readWorkflowSources()。
const sendWorkflow = readWorkflowSources();
assert(sendWorkflow.includes('deltaPreviewEpoch !== previewEpoch'), 'queued visible previews must be invalidated across hide/show transitions');
assert(
  !readWorkflowFile('hooks/useGame/mainNarrativeStreamingSession.ts').includes(
    'if (isPageHidden()) {\n                  state.setStreamingMessage(streamedText);',
  ),
  'hidden preview queues must never commit React state',
);

console.log('background stream regression ok');
