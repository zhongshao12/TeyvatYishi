function clippedCorner(size: number): string {
  return `polygon(${size}px 0, 100% 0, 100% calc(100% - ${size}px), calc(100% - ${size}px) 100%, 0 100%, 0 ${size}px)`;
}

export const CLIP_XS = clippedCorner(4);
export const CLIP_SMALL = clippedCorner(6);
export const CLIP_ITEM = clippedCorner(7);
export const CLIP_MEDIUM = clippedCorner(8);
export const CLIP_CARD = clippedCorner(10);
export const CLIP_SECTION = clippedCorner(12);
export const CLIP_PANEL = clippedCorner(14);
export const CLIP_LARGE = clippedCorner(16);
export const CLIP_XL = clippedCorner(18);

export function insetRing(alpha = 0.22): string {
  return `inset 0 0 0 1px rgba(var(--tj-accent-primary), ${alpha})`;
}

export function gradientAccent(startAlpha = 1, endAlpha = startAlpha, angle = 135): string {
  return `linear-gradient(${angle}deg, rgba(var(--tj-btn-primary-start), ${startAlpha}), rgba(var(--tj-btn-primary-end), ${endAlpha}))`;
}
