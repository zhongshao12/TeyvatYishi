import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const chatModel = fs.readFileSync('models/chat.ts', 'utf8');
const bookmarks = fs.readFileSync('utils/storyBookmarks.ts', 'utf8');
const panel = fs.readFileSync('components/features/Chat/ChatBookmarksPanel.tsx', 'utf8');
const chatList = fs.readFileSync('components/features/Chat/ChatList.tsx', 'utf8');
const turnItem = fs.readFileSync('components/features/Chat/TurnItem.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(chatModel.includes('bookmark?: { title: string; note?: string; createdAt: number }'), 'chat message must carry bookmark field.');
assert(bookmarks.includes('提取剧情书签'), 'bookmark utils must extract bookmarks.');
assert(bookmarks.includes('切换剧情书签'), 'bookmark utils must toggle bookmarks immutably.');
assert(panel.includes('ChatBookmarksPanel'), 'bookmark panel component must exist.');
// 2026-09-02 项目主要求：聊天区不再常驻书签面板（按钮与面板已移除），数据与工具链保留。
assert(!chatList.includes('ChatBookmarksPanel'), 'ChatList must not render the bookmark panel overlay.');
assert(chatList.includes('chat-msg-'), 'ChatList must give messages anchor ids for jumping.');
assert(turnItem.includes('onToggleBookmark'), 'TurnItem must accept bookmark toggle callback.');
assert(turnItem.includes('label="书签"'), 'AI turn toolbar must expose a bookmark button.');
assert(app.includes('切换剧情书签'), 'App must wire bookmark toggle into chat history.');
console.log('story bookmark regression ok');
