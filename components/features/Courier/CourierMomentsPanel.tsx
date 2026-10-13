import { useState } from 'react';
import type { CourierMoment, CourierMomentImage } from '@/models/teyvat/courier';
import type { 相册系统 } from '@/models/imageGeneration';
import { formatWorldMomentBrief } from '@/services/worldMoment';
import type { MomentMentionBinding } from '@/services/courierMoments';
import type { CourierMomentImageTools } from './useCourierMomentImages';
import { CourierMomentComposer } from './CourierMomentComposer';
import { CourierMomentImages as MomentImages } from './CourierMomentImages';
import { normalizeCourierTimestamp } from '@/models/teyvat/courier';
import { useCourierDisplayPreferences } from './useCourierDisplayPreferences';
import { CourierDisplaySettings } from './CourierDisplaySettings';
import '@/styles/journal-phone.css';

interface CourierMomentsPanelProps {
  moments: readonly CourierMoment[];
  travelerName: string;
  eligibleCommenterCount: number;
  canGenerateComments: boolean;
  commenterNames: ReadonlyMap<string, string>;
  /** 可被 @ 的联系人（2026-09-29 第 7 项）：被点名者一定会回应一次，且不占自动评论名额。 */
  mentionCandidates?: readonly { npcId: string; name: string; remark?: string }[];
  album?: 相册系统;
  imageTools?: CourierMomentImageTools;
  onPublish: (content: string, images?: readonly CourierMomentImage[], bindings?: readonly MomentMentionBinding[]) => boolean;
  onEdit: (id: string, content: string, images?: readonly CourierMomentImage[], revision?: number, bindings?: readonly MomentMentionBinding[]) => boolean | void;
  onDelete: (id: string) => void;
  onRetry: (id: string, revision: number, npcId: string) => void;
}

