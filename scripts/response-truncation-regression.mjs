import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

const sendWorkflow = readWorkflowSources();
const textClient = fs.readFileSync('services/ai/text/index.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !fs.readFileSync('services/ai/responseParser.ts', 'utf8').includes('isTruncatedResponse'),
  'responseParser 不应再导出抗截断判断函数。',
);

assert(
  !sendWorkflow.includes('isTruncatedResponse') &&
    !sendWorkflow.includes('主剧情工作流·抗截断') &&
    !sendWorkflow.includes('上一段输出被截断，请从中断处直接续写'),
  '主剧情必须停用截断续写自动重试，避免误判后污染历史。',
);

assert(
  !sendWorkflow.includes("|| result.finishReason === 'length' || result.finishReason === 'max_tokens'"),
  '主剧情抗截断禁止仅凭供应商 finishReason=length/max_tokens 触发续写。',
);

// 迁移: 旧正向注释 `主剧情不再执行“截断续写”自动重试` 与
//   `JSON 合同失败由 parseResponse 抛出稳定错误并进入整回合重试，不做 tagged fallback。`
//   -> 新工作流层的真实契约文本：
//      - `请完全重写，不要延续上一版残缺输出。`（mainNarrativeRequestStage.ts buildDeepSeekProtocolRetryGuard）
//        = 重试是「整回合重写」，不是从中断处续写；
//      - `上一版 JSON 未通过 NarrativeTurn 协议校验。` = JSON 合同失败进入整回合重试；
//      - `runMainNarrativeAttempts` = 整回合重试循环本体。
//   理由: 说明性长注释被改写为上述可执行文案，停用「截断续写自动重试」的意图未变。
//   负向断言保留且仍为真：工作流层不得回退到 tagged 解析，也不得出现 repairTags 合同。
assert(
  sendWorkflow.includes('请完全重写，不要延续上一版残缺输出。') &&
    sendWorkflow.includes('上一版 JSON 未通过 NarrativeTurn 协议校验。') &&
    sendWorkflow.includes('runMainNarrativeAttempts') &&
    !sendWorkflow.includes('parseStoredLegacyResponse') &&
    !sendWorkflow.includes('repairTags:') &&
    !textClient.includes('repairTags?:'),
  'sendWorkflow 必须记录停用抗截断续写的原因和兜底方式。',
);

console.log('response truncation regression ok');
