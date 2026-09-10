import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const state = fs.readFileSync('hooks/useGameState.ts', 'utf8');
const landing = fs.readFileSync('components/layout/LandingPage.tsx', 'utf8');
const desktop = fs.readFileSync('components/layout/DesktopHomeScreen.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');

assert(state.includes('export interface 续玩预览'), 'useGameState must export preview type.');
assert(state.includes('export function buildResumePreview'), 'useGameState must export buildResumePreview.');
assert(state.includes('recentTurns'), 'preview must include recent turns.');
assert(state.includes('currentArc'), 'preview must include current arc.');
assert(state.includes("save: 存档数据 | SaveListItemSummary"), 'preview must accept full save or summary.');
assert(state.includes("import type { 存档数据 } from '@/models/settings'"), 'full save type import required.');
assert(state.includes("import type { SaveListItemSummary } from '@/services/dbService'"), 'summary type import required.');

assert(landing.includes('getSaveList'), 'LandingPage must load save list.');
assert(landing.includes('buildResumePreview'), 'LandingPage must build resume preview.');
assert(landing.includes('onContinue: () => boolean | void | Promise<boolean | void>'), 'LandingPage must accept synchronous or asynchronous continue outcomes.');
assert(landing.includes('续玩 · 第'), 'LandingPage must render resume card.');
assert(landing.includes('onContinue()'), 'LandingPage resume card must call continue.');
assert(desktop.includes('latestSave'), 'DesktopHomeScreen must keep latest-save resume.');
assert(desktop.includes('continueLabel'), 'DesktopHomeScreen must keep continue entry.');
assert(app.includes('onContinue={actions.handleContinue}'), 'App must wire continue to home screens.');

console.log('resume prompt regression ok');
