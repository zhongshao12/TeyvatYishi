import fs from 'node:fs';

const app = fs.readFileSync('App.tsx', 'utf8');
const landing = fs.readFileSync('components/layout/LandingPage.tsx', 'utf8');
const modal = fs.readFileSync('components/features/Release/ReleaseAnnouncementsModal.tsx', 'utf8');
const data = fs.readFileSync('data/releaseAnnouncements.ts', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  landing.includes('onReleaseAnnouncements') && landing.includes('更新公告'),
  'Landing page must expose an update announcement button.',
);
assert(
  landing.includes('onCloudSave') && landing.indexOf('GitHub 云存档') < landing.indexOf('更新公告'),
  'Update announcement button must sit next to the GitHub cloud save entry.',
);
assert(
  landing.includes('旅行者纪事 v{__APP_VERSION__}'),
  'Landing page must render the injected current version.',
);
assert(
  landing.includes('作者：牢云'),
  'Landing page must show the current author.',
);
// 2026-09-02 项目主要求：贡献者名单已从落地页移除。
assert(
  !landing.includes('贡献者：') && !landing.includes('Penna Mch'),
  'Landing page must not retain removed contributor credits.',
);
assert(
  app.includes('ReleaseAnnouncementsModal') &&
    app.includes('showReleaseAnnouncements') &&
    app.includes('setShowReleaseAnnouncements(true)'),
  'App must open the release announcements modal from the landing page.',
);
assert(
  modal.includes("import { RELEASE_ANNOUNCEMENTS } from '@/data/releaseAnnouncements'"),
  'Release announcements modal must use the dedicated in-app announcement data source.',
);
assert(
  !modal.includes('CHANGELOG') && !data.includes('CHANGELOG'),
  'In-game announcements must not read CHANGELOG.md directly.',
);
// 2026-09-02 项目主要求：游戏内更新公告内容全部清空（入口与弹窗结构保留）。
assert(
  data.includes('export const RELEASE_ANNOUNCEMENTS: ReleaseAnnouncement[] = [];'),
  'Release announcements must be emptied by project owner request (2026-09-02).',
);
assert(
  !data.includes("version: 'v1.5.0'") && !data.includes('阿格莱雅'),
  'Cleared announcements must not retain historical HSR-era notice content.',
);

console.log('release announcements regression ok');
