import {
  cleanupStaleCloudMergeStaging,
  type CloudMergeStagingCleanupSummary,
} from '@/services/dbService';
import {
  repairUnresolvedDesktopSaveTransactions,
  type DesktopSaveTransactionRepairSummary,
} from '@/services/desktop/desktopSaveMirror';

export interface StartupStorageMaintenanceDependencies {
  cleanupCloudMergeStaging: () => Promise<CloudMergeStagingCleanupSummary>;
  repairDesktopTransactions: () => Promise<DesktopSaveTransactionRepairSummary>;
  requestPersistentStorage?: () => Promise<boolean | undefined>;
}

export interface StartupStorageMaintenanceSummary {
  cloudMergeStaging?: CloudMergeStagingCleanupSummary;
  desktopTransactions?: DesktopSaveTransactionRepairSummary;
  persistentStorageGranted?: boolean;
  failedTasks: Array<'cloud-merge-staging' | 'desktop-save-transactions' | 'persistent-storage'>;
}

async function requestBrowserPersistentStorage(): Promise<boolean | undefined> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') return undefined;
  return navigator.storage.persist();
}

const DEFAULT_DEPENDENCIES: StartupStorageMaintenanceDependencies = {
  cleanupCloudMergeStaging: cleanupStaleCloudMergeStaging,
  repairDesktopTransactions: repairUnresolvedDesktopSaveTransactions,
  requestPersistentStorage: requestBrowserPersistentStorage,
};

/** Best-effort startup cleanup. One storage backend failing must not block the other or app startup. */
export async function runStartupStorageMaintenance(
  dependencies: StartupStorageMaintenanceDependencies = DEFAULT_DEPENDENCIES,
): Promise<StartupStorageMaintenanceSummary> {
  const [cloudResult, desktopResult, persistenceResult] = await Promise.allSettled([
    dependencies.cleanupCloudMergeStaging(),
    dependencies.repairDesktopTransactions(),
    (dependencies.requestPersistentStorage ?? requestBrowserPersistentStorage)(),
  ]);
  const summary: StartupStorageMaintenanceSummary = { failedTasks: [] };
  if (cloudResult.status === 'fulfilled') {
    summary.cloudMergeStaging = cloudResult.value;
  } else {
    summary.failedTasks.push('cloud-merge-staging');
    console.warn('[startup-maintenance] cloud merge staging cleanup failed', cloudResult.reason);
  }
  if (desktopResult.status === 'fulfilled') {
    summary.desktopTransactions = desktopResult.value;
  } else {
    summary.failedTasks.push('desktop-save-transactions');
    console.warn('[startup-maintenance] desktop save transaction repair failed', desktopResult.reason);
  }
  if (persistenceResult.status === 'fulfilled') {
    if (persistenceResult.value !== undefined) summary.persistentStorageGranted = persistenceResult.value;
  } else {
    summary.failedTasks.push('persistent-storage');
    console.warn('[startup-maintenance] persistent browser storage request failed', persistenceResult.reason);
  }
  return summary;
}
