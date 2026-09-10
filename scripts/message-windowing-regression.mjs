import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const chatList = fs.readFileSync('components/features/Chat/ChatList.tsx', 'utf8');
assert(chatList.includes('INITIAL_RENDER_TURNS'), 'ChatList must keep an initial render window.');
assert(chatList.includes('RENDER_TURN_INCREMENT'), 'ChatList must support incremental history loading.');
console.log('message windowing regression ok');
