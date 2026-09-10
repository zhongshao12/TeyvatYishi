import type { 聊天消息 } from '@/models/chat';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';

export interface 剧情书签 {
  messageId: string;
  title: string;
  note?: string;
  turn: number;
  createdAt: number;
}

function 默认标题(message: 聊天消息): string {
  const body = message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content?.trim() || "";
  const preview = body.replace(/\s+/g, ' ').slice(0, 24);
  return preview ? (message.gameTime ? `第 ${message.gameTime} 回合 · ${preview}` : preview) : "未命名书签";
}

/** 从聊天记录提取全部书签，按创建时间倒序。 */
export function 提取剧情书签(messages: 聊天消息[]): 剧情书签[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message.bookmark)
    .map((message) => ({
      messageId: message.id,
      title: message.bookmark!.title || 默认标题(message),
      note: message.bookmark!.note,
      turn: Number(message.gameTime) || 0,
      createdAt: message.bookmark!.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 添加或移除书签（不可变更新）。 */
export function 切换剧情书签(messages: 聊天消息[], messageId: string, note?: string): 聊天消息[] {
  const target = (Array.isArray(messages) ? messages : []).find((message) => message.id === messageId);
  if (!target) return messages;
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (message.id !== messageId) return message;
    if (message.bookmark) {
      const { bookmark: _removed, ...rest } = message;
      void _removed;
      return rest;
    }
    return {
      ...message,
      bookmark: { title: 默认标题(message), note, createdAt: Date.now() },
    };
  });
}

export interface 回放筛选 {
  keyword?: string;
  fromIndex?: number;
  toIndex?: number;
}

/** 按关键词与回合范围筛选回放消息（正文与内容匹配关键词）。 */
export function 筛选回放消息(messages: 聊天消息[], filter: 回放筛选): 聊天消息[] {
  const list = Array.isArray(messages) ? messages : [];
  const sliced = list.slice(filter.fromIndex ?? 0, filter.toIndex ?? list.length);
  const keyword = filter.keyword?.trim();
  if (!keyword) return sliced;
  const needle = keyword.toLowerCase();
  return sliced.filter((message) => {
    const body = message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content?.trim() || "";
    const sender = message.parsedResponse?.body.length ? "AI" : "玩家";
    return body.toLowerCase().includes(needle) || sender.toLowerCase().includes(needle);
  });
}
