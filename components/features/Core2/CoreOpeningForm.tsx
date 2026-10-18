import { useState } from 'react';
import { createCoreOpeningSeed, type CoreOpeningChoice, type CoreOpeningProfile } from '@/core/view/openingSeed';
import type { JourneySeed } from '@/core/contracts/operation';
import { OFFICIAL_OPENING_PRESETS, type OfficialOpeningPresetId, type 剧情模式 } from '@/models/teyvat/opening';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { buildCanonicalTravelerPreset, buildCanonicalElementTalents } from '@/data/canonicalTravelerPresets';

export function CoreOpeningForm({ onStart }: { onStart(seed: JourneySeed): Promise<unknown> }) {
  const [name, setName] = useState(''), [travelerPreset, setTravelerPreset] = useState<CoreOpeningChoice['travelerPreset']>('custom');
  const [companion, setCompanion] = useState<'' | '空' | '荧'>(''), [opening, setOpening] = useState<OfficialOpeningPresetId>('official_mondstadt_dragon'), [mode, setMode] = useState<剧情模式>('normal');
  const [element, setElement] = useState<ElementId | ''>(''), [profile, setProfile] = useState<CoreOpeningProfile>({ 年龄: 25 }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const activeElement = travelerPreset === 'custom' ? element : 'anemo', talents = activeElement ? buildCanonicalElementTalents(activeElement) : [];
  const applyPreset = (value: CoreOpeningChoice['travelerPreset']) => {
    if (value !== 'custom') {
      const canon = buildCanonicalTravelerPreset(value);
      setProfile(current => ({ ...current, 性别: canon.gender, 外貌: canon.appearance, 性格: canon.personality, 背景: canon.background }));
      if (!name || name === '空' || name === '荧') setName(value);
      setOpening('official_mondstadt_dragon'); if (companion === value) setCompanion('');
    }
    setTravelerPreset(value);
  };
  return <form className="core2-card core2-opening" onSubmit={event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    void (async () => {
      try { await onStart(createCoreOpeningSeed({ name, travelerPreset, canonicalCompanion: companion, openingPresetId: opening, storyMode: mode, profile, ...(element && travelerPreset === 'custom' ? { initialElement: element } : {}) })); }
      catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
      finally { setBusy(false); }
    })();
  }}><h2>启程之前</h2><p>独立的新旅程，不继承其他存档的人物关系、背包或记忆。API 和酒馆预设继续使用现有设置。</p>
    {error && <p role="alert" className="core2-error">{error}</p>}
    <fieldset disabled={busy}>
      <div className="core2-opening-grid">
        <label>旅人姓名<input aria-label="旅人姓名" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>旅行者模板<select aria-label="旅行者模板" value={travelerPreset} onChange={event => applyPreset(event.target.value as CoreOpeningChoice['travelerPreset'])}><option value="custom">自定义旅行者</option><option value="空">空</option><option value="荧">荧</option></select></label>
        <label>性别<input aria-label="性别" value={profile.性别 ?? ''} onChange={event => setProfile(current => ({ ...current, 性别: event.target.value }))} /></label>
        <label>年龄<input aria-label="年龄" type="number" min={0} step={1} value={profile.年龄 ?? 25} onChange={event => setProfile(current => ({ ...current, 年龄: Number(event.target.value) }))} /></label>
      </div>
      <details><summary>基础资料（套用模板后仍可编辑）</summary><div className="core2-opening-grid">
        {(['别名', '生日', '身高', '身份'] as const).map(field => <label key={field}>{field}<input aria-label={field} value={profile[field] ?? ''} maxLength={20000} onChange={event => setProfile(current => ({ ...current, [field]: event.target.value }))} /></label>)}
      </div>{(['外貌', '性格', '背景'] as const).map(field => <label key={field}>{field}<textarea aria-label={field} value={profile[field] ?? ''} maxLength={20000} onChange={event => setProfile(current => ({ ...current, [field]: event.target.value }))} /></label>)}</details>
      <h3>元素与天赋</h3><label>开局元素<select aria-label="开局元素" value={activeElement} disabled={travelerPreset !== 'custom'} onChange={event => setElement(event.target.value as ElementId | '')}><option value="">尚未觉醒</option>{ELEMENT_IDS.map(id => <option key={id} value={id}>{ELEMENT_NAMES[id]}元素</option>)}</select></label>
      <p>{travelerPreset !== 'custom' ? '原著旅行者从蒙德风元素开始，其余元素觉醒后才获得对应天赋。' : '只启用你选择的开局元素；未选择时从尚未觉醒开始。'}</p>
      {talents.length > 0 && <ul>{talents.map(talent => <li key={talent.id}>{talent.名称} · 等级 1</li>)}</ul>}
      <h3>开局与同行者</h3><label>开局地区与篇章<select aria-label="开局地区与篇章" disabled={travelerPreset !== 'custom'} value={opening} onChange={event => setOpening(event.target.value as OfficialOpeningPresetId)}>{OFFICIAL_OPENING_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label>
      <p>较后地区以所选时点作为世界背景，不补造玩家亲历、角色知情或此前奖励。</p>
      <label>原著旅行者同伴<select aria-label="原著旅行者同伴" value={companion} onChange={event => setCompanion(event.target.value as '' | '空' | '荧')}><option value="">暂不同行</option>{(['空', '荧'] as const).map(value => <option key={value} value={value} disabled={travelerPreset === value}>{value}</option>)}</select></label>
      <label>剧情模式<select aria-label="剧情模式" value={mode} onChange={event => setMode(event.target.value as 剧情模式)}><option value="normal">普通冒险</option><option value="harem">后宫向</option><option value="romance_alt">恋爱支线</option><option value="deep_single">单线羁绊</option></select></label>
      <p>剧情模式是叙事方向，不赋予特殊体质，也不替角色确认关系。</p><button type="submit">{busy ? '正在建立旅程…' : '建立新旅程'}</button>
    </fieldset>
  </form>;
}
