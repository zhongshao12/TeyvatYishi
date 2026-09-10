import type { CSSProperties, ReactNode } from 'react';
import { getRegionVisual } from '@/data/regionVisuals';
import type { RegionId } from '@/models/teyvat/world';

export interface RegionBackdropProps {
  region?: RegionId | string | null;
  weather?: string | null;
  danger?: boolean | 'safe' | 'watch' | 'danger';
  children: ReactNode;
  className?: string;
}

type RegionBackdropStyle = CSSProperties & {
  '--journal-region-image': string;
  '--journal-region-overlay': string;
  '--journal-region-overlay-opacity': number;
  '--journal-region-accent': string;
  '--journal-region-paper': string;
};

export function RegionBackdrop({
  region,
  weather,
  danger = false,
  children,
  className = '',
}: RegionBackdropProps) {
  const visual = getRegionVisual(region);
  const dangerLevel = danger === true ? 'danger' : danger === false ? 'safe' : danger;
  const style: RegionBackdropStyle = {
    '--journal-region-image': `url("${visual.background}")`,
    '--journal-region-overlay': visual.overlayColor,
    '--journal-region-overlay-opacity': visual.overlayOpacity,
    '--journal-region-accent': visual.accentColor,
    '--journal-region-paper': visual.paperTint,
  };

  return (
    <div
      className={`journal-region-backdrop ${className}`.trim()}
      data-region={region || 'mondstadt'}
      data-weather={weather || 'clear'}
      data-danger={dangerLevel}
      style={style}
    >
      <div className="journal-region-backdrop__watercolor" aria-hidden="true" />
      <div className="journal-region-backdrop__wash" aria-hidden="true" />
      <div className="journal-region-backdrop__content">{children}</div>
    </div>
  );
}
