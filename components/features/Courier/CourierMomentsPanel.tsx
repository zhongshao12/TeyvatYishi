import { useState } from 'react';
import type { CourierMoment } from '@/models/teyvat/courier';

interface CourierMomentsPanelProps {
  moments: readonly CourierMoment[];
  travelerName: string;
  eligibleCommenterCount: number;
  canGenerateComments: boolean;
  commenterNames: ReadonlyMap<string, string>;
  onPublish: (content: string) => boolean;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string, revision: number, npcId: string) => void;
}

const fieldStyle = { background: 'rgba(255,252,240,0.76)', color: 'rgb(var(--tj-text-primary))', border: '1px solid rgba(var(--tj-accent-primary),0.35)' };

export function CourierMomentsPanel({ moments, travelerName, eligibleCommenterCount, canGenerateComments, commenterNames, onPublish, onEdit, onDelete, onRetry }: CourierMomentsPanelProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const canPublish = Boolean(draft.trim()) && draft.length <= 500;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="朋友圈">
      <div className="border-b border-[rgba(var(--tj-accent-primary),0.24)] px-4 py-4">
        <p className="mb-2 text-xs leading-5 text-[rgb(var(--tj-text-secondary))]">
          当前有 {eligibleCommenterCount} 位角色符合评论条件：须是手机联系人，且达到生死挚友（好感度超过 100）。每条动态最多有 3 位角色评论。
          {eligibleCommenterCount === 0
            ? '暂无符合条件的角色，不会收到评论。'
            : !canGenerateComments ? '手机评论接口未配置，不会收到新评论。' : '接口已填写，但尚未测试连接。'}
        </p>
        <label htmlFor="courier-moment-draft" className="mb-2 block font-serif text-sm">写下旅途此刻</label>
        <textarea
          id="courier-moment-draft" aria-label="写朋友圈" value={draft} maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="今天想和朋友们分享什么？" rows={3}
          className="w-full resize-y rounded-md p-3 text-sm leading-6 outline-offset-2" style={fieldStyle}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-[rgb(var(--tj-text-secondary))]">{draft.length}/500 · 仅你可以发布动态</span>
          <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-5 text-sm disabled:opacity-45" disabled={!canPublish} onClick={() => {
            if (onPublish(draft.trim())) setDraft('');
          }}>发布</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {!moments.length && <p className="py-10 text-center text-sm text-[rgb(var(--tj-text-secondary))]">还没有动态。把旅途的第一句话留在这里吧。</p>}
        {moments.map((post) => (
          <article key={post.id} className="rounded-lg border border-[rgba(var(--tj-accent-primary),0.28)] bg-[rgba(255,252,240,0.38)] p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="font-serif text-sm">{travelerName || '旅行者'}</strong>
              <time dateTime={new Date(post.createdAt).toISOString()} title="现实设备时间，与游戏内时间不同" className="text-xs text-[rgb(var(--tj-text-secondary))]">第 {post.turn} 回合 · 现实发布时间：{new Date(post.createdAt).toLocaleString('zh-CN')}</time>
            </div>
            {editingId === post.id ? (
              <div>
                <textarea aria-label="编辑朋友圈" value={editDraft} maxLength={500} onChange={(event) => setEditDraft(event.target.value)} rows={3} className="w-full resize-y rounded-md p-3 text-sm" style={fieldStyle} />
                <p className="mt-2 text-xs leading-5 text-[rgb(var(--tj-text-secondary))]">保存修改将清空旧评论，并按新内容重新生成。</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setEditingId(null)}>取消</button>
                  <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-3 text-sm disabled:opacity-45" disabled={!editDraft.trim()} onClick={() => { onEdit(post.id, editDraft.trim()); setEditingId(null); }}>保存修改</button>
                </div>
              </div>
            ) : <p className="whitespace-pre-wrap break-words text-sm leading-7">{post.content}</p>}
            <div className="mt-3 flex gap-3">
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-text-secondary))]" onClick={() => { setEditingId(post.id); setEditDraft(post.content); }}>编辑</button>
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-danger))]" onClick={() => onDelete(post.id)}>删除</button>
            </div>
            {(post.comments.length > 0 || post.targets.length > 0) && (
              <div className="mt-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] pt-3" aria-label="朋友评论">
                {post.comments.map((comment) => <p key={comment.id} className="mb-2 break-words text-sm leading-6"><strong>{comment.npcName}：</strong>{comment.content}</p>)}
                {post.targets.some((target) => target.status === 'generating') && <p className="text-xs text-[rgb(var(--tj-text-secondary))]">朋友正在写评论…</p>}
                {post.targets.filter((target) => target.status === 'failed').map((target) => (
                  <button key={target.npcId} type="button" className="mr-3 min-h-11 text-xs underline" onClick={() => onRetry(post.id, post.revision, target.npcId)}>
                    重试{commenterNames.get(target.npcId) ?? target.npcId}评论
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
