export interface CourierDisplayPreferences {
  density: 'comfortable' | 'compact';
  showWorldMoment: boolean;
  showLocation: boolean;
  expandComments: boolean;
}
export const DEFAULT_COURIER_DISPLAY: CourierDisplayPreferences = { density: 'comfortable', showWorldMoment: true, showLocation: true, expandComments: true };
export function normalizeCourierDisplay(value: unknown): CourierDisplayPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<CourierDisplayPreferences> : {};
  return { density: raw.density === 'compact' ? 'compact' : 'comfortable', showWorldMoment: raw.showWorldMoment !== false,
    showLocation: raw.showLocation !== false, expandComments: raw.expandComments !== false };
}
