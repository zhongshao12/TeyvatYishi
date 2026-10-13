import { useState } from 'react';
import type { CourierDisplayPreferences } from './courierDisplayPreferences';
import { CourierSheet } from './CourierSheet';

export function CourierDisplaySettings({ preferences, onSave, onClose }: { preferences: CourierDisplayPreferences; onSave: (draft: CourierDisplayPreferences) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(preferences); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <CourierSheet title="朋友圈显示设置" onClose={onClose} footer={<>
    <button type="button" className="teyvat-btn min-h-11 px-4" onClick={onClose}>取消</button>
    <button type="button" className="teyvat-btn teyvat-btn-primary min-h-11 px-4" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void onSave(draft).then(onClose).catch(cause => setError(`保存失败：${cause instanceof Error ? cause.message : '本地存储不可用'}`)).finally(() => setBusy(false));
    }}>{busy ? '保存中…' : '保存显示设置'}</button>
  </>}>
    <p className="mb-4 text-xs leading-6">这里只改变显示方式，不改变游戏时间、角色的评论资格或模型设置。</p>
    <label className="mb-4 block text-sm">卡片密度<select aria-label="卡片密度" className="teyvat-input ml-3 min-h-11 rounded px-3" value={draft.density} onChange={event => setDraft(old => ({ ...old, density: event.target.value === 'compact' ? 'compact' : 'comfortable' }))}>
      <option value="comfortable">舒适</option><option value="compact">紧凑</option>
    </select></label>
    {([['showWorldMoment', '显示游戏世界时刻'], ['showLocation', '显示地点'], ['expandComments', '默认展开评论']] as const).map(([key, label]) =>
      <label key={key} className="mb-3 flex min-h-11 items-center gap-3 rounded border p-3 text-sm"><input type="checkbox" checked={draft[key]} onChange={event => setDraft(old => ({ ...old, [key]: event.target.checked }))} />{label}</label>)}
    {error && <p role="alert" style={{ color: 'rgb(var(--tj-danger))' }}>{error}</p>}
  </CourierSheet>;
}
