import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/courier.ts', 'utf8');
const modal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(model.includes("type: 'private' | 'group' | 'system'") && model.includes('participantIds: string[]'), 'Courier must preserve private/group/system conversation contracts.');
assert(model.includes('typingMemberIds: string[]') && model.includes('readBy: string[]'), 'Courier groups must retain typing and read-receipt state.');
assert(modal.includes("conversation.type === 'group'") && modal.includes("group: '群聊'"), 'Phone UI must distinguish group conversations.');
console.log('courier group workflow regression ok');
