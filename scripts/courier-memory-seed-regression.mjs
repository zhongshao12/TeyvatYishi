import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function importBundled(entryPoint) {
  const result = await build({ absWorkingDir: process.cwd(), entryPoints: [entryPoint], bundle: true, platform: 'node', format: 'esm', write: false, alias: { '@': process.cwd() }, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const workflow = await importBundled('hooks/useGame/courierWorkflow.ts');
const system = { contacts: [{ id: 'amber', name: '安柏', available: true }], letters: [], conversations: [{ id: 'amber', title: '安柏', participantIds: ['amber'], messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 }], deliverySeeds: [{ id: 'seed', senderId: 'amber', reason: '巡逻', turn: 2, source: 'system', triggerType: 'custom', priority: 'normal', targetType: 'private', targetId: 'amber', title: '来信', context: '巡逻结束', relatedNpcIds: ['amber'], status: 'pending' }], unreadTotal: 0, wallpapers: {} };
const scheduled = workflow.processScheduledCourierSeeds(system, 2, 2);
assert.equal(scheduled.due.length, 1);
assert.equal(scheduled.next.deliverySeeds[0].status, 'generated');
// 来信按句读拆成 1~N 条：条数不定，但全部携带种子 id、未读按一封计 1。
assert.ok(scheduled.next.conversations[0].messages.length >= 1);
assert.ok(scheduled.next.conversations[0].messages.every((message) => message.sourceSeedId === 'seed'));
assert.equal(scheduled.next.conversations[0].unread, 1);
assert.equal(scheduled.next.unreadTotal, 1);
assert.equal(system.deliverySeeds[0].status, 'pending');
assert.equal(system.conversations[0].messages.length, 0);
const repeated = workflow.processScheduledCourierSeeds(scheduled.next, 3, 3);
assert.equal(repeated.due.length, 0);
assert.equal(repeated.next.conversations[0].messages.length, scheduled.next.conversations[0].messages.length);
assert.equal(repeated.next.conversations[0].unread, 1);
console.log('courier memory seed regression passed');
