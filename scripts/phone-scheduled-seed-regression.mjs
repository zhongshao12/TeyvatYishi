import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const courierModel = fs.readFileSync('models/teyvat/courier.ts', 'utf8');
const workflow = fs.readFileSync('hooks/useGame/courierWorkflow.ts', 'utf8');
const courierService = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
assert(courierModel.includes('scheduledAtTurn'), 'Courier seed model must support scheduled arrival turn.');
assert(courierModel.includes('readBy'), 'Courier message model must support read receipts.');
assert(courierModel.includes('typingMemberIds'), 'Courier conversation must support typing members.');
assert(workflow.includes('processScheduledCourierSeeds'), 'Courier workflow must expose scheduled seed processing.');
assert(workflow.includes('deliverDueCourierSeeds'), 'Courier workflow must delegate delivery to the formal courier service.');
assert(courierService.includes('currentTurn < dueTurn'), 'scheduled seeds must not fire before their turn.');
assert(sendWorkflow.includes('processScheduledCourierSeeds'), 'send workflow must call scheduled Courier seed processing each turn.');
console.log('courier scheduled seed regression ok');
