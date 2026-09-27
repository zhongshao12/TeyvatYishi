const BACKUP_REMINDER_KEY = 'teyvat.backupReminder.v1';
const SEVEN_DAYS_MS = 7 * 86_400_000;

export interface BackupReminderState {
  firstSeenAt: number;
  lastExportAt: number;
  lastExportSaveCount: number;
  dismissedUntil: number;
}

export function shouldSuggestBackup(input: BackupReminderState & { now: number; saveCount: number }): boolean {
  const baselineTime = input.lastExportAt > 0 ? input.lastExportAt : input.firstSeenAt;
  return input.now - baselineTime >= SEVEN_DAYS_MS
    && input.now >= input.dismissedUntil
    && input.saveCount - input.lastExportSaveCount >= 10;
}

export function markBackupExportSuccess(state: BackupReminderState, saveCount: number, now: number): BackupReminderState {
  return { ...state, lastExportAt: now, lastExportSaveCount: Math.max(0, Math.trunc(saveCount)), dismissedUntil: 0 };
}

export function snoozeBackupReminder(state: BackupReminderState, now: number): BackupReminderState {
  return { ...state, dismissedUntil: now + SEVEN_DAYS_MS };
}

export function saveBackupReminderState(state: BackupReminderState): void {
  try { globalThis.localStorage?.setItem(BACKUP_REMINDER_KEY, JSON.stringify(state)); } catch { /* Storage may be disabled. */ }
}

export function readBackupReminderState(now: number): BackupReminderState {
  try {
    const raw = globalThis.localStorage?.getItem(BACKUP_REMINDER_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>;
        const fields = ['firstSeenAt', 'lastExportAt', 'lastExportSaveCount', 'dismissedUntil'] as const;
        if (fields.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
          return {
            firstSeenAt: value.firstSeenAt as number,
            lastExportAt: value.lastExportAt as number,
            lastExportSaveCount: value.lastExportSaveCount as number,
            dismissedUntil: value.dismissedUntil as number,
          };
        }
      }
    }
  } catch { /* Storage may be disabled or malformed. */ }
  const state = { firstSeenAt: now, lastExportAt: 0, lastExportSaveCount: 0, dismissedUntil: 0 };
  saveBackupReminderState(state);
  return state;
}
