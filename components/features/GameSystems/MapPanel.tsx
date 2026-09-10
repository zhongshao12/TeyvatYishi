import { useState } from 'react';
import type { RegionId } from '@/models/teyvat/world';
import { isStatueUnlocked, MAP_REGION_NAMES, type TeyvatMapState } from '@/models/teyvat/map';

export interface MapPanelProps {
  map: TeyvatMapState;
  currentRegion: RegionId | '';
  turnCount: number;
  onUnlockStatue: (regionId: RegionId) => void;
  onTeleport: (regionId: RegionId) => void;
}

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;
const clipSmall = 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)';

/** 七国地图（G2 一期）：以六国背景图作示意地图，七天神像激活后可传送。 */
export function MapPanel({ map, currentRegion, turnCount, onUnlockStatue, onTeleport }: MapPanelProps) {
  const [pendingRegion, setPendingRegion] = useState<RegionId | null>(null);

  const regions = (Object.keys(MAP_REGION_NAMES) as RegionId[]).map((regionId) => ({
    regionId,
    name: MAP_REGION_NAMES[regionId],
    unlocked: isStatueUnlocked(map, regionId),
    current: currentRegion === regionId,
    background: regionId === 'nod_krai' ? '/assets/backgrounds/snezhnaya.webp' : `/assets/backgrounds/${regionId}.webp`,
  }));

  const handleTeleport = (regionId: RegionId) => {
    setPendingRegion(regionId);
    onTeleport(regionId);
    window.setTimeout(() => setPendingRegion(null), 2600);
  };

  return (
    <section className="h-full overflow-y-auto p-4 text-[rgb(var(--tj-text-primary))]">
      <header className="border-b border-[rgba(var(--tj-accent-primary),0.3)] pb-3">
        <p className="font-serif text-xs tracking-[0.3em]" style={{ color: gold }}>TEYVAT MAP</p>
        <h2 className="mt-1 font-serif text-2xl tracking-[0.18em]">七国地图</h2>
        <p className="mt-1 text-xs leading-6" style={{ color: muted(0.85) }}>
          当前所在：<span style={{ color: gold }}>{(MAP_REGION_NAMES as Record<string, string>)[currentRegion] ?? '未知'}</span>
          {map.lastTeleportTurn > 0 ? ` · 上次传送于回合 ${map.lastTeleportTurn}` : ''}
          {turnCount > 0 ? ` · 当前回合 ${turnCount}` : ''}
        </p>
        <p className="mt-1 text-[11px] leading-5" style={{ color: muted(0.7) }}>
          当剧情抵达某个地区并与七天神像互动后，点「标记神像」激活传送；之后可随时传送到已激活的地区。
        </p>
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {regions.map((region) => (
          <article
            key={region.regionId}
            className="relative overflow-hidden p-3"
            style={{
              minHeight: 150,
              background: region.background ? `url(${region.background}) center/cover no-repeat` : 'rgba(var(--tj-panel-bg-end),0.6)',
              boxShadow: `inset 0 0 0 1px ${region.current ? goldSoft(0.7) : goldSoft(0.24)}`,
              clipPath: clipSmall,
            }}
          >
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,7,0.48), rgba(10,9,7,0.88))' }} />
            <div className="relative z-10" data-testid="map-card-content" style={{ color: '#fff7df', textShadow: '0 1px 3px rgba(0,0,0,0.92)' }}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-serif text-lg font-bold tracking-[0.14em]" style={{ color: '#fff7df' }}>{region.name}</h3>
                {region.current && (
                  <span className="px-2 py-0.5 text-[10px] tracking-[0.14em]" style={{ color: 'rgb(var(--tj-on-accent))', background: goldSoft(0.9), clipPath: clipSmall }}>
                    当前所在
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] font-semibold" style={{ color: region.unlocked ? '#f0d58b' : 'rgba(255,247,223,0.92)' }}>
                {region.unlocked ? '✦ 七天神像已激活，可传送' : '🔒 七天神像未激活'}
              </p>
              <div className="mt-6 flex gap-2">
                {!region.unlocked && (
                  <button
                    type="button"
                    onClick={() => onUnlockStatue(region.regionId)}
                    className="px-3 py-1.5 text-xs tracking-[0.12em]"
                    style={{ color: '#fff7df', background: 'rgba(10,8,6,0.72)', boxShadow: `inset 0 0 0 1px ${goldSoft(0.72)}`, clipPath: clipSmall, textShadow: 'none' }}
                  >
                    标记神像已激活
                  </button>
                )}
                {region.unlocked && !region.current && (
                  <button
                    type="button"
                    onClick={() => handleTeleport(region.regionId)}
                    className="teyvat-btn teyvat-btn-primary px-3 py-1.5 text-xs"
                  >
                    <span className="relative">传送到此</span>
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
