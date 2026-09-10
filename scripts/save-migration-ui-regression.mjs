import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [legacySource, dialogSource, modalSource, exportSource, storySource] = await Promise.all([
  read('components/features/SaveLoad/LegacyUniverseSaveCard.tsx'),
  read('components/features/SaveLoad/SaveMigrationDialog.tsx'),
  read('components/features/SaveLoad/SaveLoadModal.tsx'),
  read('services/exportService.ts'),
  read('stories/SaveMigrationDialog.stories.tsx'),
]);
const bundled = await build({
  entryPoints: ['services/exportService.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});
const { safeRawSaveFilename, resolveRawMigrationBackupText } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

assert.match(legacySource, /旧宇宙存档/);
assert.match(legacySource, /只读查看/);
assert.match(legacySource, /导出原档/);
assert.match(dialogSource, /选择初始元素/);
assert.match(dialogSource, /选择物品稀有度/);
assert.match(dialogSource, /disabled=\{!canConfirm\}/);
assert.doesNotMatch(dialogSource, /自动转换剧情/);
assert.match(modalSource, /parsed\.kind === 'legacy-hsr'/);
assert.match(modalSource, /parsed\.kind === 'partial-teyvat'/);
const legacyBranch = modalSource.match(/if \(parsed\.kind === 'legacy-hsr'\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
assert.doesNotMatch(legacyBranch, /migratePartialTeyvatSave|normalizeTeyvatGameState|saveGame/);
assert.match(modalSource, /inert=\{isMigrationPreview\}/);
assert.match(modalSource, /aria-hidden=\{isMigrationPreview\}/);
assert.match(modalSource, /createPortal\(/);
assert.match(modalSource, /previewFocusRestoreRef/);
assert.match(modalSource, /capturePreviewFocus/);
assert.match(modalSource, /restorePreviewFocus/);
assert.match(modalSource, /sourceJsonBytes = await file\.text\(\)/);
assert.match(modalSource, /createRawMigrationBackup\(sourceBackupRaw, sourceFileName, sourceJsonBytes\)/);
assert.match(modalSource, /parsed\.sourceBackupRaw/);
assert.match(modalSource, /writeCandidateAtomically: saveMigratedTeyvatGameAtomically/);
assert.doesNotMatch(modalSource, /readSourceBytes:\s*\(\) => JSON\.stringify/);
assert.match(dialogSource, /dialogRef/);
assert.match(dialogSource, /onKeyDown/);
assert.match(exportSource, /exportRawSave/);
const exactSource = '{\r\n  "universe": "partial-teyvat",\r\n  "背包": []\r\n}\r\n';
assert.equal(resolveRawMigrationBackupText(JSON.parse(exactSource), exactSource), exactSource);
assert.throws(
  () => resolveRawMigrationBackupText({ universe: 'partial-teyvat', 背包: ['changed'] }, exactSource),
  /迁移预览不一致/,
);
assert.equal(safeRawSaveFilename('CON.json'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('lPt9.backup.json'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('CON!.json'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('NUL .json'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('COM2.notes.json'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('LPT8.txt'), 'legacy-save.json');
assert.equal(safeRawSaveFilename('valid save.json'), 'valid_save.json');
assert.match(storySource, /旧宇宙只读卡: Story = \{\s*args:/);
assert.match(storySource, /全部解决后可确认: Story = \{[\s\S]*?issues: \[\{/);
assert.match(storySource, /全部解决后可确认: Story = \{[\s\S]*?initialChoices:/);

console.log('save migration UI regression: PASS');
