import fs from 'node:fs';
// 迁移: 联系人工具区已从 CourierModal.tsx 抽到 components/features/Courier/CourierContactTools.tsx，
// 理由: 手机 UI 拆分；openContactConversation 与联系人聊天按钮随工具区一起搬迁，两文件合读。
const modal = [
  fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8'),
  fs.readFileSync('components/features/Courier/CourierContactTools.tsx', 'utf8'),
].join('\n');
if (!modal.includes('grid-cols-1') || !modal.includes('sm:grid-cols-[minmax(220px,30%)_1fr]')) throw new Error('Courier must collapse to one column before the small breakpoint.');
if (!modal.includes('openContactConversation')) throw new Error('A phone contact must be able to open or create a private conversation.');
if (!modal.includes('aria-label={`与 ${contact.name} 聊天`}')) throw new Error('Phone contacts must expose a clickable, accessible chat action.');
console.log('courier mobile layout regression ok');
