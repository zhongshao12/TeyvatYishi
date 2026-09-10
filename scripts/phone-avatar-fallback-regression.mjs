import fs from 'node:fs';
const modal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
if (!modal.includes('message.avatar') || !modal.includes('message.senderName.trim().charAt(0)')) throw new Error('Courier must render message avatars with a deterministic sender-name fallback.');
console.log('courier avatar fallback regression ok');
