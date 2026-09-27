import { describe, expect, it } from 'vitest';
import { markBackupExportSuccess, shouldSuggestBackup, snoozeBackupReminder } from '@/utils/backupReminder';

const DAY = 86_400_000;

describe('backup reminder', () => {
  it('requires seven days and ten new save nodes', () => {
    const initial = { firstSeenAt: 0, lastExportAt: 0, lastExportSaveCount: 0, dismissedUntil: 0 };
    expect(shouldSuggestBackup({ ...initial, now: 6 * DAY, saveCount: 20 })).toBe(false);
    expect(shouldSuggestBackup({ ...initial, now: 8 * DAY, saveCount: 9 })).toBe(false);
    expect(shouldSuggestBackup({ ...initial, now: 8 * DAY, saveCount: 10 })).toBe(true);
  });

  it('resets the baseline on export and snoozes for seven days', () => {
    const state = { firstSeenAt: 0, lastExportAt: 0, lastExportSaveCount: 0, dismissedUntil: 0 };
    const exported = markBackupExportSuccess(state, 10, 8 * DAY);
    expect(shouldSuggestBackup({ ...exported, now: 16 * DAY, saveCount: 19 })).toBe(false);
    expect(shouldSuggestBackup({ ...exported, now: 16 * DAY, saveCount: 20 })).toBe(true);
    const snoozed = snoozeBackupReminder(exported, 16 * DAY);
    expect(shouldSuggestBackup({ ...snoozed, now: 22 * DAY, saveCount: 20 })).toBe(false);
    expect(shouldSuggestBackup({ ...snoozed, now: 24 * DAY, saveCount: 20 })).toBe(true);
  });
});
