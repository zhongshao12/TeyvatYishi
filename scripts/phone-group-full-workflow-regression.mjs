import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/courier.ts', 'utf8');
// 迁移: 会话列表已从 CourierModal.tsx 抽到 components/features/Courier/CourierConversationList.tsx，
// 理由: 手机 UI 拆分；群聊类型判定与「群聊」标签随列表一起搬迁，两文件合读。
const modal = [
  fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8'),
  fs.readFileSync('components/features/Courier/CourierConversationList.tsx', 'utf8'),
].join('\n');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(model.includes("type: 'private' | 'group' | 'system'") && model.includes('participantIds: string[]'), 'Courier must preserve private/group/system conversation contracts.');
assert(model.includes('typingMemberIds: string[]') && model.includes('readBy: string[]'), 'Courier groups must retain typing and read-receipt state.');
assert(modal.includes("conversation.type === 'group'") && modal.includes("group: '群聊'"), 'Phone UI must distinguish group conversations.');
console.log('courier group workflow regression ok');
