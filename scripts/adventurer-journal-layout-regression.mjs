import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

const gameViewSource = read('components/layout/GameView.tsx');
const appSource = read('App.tsx');
const backdropSource = read('components/layout/RegionBackdrop.tsx');
const bookmarkSource = read('components/layout/JournalCharacterBookmark.tsx');
const tabsSource = read('components/layout/JournalSystemTabs.tsx');
const topBarSource = read('components/layout/TopBar.tsx');
const leftPanelSource = read('components/layout/LeftPanel.tsx');
const mobileMenuSource = read('components/layout/MobileQuickMenu.tsx');
const appSourceForCopy = read('App.tsx');
const messageRenderersSource = read('components/features/Chat/MessageRenderers.tsx');
const modalSource = read('components/ui/Modal.tsx');
const css = read('styles/adventurer-journal.css');

assert.match(gameViewSource, /RegionBackdrop/, 'GameView must render the region watercolor backdrop.');
assert.match(gameViewSource, /JournalCharacterBookmark/, 'GameView must host the desktop traveler bookmark.');
assert.match(gameViewSource, /JournalSystemTabs/, 'GameView must host the system tab rail.');
assert.match(appSource, /region=\{state\.世界\.当前地区\}/, 'App must pass the formal current region into GameView.');

assert.match(backdropSource, /export interface RegionBackdropProps/, 'RegionBackdropProps must be public.');
assert.match(backdropSource, /getRegionVisual\(region\)/, 'RegionBackdrop must consume the Task 16 selector.');
assert.match(backdropSource, /data-danger/, 'RegionBackdrop must expose danger state without changing game state.');

assert.match(bookmarkSource, /aria-label/, 'The character bookmark needs an accessible label.');
assert.match(tabsSource, /aria-current/, 'System tabs must announce the active destination.');
assert.match(tabsSource, /journal-system-tabs--mobile/, 'The mobile bottom-tab variant must be explicit.');

assert.match(css, /--journal-parchment/, 'The shell must use the shared journal tokens.');
assert.match(css, /@media \(min-width: 768px\)/, 'Desktop composition must begin at 768px.');
assert.match(css, /@media \(max-width: 767px\)/, 'Mobile composition must stay below 768px.');
assert.match(css, /min-(?:width|height): 44px/, 'Interactive tab targets must be at least 44px.');
assert.match(css, /safe-area-inset-bottom/, 'The mobile tab bar must account for the bottom safe area.');
assert.match(css, /prefers-reduced-motion: reduce/, 'Decorative motion must have a reduced-motion path.');
assert.doesNotMatch(css, /backdrop-filter:\s*blur[^;]*\.journal-(?:shell|story|bookmark|system)/, 'Journal shell primitives must not use glass blur.');

const playerFacingJournalSource = [topBarSource, leftPanelSource, appSourceForCopy, messageRenderersSource].join('\n');
assert.doesNotMatch(
  playerFacingJournalSource,
  /`DAY\s|title="开拓天数"|>\s*开拓\s*<|当前注入章节|召回摘要|召回内容|开拓坐标|开拓档案|开拓记忆|开拓进行中/,
  'The player-facing shell must use warm travel-journal language instead of retired development/exploration diagnostics.',
);
assert.doesNotMatch(leftPanelSource, /--tj-(?:tech|arcane)-cyan/, 'The traveler bookmark must use journal ink, gold, or travel-green tokens.');
assert.doesNotMatch(
  `${topBarSource}\n${mobileMenuSource}`,
  /color:\s*['"]linear-gradient\(/,
  'The CSS color property cannot contain a gradient image.',
);
assert.doesNotMatch(
  `${topBarSource}\n${mobileMenuSource}`,
  /color:\s*[^,\n]*\?\s*['"][^'"]+['"]\s*:\s*['"]linear-gradient\(/,
  'Conditional color branches cannot contain a gradient image.',
);

assert.match(modalSource, /aria-labelledby/, 'Titled dialogs must receive an accessible name from their heading.');
assert.match(modalSource, /aria-label/, 'Untitled dialogs must receive a fallback accessible name.');
assert.match(modalSource, /previouslyFocused/, 'Modal opening must remember the trigger for focus restoration.');
assert.match(modalSource, /activeModalStack/, 'Nested modals must coordinate focus and body locking.');
assert.match(modalSource, /event\.key === 'Tab'/, 'Modal keyboard handling must trap Tab and Shift+Tab.');
assert.match(modalSource, /focusableElements/, 'Modal initial focus and focus loop must use real focusable descendants.');
assert.match(modalSource, /\.focus\(\)/, 'Modal must actively place and restore focus.');

console.log('adventurer journal layout regression ok');
