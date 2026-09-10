import fs from 'node:fs';
const modal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
if (!modal.includes('grid-cols-1') || !modal.includes('sm:grid-cols-[minmax(220px,30%)_1fr]')) throw new Error('Courier must collapse to one column before the small breakpoint.');
if (!modal.includes('openContactConversation')) throw new Error('A phone contact must be able to open or create a private conversation.');
if (!modal.includes('aria-label={`与 ${contact.name} 聊天`}')) throw new Error('Phone contacts must expose a clickable, accessible chat action.');
console.log('courier mobile layout regression ok');
