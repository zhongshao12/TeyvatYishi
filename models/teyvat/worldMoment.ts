/** The game-world provenance of one committed turn, independent of wall-clock time. */
export interface WorldMoment {
  worldName: '提瓦特';
  date: string | null;
  clock: string | null;
  weather: string | null;
  location: string | null;
  /** Optional stable map identity in Core 2; the display name remains in location. */
  locationId?: string;
  travelDay: number | null;
  turn: number;
  settlementId: string;
}

/** A summary retains the boundary moments and the IDs of every source record. */
export interface WorldMomentRange {
  start: WorldMoment | null;
  end: WorldMoment | null;
  sourceIds: string[];
}
