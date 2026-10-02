import fs from 'node:fs';
const modal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
const service = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const jobs = fs.readFileSync('hooks/useGame/courierBackgroundJobs.ts', 'utf8');
const queue = fs.readFileSync('hooks/useGame/courierReplyQueue.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
/**
 * 源码门禁必须先剥注释再断言：本文件的负向断言曾被实现里的**解释性注释**命中
 * （注释里引用了旧写法），那会变成假红/假绿。这里是本仓库第 N 次踩同一个坑，统一处理。
 */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/^[ \t]*\/\/.*$/gmu, '');
const jobsCode = stripComments(jobs);
const queueCode = stripComments(queue);
assert(modal.includes('const content = draft.trim()') && modal.includes('appendCourierMessage'), 'Courier replies must reject blank content and use immutable message append.');
assert(modal.includes("selected.type === 'system'") && modal.includes("selected.type !== 'system'"), 'system delivery conversations must remain read-only.');
assert(service.includes('readBy: [...message.readBy]'), 'Courier append must preserve read-receipt isolation.');
// 2026-09-29（用户报的第 8 项）：`@全体成员` 按全群人数逐个调用手机模型，
// 旧实现「全或无 + fail-fast」让任何一位成员失败就丢掉整批回复。
// 承重契约：群聊分支必须做**成员级隔离**，且只有全员失败才抛。
assert(jobsCode.includes('let firstMemberError: unknown;') && jobsCode.includes('let failedMembers = 0;'),
  '群聊回信必须逐成员隔离失败（记下 failedMembers 后继续），不得一人失败就整批丢弃。');
assert(jobsCode.includes('if (memberIds.length > 0 && failedMembers >= memberIds.length)'),
  '群聊回信必须保留 fail-fast 下界：只有**全员失败**才抛出。');
assert(/updated = nextCourier;\s*\n\s*continue;/u.test(jobsCode),
  '成员失败时必须先把已成功的回复累积进 updated，否则部分成功也会变成 0 条。');
// 队列：一次失败后新消息必须继续自动派发（失败批次单独记账、只等手动重试）。
assert(queueCode.includes('failedIds') && queueCode.includes('retryRequested'),
  '回信队列必须把「失败批次」与「新消息」分开记账。');
assert(!queueCode.includes('if (!entry.failed) schedule('),
  '回信队列不得在会话失败后停止调度新消息（旧写法会让横幅长期滞留、后续消息永不回信）。');
assert(!queueCode.includes('entry.failed = true'),
  '回信队列不得再用单一 failed 布尔表示整会话失败（新消息会被静默丢弃）。');
// 2026-09-29（用户第 7 项）：朋友圈 @ 角色必须「一定会回应」，且不挤掉自动评论名额。
const moments = stripComments(fs.readFileSync('services/courierMoments.ts', 'utf8'));
const courierModel = stripComments(fs.readFileSync('models/teyvat/courier.ts', 'utf8'));
const momentWorkflow = stripComments(fs.readFileSync('hooks/useGame/courierMomentWorkflow.ts', 'utf8'));
const momentsPanel = stripComments(fs.readFileSync('components/features/Courier/CourierMomentsPanel.tsx', 'utf8'));
assert(moments.includes('MOMENT_AUTO_COMMENT_LIMIT = 3') && moments.includes('export function parseMomentMentions'),
  '朋友圈必须保留 @ 解析与「3 位自动评论」名额常量。');
assert(/momentCommentCapacity/.test(moments) && /MOMENT_AUTO_COMMENT_LIMIT \+ \(post\.mentionIds\?\.length \?\? 0\)/.test(moments),
  '名额必须是 3 + 点名人数（@ 目标不得占用自动评论名额）。');
assert(/seenMentions\.size|mentionIds\.length/.test(courierModel) && /const capacity = 3 \+ mentionIds\.length/.test(courierModel),
  '存档归一化必须按「3 + 点名人数」放开评论/目标名额，否则读档会静默截断 @ 回应。');
assert(/composeMomentCommentLocally/.test(momentWorkflow) && /source: 'local'/.test(momentWorkflow),
  '@ 点名的角色在模型失败时必须由本地写作器补一条回应，并标记 source=local。');
assert(/\.\.\.mentionIds,/.test(momentWorkflow),
  '@ 目标与自动评论者必须取并集（旧的三元选择会让自动评论者全部消失）。');
assert(momentsPanel.includes('（本地回应）') && momentsPanel.includes('一定会回应'),
  '界面必须显式标注「本地回应」并说明 @ 一定会回应（不得把本地文案伪装成模型输出）。');
console.log('courier reply quality regression ok');
