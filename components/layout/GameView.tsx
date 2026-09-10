import type { ReactNode } from 'react';
import { WeatherAtmosphere } from '@/components/layout/WeatherAtmosphere';
import { RegionBackdrop } from '@/components/layout/RegionBackdrop';
import { JournalCharacterBookmark } from '@/components/layout/JournalCharacterBookmark';
import { JournalSystemTabs } from '@/components/layout/JournalSystemTabs';
import { 天气列表 } from '@/data/weatherRules';
import type { RegionId } from '@/models/teyvat/world';

interface GameViewProps {
  topBar: ReactNode;
  leftPanel: ReactNode;
  chatArea: ReactNode;
  rightPanel?: ReactNode;
  weatherId?: string | null;
  region?: RegionId | string | null;
  danger?: boolean | 'safe' | 'watch' | 'danger';
}

export function GameView({ topBar, leftPanel, chatArea, rightPanel, weatherId, region, danger = false }: GameViewProps) {
  const effectiveWeatherId = weatherId;
  const activeWeather = 天气列表.find((weather) => weather.id === effectiveWeatherId) ?? 天气列表.find((weather) => weather.id === 'clear');
  const weatherClass = `teyvat-game-weather-${activeWeather?.id ?? 'clear'}`;

  return (
    <RegionBackdrop region={region} weather={effectiveWeatherId} danger={danger}>
      <div className={`teyvat-app-shell teyvat-game-bg ${weatherClass} journal-game-view relative flex h-[100dvh] flex-col overflow-hidden md:h-screen`}>
        <WeatherAtmosphere weatherId={effectiveWeatherId} />
        <div className="journal-topbar-slot relative z-10 flex min-h-0 flex-none flex-col">
          {topBar}
        </div>
        <div className="journal-shell relative z-10 flex min-h-0 flex-1 overflow-hidden">
          <JournalCharacterBookmark>{leftPanel}</JournalCharacterBookmark>
          <main className="teyvat-mobile-chat-shell teyvat-chat-surface journal-story-page journal-paper-surface journal-reveal relative flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="旅行故事正文">
            <span className="journal-story-page__binding" aria-hidden="true" />
            {chatArea}
          </main>
          {rightPanel ? <JournalSystemTabs>{rightPanel}</JournalSystemTabs> : null}
        </div>
      </div>
    </RegionBackdrop>
  );
}
