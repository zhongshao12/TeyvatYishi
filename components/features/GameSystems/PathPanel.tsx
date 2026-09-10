import type { 角色数据结构 } from '@/models/character';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { ELEMENT_COLORS, ELEMENT_EMBLEMS, ELEMENT_NAMES } from '@/styles/elementTokens';
import { setPrimaryElement } from '@/services/elementalAttunementService';
import type { ElementalFieldState, ElementalReactionEvent } from '@/models/teyvat/elementalGauge';

const gold = 'rgb(var(--tj-accent-primary))';

const POWER_SOURCE_LABELS: Record<string, string> = {
  vision: '来源：神之眼',
  traveler_resonance: '来源：旅人共鸣',
  adeptal: '来源：仙家法门',
  divine: '来源：神明赐福',
  abyssal: '来源：深渊之力',
  other: '来源：未知',
};

interface PathPanelProps {
  traveler: 角色数据结构;
  onTravelerChange: React.Dispatch<React.SetStateAction<角色数据结构>>;
  onUnlockedElement?: (element: ElementId) => void;
  /** G1：当前场面附着与最近反应事件（可选，便于独立使用）。 */
  elementalField?: ElementalFieldState;
  elementalEvents?: ElementalReactionEvent[];
}

const ELEMENT_DETAILS: Record<ElementId, { name: string; emblem: string; color: string; description: string }> = {
  anemo: { name: ELEMENT_NAMES.anemo, emblem: ELEMENT_EMBLEMS.anemo, color: ELEMENT_COLORS.anemo, description: '自由、流动与扩散。' },
  geo: { name: ELEMENT_NAMES.geo, emblem: ELEMENT_EMBLEMS.geo, color: ELEMENT_COLORS.geo, description: '坚守、契约与结晶。' },
  electro: { name: ELEMENT_NAMES.electro, emblem: ELEMENT_EMBLEMS.electro, color: ELEMENT_COLORS.electro, description: '迅捷、意志与激化。' },
  dendro: { name: ELEMENT_NAMES.dendro, emblem: ELEMENT_EMBLEMS.dendro, color: ELEMENT_COLORS.dendro, description: '生机、智慧与蔓生。' },
  hydro: { name: ELEMENT_NAMES.hydro, emblem: ELEMENT_EMBLEMS.hydro, color: ELEMENT_COLORS.hydro, description: '流动、治愈与感知。' },
  pyro: { name: ELEMENT_NAMES.pyro, emblem: ELEMENT_EMBLEMS.pyro, color: ELEMENT_COLORS.pyro, description: '热情、燃烧与新生。' },
  cryo: { name: ELEMENT_NAMES.cryo, emblem: ELEMENT_EMBLEMS.cryo, color: ELEMENT_COLORS.cryo, description: '沉静、冻结与保存。' },
};

export function PathPanel({ traveler, onTravelerChange, elementalField, elementalEvents = [] }: PathPanelProps) {
  const unlocked = new Map(traveler.元素共鸣.map((entry) => [entry.element, entry]));
  const recentEvents = elementalEvents.slice(-3).reverse();

  const choosePrimary = (element: ElementId) => {
    if (!unlocked.get(element)?.unlocked) return;
    onTravelerChange((current) => setPrimaryElement(current, element));
  };

  return (
    <div className="space-y-4">
      <header className="px-4 py-3" style={{ background: 'rgba(var(--tj-panel-bg-start),0.72)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.24)' }}>
        <div className="font-serif text-sm tracking-[0.3em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>元素共鸣</div>
        <p className="mt-2 text-xs leading-6" style={{ color: 'rgba(var(--tj-text-secondary),0.85)' }}>
          旅行者可以与七种元素建立共鸣。熟练度范围为 0–100；主元素只能从已解锁的共鸣中选择。
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {ELEMENT_IDS.map((element) => {
          const detail = ELEMENT_DETAILS[element];
          const attunement = unlocked.get(element);
          const isPrimary = traveler.主元素 === element;
          return (
            <button
              key={element}
              type="button"
              disabled={!attunement?.unlocked}
              onClick={() => choosePrimary(element)}
              className="p-4 text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-55"
              style={{ background: 'rgba(var(--tj-panel-bg-end),0.56)', boxShadow: `inset 0 0 0 1px ${isPrimary ? detail.color : 'rgba(var(--tj-text-secondary),0.18)'}` }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-serif text-base" style={{ color: detail.color }}>{detail.emblem} {detail.name}</span>
                <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.72)' }}>
                  {isPrimary ? '主元素' : attunement?.unlocked ? '已共鸣' : '尚未共鸣'}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.78)' }}>{detail.description}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(var(--tj-shadow),0.28)' }}>
                <div className="h-full rounded-full" style={{ width: `${attunement?.mastery ?? 0}%`, background: detail.color }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary),0.62)' }}>
                <span>{attunement ? POWER_SOURCE_LABELS[attunement.source] : '尚未共鸣'}</span>
                <span>熟练度 {attunement?.mastery ?? 0}</span>
              </div>
              {attunement?.unlocked && attunement.notes?.trim() && (
                <p className="mt-2 text-[11px] leading-5" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>共鸣记忆：{attunement.notes}</p>
              )}
            </button>
          );
        })}
      </div>

      {elementalField && (elementalField.auraElement || recentEvents.length > 0) && (
        <section className="p-4" style={{ background: 'rgba(var(--tj-panel-bg-end),0.56)', boxShadow: `inset 0 0 0 1px rgba(var(--tj-text-secondary),0.18)`, clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)' }}>
          <h3 className="font-serif text-[13px] tracking-[0.22em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>场面元素状态</h3>
          <p className="mt-2 text-xs leading-6" style={{ color: 'rgba(var(--tj-text-secondary),0.85)' }}>
            {elementalField.auraElement
              ? <>当前场面残留附着：<span style={{ color: ELEMENT_COLORS[elementalField.auraElement] }}>{ELEMENT_NAMES[elementalField.auraElement]}</span>（自回合 {elementalField.updatedTurn} 起）。{elementalField.lastSummary}</>
              : '当前场面没有元素附着。'}
          </p>
          {recentEvents.length > 0 && (
            <div className="mt-2 space-y-1">
              {recentEvents.map((event) => (
                <p key={event.id} className="text-[11px] leading-5" style={{ color: 'rgba(var(--tj-text-secondary),0.8)' }}>
                  回合 {event.turn} · <span style={{ color: gold }}>{event.name}</span>：{event.narrative}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
