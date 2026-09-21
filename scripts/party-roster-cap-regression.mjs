import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * 队伍编制契约（玩家要求）：
 * 1. 队伍列表里不再出现玩家本人（旅行者）；
 * 2. 队伍上限为 4 名角色（不是「旅行者 + 3」）。
 *
 * 这两点都必须锁在源码层：它们是纯 UI 编制，没有行为测试能覆盖。
 * 相关行为（同行状态决定成员）由 CompanionPanel 的邀请/请离逻辑负责。
 */

const leftPanel = fs.readFileSync('components/layout/LeftPanel.tsx', 'utf8');
const companionPanel = fs.readFileSync('components/features/GameSystems/CompanionPanel.tsx', 'utf8');
const renderers = fs.readFileSync('components/features/Chat/MessageRenderers.tsx', 'utf8');

assert.match(leftPanel, /\.slice\(0, 4\)/, '队伍必须最多容纳 4 名角色。');
assert.match(leftPanel, /\{partyMembers\.length\}\/4/, '队伍计数必须是 已入队/4，不带玩家那一位。');
assert.match(leftPanel, /Math\.max\(0, 4 - partyMembers\.length\)/, '空位数量必须按 4 个角色位计算。');
assert.doesNotMatch(leftPanel, /partyMembers\.length \+ 1/, '队伍计数不能再把玩家本人算进去（+1 已移除）。');
assert.doesNotMatch(
  leftPanel,
  /title=\{traveler\.姓名 \|\| '旅行者'\}/,
  '队伍列表里不能再渲染玩家本人的头像块。',
);

assert.match(companionPanel, /filter\(\(item\) => item\.同行\)\.length >= 4/, '邀请同伴时的满员判定必须是 4。');
assert.match(companionPanel, /队伍已满（最多 4 名同伴）/, '满员提示必须说明上限是 4 名同伴。');
assert.doesNotMatch(companionPanel, /旅行者 \+ 3 名同伴/, '满员提示不能再写成「旅行者 + 3 名同伴」。');

// 玩家本人的身份展示仍在旅行者档案与正文渲染里，只是不再占用队伍位。
assert.match(renderers, /traveler/i, '正文渲染仍必须有旅行者身份，队伍改动不得影响玩家本体。');

console.log('party roster cap regression ok');
