export interface ReleaseAnnouncement {
  version: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
  notes?: string[];
}

/** 2026-09-02：按项目主要求清空历史公告内容。 */
export const RELEASE_ANNOUNCEMENTS: ReleaseAnnouncement[] = [];
