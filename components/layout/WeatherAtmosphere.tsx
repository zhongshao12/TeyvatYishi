import { 天气列表 } from '@/data/weatherRules';

interface WeatherAtmosphereProps {
  weatherId?: string | null;
}

const KNOWN_WEATHER_IDS = new Set<string>(天气列表.map((weather) => weather.id));
const WEATHER_NAME_TO_ID = new Map<string, string>(天气列表.map((weather) => [weather.name, weather.id]));

function normalizeWeatherId(weatherId?: string | null): string {
  const raw = weatherId?.trim();
  if (!raw) return 'clear';
  if (KNOWN_WEATHER_IDS.has(raw)) return raw;
  return WEATHER_NAME_TO_ID.get(raw) ?? 'clear';
}

export function WeatherAtmosphere({ weatherId }: WeatherAtmosphereProps) {
  const normalizedWeather = normalizeWeatherId(weatherId);

  return (
    <div className={`teyvat-weather-atmosphere teyvat-weather-${normalizedWeather}`} aria-hidden="true">
      <span className="teyvat-weather-wash" />
      <span className="teyvat-weather-top" />
      <span className="teyvat-weather-edge teyvat-weather-edge-left" />
      <span className="teyvat-weather-edge teyvat-weather-edge-right" />
      <span className="teyvat-weather-motes teyvat-weather-motes-a" />
      <span className="teyvat-weather-motes teyvat-weather-motes-b" />
    </div>
  );
}
