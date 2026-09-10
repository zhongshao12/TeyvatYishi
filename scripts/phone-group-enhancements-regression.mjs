import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/courier.ts', 'utf8');
const service = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const field of ['inviteCode?: string', 'announcement?: string', 'creatorId?: string', 'typingMemberIds: string[]']) assert(model.includes(field), `Courier group enhancement missing ${field}.`);
assert(service.includes('calculateCourierUnread') && service.includes('conversation.unread'), 'Courier group updates must feed deterministic unread totals.');
console.log('courier group enhancements regression ok');
