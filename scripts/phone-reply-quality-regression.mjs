import fs from 'node:fs';
const modal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
const service = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(modal.includes('const content = draft.trim()') && modal.includes('appendCourierMessage'), 'Courier replies must reject blank content and use immutable message append.');
assert(modal.includes("selected.type === 'system'") && modal.includes("selected.type !== 'system'"), 'system delivery conversations must remain read-only.');
assert(service.includes('readBy: [...message.readBy]'), 'Courier append must preserve read-receipt isolation.');
console.log('courier reply quality regression ok');
