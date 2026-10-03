import { useState } from 'react';
import type { CourierMoment } from '@/models/teyvat/courier';
import { formatWorldMomentBrief } from '@/services/worldMoment';

interface CourierMomentsPanelProps {
  moments: readonly CourierMoment[];
  travelerName: string;
  eligibleCommenterCount: number;
  canGenerateComments: boolean;
  commenterNames: ReadonlyMap<string, string>;
  /** 可被 @ 的联系人（2026-09-29 第 7 项）：被点名者一定会回应一次，且不占自动评论名额。 */
  mentionCandidates?: readonly { npcId: string; name: string }[];
  onPublish: (content: string) => boolean;
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string, revision: number, npcId: string) => void;
}

const fieldStyle = { background: 'rgba(255,252,240,0.76)', color: 'rgb(var(--tj-text-primary))', border: '1px solid rgba(var(--tj-accent-primary),0.35)' };

export function CourierMomentsPanel({ moments, travelerName, eligibleCommenterCount, canGenerateComments, commenterNames, mentionCandidates = [], onPublish, onEdit, onDelete, onRetry }: CourierMomentsPanelProps) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const canPublish = Boolean(draft.trim()) && draft.length <= 500;
  const insertMention = (value: string, name: string, setValue: (next: string) => void) => {
    const prefix = value && !/\s$/u.test(value) ? ' ' : '';
    setValue(`${value}${prefix}@${name} `);
  };
  const mentionRow = (setValue: (next: string) => void, value: string) => (
    mentionCandidates.length > 0 && (
      <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="点名联系人">
        <span className="text-xs text-[rgb(var(--tj-text-secondary))]">@ 谁：</span>
        {mentionCandidates.map((candidate) => (
          <button
            key={candidate.npcId} type="button" className="rounded-full border px-3 py-1 text-xs"
            style={{ borderColor: 'rgba(var(--tj-accent-primary),0.4)' }}
            onClick={() => insertMention(value, candidate.name, setValue)}
          >
            @{candidate.name}
          </button>
        ))}
      </div>
    )
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="朋友圈">
      <div className="border-b border-[rgba(var(--tj-accent-primary),0.24)] px-4 py-4">
        <p className="mb-2 text-xs leading-5 text-[rgb(var(--tj-text-secondary))]">
          当前有 {eligibleCommenterCount} 位角色符合评论条件：须是手机联系人，且达到生死挚友（好感度超过 100）。每条动态最多有 3 位角色自动评论。
          另外，用「@」点名的联系人一定会回应一次（不占那 3 个名额）。
          {eligibleCommenterCount === 0
            ? '暂无符合条件的角色，不会收到自动评论；但 @ 点名的联系人仍会回应。'
            : !canGenerateComments ? '手机评论接口未配置：自动评论不会生成，@ 点名的联系人会由本地回应补上。' : '接口已填写，但尚未测试连接。'}
        </p>
        <label htmlFor="courier-moment-draft" className="mb-2 block font-serif text-sm">写下旅途此刻</label>
        <textarea
          id="courier-moment-draft" aria-label="写朋友圈" value={draft} maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="今天想和朋友们分享什么？" rows={3}
          className="w-full resize-y rounded-md p-3 text-sm leading-6 outline-offset-2" style={fieldStyle}
        />
        {mentionRow(setDraft, draft)}
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
              <div className="text-right text-xs text-[rgb(var(--tj-text-secondary))]">
                <span>第 {post.turn} 回合 · {formatWorldMomentBrief(post.worldMoment)}</span>
                <br />
                <time dateTime={new Date(post.createdAt).toISOString()} title="现实设备时间，与游戏内时间不同">现实发布时间：{new Date(post.createdAt).toLocaleString('zh-CN')}</time>
              </div>
            </div>
            {editingId === post.id ? (
              <div>
                <textarea aria-label="编辑朋友圈" value={editDraft} maxLength={500} onChange={(event) => setEditDraft(event.target.value)} rows={3} className="w-full resize-y rounded-md p-3 text-sm" style={fieldStyle} />
                {mentionRow(setEditDraft, editDraft)}
                <p className="mt-2 text-xs leading-5 text-[rgb(var(--tj-text-secondary))]">保存修改将清空旧评论，并按新内容重新生成。</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setEditingId(null)}>取消</button>
                  <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-3 text-sm disabled:opacity-45" disabled={!editDraft.trim()} onClick={() => { onEdit(post.id, editDraft.trim()); setEditingId(null); }}>保存修改</button>
                </div>
              </div>
            ) : <p className="whitespace-pre-wrap break-words text-sm leading-7">{post.content}</p>}
            {post.mentionIds?.length ? (
              <p className="mt-2 text-xs text-[rgb(var(--tj-text-secondary))]">
                已点名：{post.mentionIds.map((npcId) => `@${commenterNames.get(npcId) ?? npcId}`).join(' ')}（一定会回应）
              </p>
            ) : null}
            <div className="mt-3 flex gap-3">
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-text-secondary))]" onClick={() => { setEditingId(post.id); setEditDraft(post.content); }}>编辑</button>
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-danger))]" onClick={() => onDelete(post.id)}>删除</button>
            </div>
            {(post.comments.length > 0 || post.targets.length > 0) && (
              <div className="mt-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] pt-3" aria-label="朋友评论">
                {post.comments.map((comment) => (
                  <p key={comment.id} className="mb-2 break-words text-sm leading-6">
                    <strong>{comment.npcName}：</strong>
                    {comment.content}
                    {comment.source === 'local' && (
                      <span className="ml-1 text-xs text-[rgb(var(--tj-text-secondary))]" title="模型未返回时由本地写作器补上的回应">
                        （本地回应）
                      </span>
                    )}
                  </p>
                ))}
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
