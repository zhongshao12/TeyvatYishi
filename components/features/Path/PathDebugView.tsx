import type { 角色数据结构 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { setPrimaryElement, unlockElement } from '@/services/elementalAttunementService';

interface Props {
  旅人: 角色数据结构;
  世界: 世界状态;
  set旅人: React.Dispatch<React.SetStateAction<角色数据结构>>;
  set世界: React.Dispatch<React.SetStateAction<世界状态>>;
}

export function PathDebugView({ 旅人, 世界, set旅人, set世界 }: Props) {
  const unlock = (element: ElementId) => set旅人((current) => unlockElement(current, element, {
    source: 'traveler_resonance', unlockedAt: 当前时间戳(世界), notes: '调试面板解锁',
  }));
  const updateMastery = (element: ElementId, mastery: number) => set旅人((current) => ({
    ...current,
    元素共鸣: current.元素共鸣.map((entry) => entry.element === element ? { ...entry, mastery: Math.max(0, Math.min(100, mastery)) } : entry),
  }));

  return (
    <div className="space-y-4">
      <div className="text-xs leading-6" style={{ color: 'rgba(var(--tj-text-secondary),0.78)' }}>
        调试元素共鸣、主元素与元素回响生命周期。正式选择集固定为七元素。
      </div>
      {ELEMENT_IDS.map((element) => {
        const attunement = 旅人.元素共鸣.find((entry) => entry.element === element);
        return (
          <div key={element} className="flex flex-wrap items-center gap-3 p-3" style={{ background: 'rgba(var(--tj-panel-bg-end),0.5)' }}>
            <strong className="w-12 font-serif">{ELEMENT_NAMES[element]}</strong>
            {attunement ? (
              <>
                <input type="range" min={0} max={100} value={attunement.mastery} onChange={(event) => updateMastery(element, Number(event.target.value))} className="min-w-40 flex-1" />
                <span className="w-8 text-right text-xs">{attunement.mastery}</span>
                <button type="button" onClick={() => set旅人((current) => setPrimaryElement(current, element))} className="teyvat-btn px-3 py-1 text-xs">{旅人.主元素 === element ? '主元素' : '设为主元素'}</button>
                <button type="button" onClick={() => set世界((current) => ({ ...current, 元素回响邀请: element }))} className="teyvat-btn px-3 py-1 text-xs">发出回响邀请</button>
              </>
            ) : (
              <button type="button" onClick={() => unlock(element)} className="teyvat-btn px-3 py-1 text-xs">解锁共鸣</button>
            )}
          </div>
        );
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">回响邀请
          <select className="teyvat-input ml-2 px-2 py-1" value={世界.元素回响邀请 ?? ''} onChange={(event) => set世界((current) => ({ ...current, 元素回响邀请: event.target.value as ElementId || undefined }))}>
            <option value="">无</option>{ELEMENT_IDS.map((id) => <option key={id} value={id}>{ELEMENT_NAMES[id]}</option>)}
          </select>
        </label>
        <label className="text-xs">进行中回响
          <select className="teyvat-input ml-2 px-2 py-1" value={世界.进行中元素回响 ?? ''} onChange={(event) => set世界((current) => ({ ...current, 进行中元素回响: event.target.value as ElementId || undefined }))}>
            <option value="">无</option>{ELEMENT_IDS.map((id) => <option key={id} value={id}>{ELEMENT_NAMES[id]}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function 当前时间戳(world: 世界状态): string {
  return [world.当前日期, world.当前时间].filter(Boolean).join(' ') || '调试时间';
}
