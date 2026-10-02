import fs from 'node:fs';

/**
 * 失败结算中心门禁（2026-09-29，用户第 5 项）。
 *
 * 行为细节由 `tests/unit/failureCenter.test.ts` 覆盖；这里钉「承重结构」：
 * ① 失败必须在**单一漏斗**上登记（队列 + error toast），否则新代码会绕过中心；
 * ② 曾经静默失败的两处（恢复日志、诊断报告自身）不得再静默；
 * ③ 唯一带「重试本回合」的失败提示不得再定时消失；
 * ④ 中心必须能从界面重试/解决/忽略并展开原始材料。
 */

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^[ \t]*\/\/.*$/gmu, '');
const read = (file) => stripComments(fs.readFileSync(file, 'utf8'));

const queue = read('hooks/useGame/workflowQueue.ts');
const toast = read('utils/toastStore.ts');
const recovery = read('services/workflowRecovery.ts');
const apiReport = read('services/ai/apiErrorReportService.ts');
const send = read('hooks/useGame/sendWorkflow.ts');
const drawer = read('components/features/Variable/VariableDrawer.tsx');
const model = read('models/failureCenter.ts');

assert(/if \(status === 'failed'\)\s*\{[\s\S]{0,400}reportFailure\(/.test(queue),
  '后台任务失败必须在队列这个唯一漏斗上登记进失败结算中心。');
assert(queue.includes('QUEUE_FAILURE_SOURCE'), '队列失败必须带子系统来源（用于分组与门禁断言）。');
assert(/if \(kind === 'error'\)/.test(toast) && toast.includes('reportFailureFromToast'),
  'error toast 必须同栈登记进失败结算中心（否则提示消失后无从追查）。');
assert(recovery.includes('recordRecoveryFailure') && /recovery_journal_unreadable/.test(recovery),
  '恢复日志读取失败必须留下可查记录，不得只写 console 后返回 null。');
assert(apiReport.includes('api_error_report_unwritable'),
  '诊断报告自身写失败必须留下记录（否则「没有报告」会被误读成「没有出错」）。');
assert(!/durationMs:\s*10000/.test(send),
  '失败提示不得再定时消失（原先 10 秒后连「重试本回合」按钮一起消失）。');
assert(send.includes('registerFailureRetry('), '重试入口必须注册到中心，toast 关闭后仍可重试。');
assert(/onClick=\{\(\) => \{ void runFailureRetry\(item\.id\); \}\}/.test(drawer),
  '中心面板必须能直接发起重试。');
assert(drawer.includes('标记已解决') && drawer.includes('忽略'),
  '中心面板必须支持标记已解决与忽略（否则清单只会越积越多）。');
assert(drawer.includes('查看原始材料'), '中心面板必须能展开原始诊断材料。');
assert(/status === 'resolved' \? 0/.test(model) && /status === 'ignored' \? 1/.test(model),
  '上限淘汰必须先吃 resolved 再吃 ignored，未解决的失败不得被静默挤掉。');
assert(model.includes('FAILURE_CENTER_LIMIT = 200'), '失败结算清单上限应为 200。');

console.log('failure center regression ok');
