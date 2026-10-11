import { createAppStorageAdapter } from '@/services/storage/appStorageAdapter';

/** Exclusive create is implemented by Rust create_new, so separate app instances
 * share the same lock. A stale lock is never stolen merely because it is old. */
export async function withDesktopStorageLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const adapter = createAppStorageAdapter();
  const path = `locks/${name}.lock`;
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 3000;
  while (!await adapter.writeTextExclusive(path, owner)) {
    if (Date.now() >= deadline) throw new Error('桌面存储正由另一实例更新，或存在未解除的锁；已停止写入，请关闭其他实例后重试。');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try {
    return await operation();
  } finally {
    if (await adapter.readText(path) === owner) await adapter.remove(path);
  }
}
