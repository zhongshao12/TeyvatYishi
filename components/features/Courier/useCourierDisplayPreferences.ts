import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSetting, saveSetting } from '@/services/dbService';
import { DEFAULT_COURIER_DISPLAY, normalizeCourierDisplay, type CourierDisplayPreferences } from './courierDisplayPreferences';

const KEY = 'courierMomentsDisplay';
export function useCourierDisplayPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_COURIER_DISPLAY);
  const [error, setError] = useState('');
  const generation = useRef(0); const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true; let active = true; const revision = generation.current;
    void loadSetting(KEY).then(value => {
      if (active && generation.current === revision) setPreferences(normalizeCourierDisplay(value));
    }).catch(cause => { if (active) setError(`显示设置读取失败，暂用默认显示：${cause instanceof Error ? cause.message : '本地存储不可用'}`); });
    return () => { active = false; mounted.current = false; };
  }, []);
  const save = useCallback(async (draft: CourierDisplayPreferences) => {
    const next = normalizeCourierDisplay(draft); const revision = ++generation.current;
    await saveSetting(KEY, next);
    if (mounted.current && revision === generation.current) { setPreferences(next); setError(''); }
  }, []);
  return { preferences, error, save };
}