export function CourierMomentsPanel({ moments, travelerName, eligibleCommenterCount, canGenerateComments, commenterNames, mentionCandidates = [], album, imageTools, onPublish, onEdit, onDelete, onRetry }: CourierMomentsPanelProps) {
  const [publishing, setPublishing] = useState(false);
  const [editingPost, setEditingPost] = useState<CourierMoment | null>(null);
  const [filter, setFilter] = useState<'全部' | '我的' | '有图' | '已点名'>('全部');
  const [showSettings, setShowSettings] = useState(false);
  const display = useCourierDisplayPreferences();
  const visible = moments.filter(post => filter === '有图' ? Boolean(post.images?.length) : filter === '已点名' ? Boolean(post.mentionIds?.length) : filter === '我的' ? post.authorId === 'player' : true);
  return (
    <section className="journal-phone flex min-h-0 flex-1 flex-col" aria-label="朋友圈">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain" aria-label="朋友圈动态流">
      <header className="phone-cover flex items-center justify-between gap-4 px-5 py-6">
        <div><p className="text-[10px] tracking-[.3em]">TRAVEL NOTES</p><h2 className="mt-2 font-serif text-xl">{travelerName || '旅行者'}的旅途朋友圈</h2><p className="mt-2 text-xs">把旅途的光，寄给熟悉的人。</p></div>
        <button type="button" className="min-h-11 shrink-0 rounded border px-3 text-xs" onClick={() => setShowSettings(true)}>朋友圈设置</button>
      </header>
      <div className="border-b border-[rgba(var(--tj-accent-primary),0.24)] px-4 py-4">
        <p className="mb-2 text-xs leading-5 text-[rgb(var(--tj-text-secondary))]">
          当前有 {eligibleCommenterCount} 位角色符合评论条件：须是手机联系人，且达到生死挚友（好感度超过 100）。每条动态最多有 3 位角色自动评论。
          另外，用「@」点名的联系人一定会回应一次（不占那 3 个名额）。
          {eligibleCommenterCount === 0
            ? '暂无符合条件的角色，不会收到自动评论；但 @ 点名的联系人仍会回应。'
            : !canGenerateComments ? '手机评论接口未配置：自动评论不会生成，@ 点名的联系人会由本地回应补上。' : '接口已填写，但尚未测试连接。'}
        </p>
        <button type="button" className="teyvat-btn min-h-11 w-full px-4 text-left" onClick={() => { setEditingPost(null); setPublishing(true); }}>写下旅途此刻</button>
        <p className="mt-2 text-xs">仅你可以发布动态 · 文字、点名与照片先放入草稿，确认后再发布。</p>
      </div>
      <div className="flex flex-wrap gap-2 px-4" aria-label="动态筛选">{(['全部', '我的', '有图', '已点名'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} className="phone-filter min-h-11 rounded-full border px-4 text-xs" onClick={() => setFilter(value)}>{value}</button>)}</div>
      {display.error && <p role="status" className="px-4 text-xs">{display.error}</p>}
      <div className="space-y-3 px-4 pb-4">
        {!visible.length && <p className="py-10 text-center text-sm text-[rgb(var(--tj-text-secondary))]">{moments.length ? '当前筛选没有动态。' : '还没有动态。把旅途的第一句话留在这里吧。'}</p>}
        {visible.map((post) => (
          <article key={post.id} className={`phone-moment-card rounded-lg ${display.preferences.density === 'compact' ? 'p-3' : 'p-4'}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="font-serif text-sm">{travelerName || '旅行者'}</strong>
              <div className="text-right text-xs text-[rgb(var(--tj-text-secondary))]">
                <span>第 {post.turn} 回合{display.preferences.showWorldMoment && ` · ${formatWorldMomentBrief(post.worldMoment)}`}</span>
                {display.preferences.showLocation && post.worldMoment?.location && <p>{post.worldMoment.location}</p>}
                <br />
                <MomentDeviceTime value={post.createdAt} />
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{post.content}</p>
            {post.images?.length ? <MomentImages images={post.images} album={album} /> : null}
            {post.mentionIds?.length ? (
              <p className="mt-2 text-xs text-[rgb(var(--tj-text-secondary))]">
                已点名：{post.mentionIds.map((npcId) => `@${commenterNames.get(npcId) ?? npcId}`).join(' ')}（一定会回应）
              </p>
            ) : null}
            <div className="mt-3 flex gap-3">
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-text-secondary))]" onClick={() => { setPublishing(false); setEditingPost(post); }}>编辑</button>
              <button type="button" className="min-h-11 text-xs text-[rgb(var(--tj-danger))]" onClick={() => onDelete(post.id)}>删除</button>
            </div>
            {(post.comments.length > 0 || post.targets.length > 0) && (
              <details open={display.preferences.expandComments} className="mt-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] pt-3" aria-label="朋友评论">
                <summary className="min-h-11 cursor-pointer text-xs">朋友评论（{post.comments.length}）</summary>
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
              </details>
            )}
          </article>
        ))}
      </div>
      </div>
      <CourierMomentComposer open={publishing} onClose={() => setPublishing(false)} album={album} imageTools={imageTools} mentionCandidates={mentionCandidates} onSave={onPublish} />
      {editingPost && <CourierMomentComposer key={`${editingPost.id}:${editingPost.revision}`} open onClose={() => setEditingPost(null)}
        album={album} imageTools={imageTools} mentionCandidates={mentionCandidates} editing={editingPost}
        currentRevision={moments.find(post => post.id === editingPost.id)?.revision}
        onSave={(content, images, bindings) => onEdit(editingPost.id, content, images, editingPost.revision, bindings)} />}
      {showSettings && <CourierDisplaySettings preferences={display.preferences} onSave={display.save} onClose={() => setShowSettings(false)} />}
    </section>
  );
}

function MomentDeviceTime({ value }: { value: number }) {
  const timestamp = normalizeCourierTimestamp(value);
  if (!timestamp) return <span>发布时间未记录</span>;
  const date = new Date(timestamp);
  return <time dateTime={date.toISOString()} title="现实设备时间，与游戏内时间不同">现实发布时间：{date.toLocaleString('zh-CN')}</time>;
}
