import fs from 'node:fs';
// 迁移: 消息气泡渲染已从 CourierModal.tsx 抽到 components/features/Courier/CourierMessageTimeline.tsx，
// 理由: 手机 UI 拆分；发送者首字母兜底头像逻辑随气泡一起搬迁，两文件合读。
const modal = [
  fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8'),
  fs.readFileSync('components/features/Courier/CourierMessageTimeline.tsx', 'utf8'),
].join('\n');
if (!modal.includes('message.avatar') || !modal.includes('message.senderName.trim().charAt(0)')) throw new Error('Courier must render message avatars with a deterministic sender-name fallback.');
console.log('courier avatar fallback regression ok');
