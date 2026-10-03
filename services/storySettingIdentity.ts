let sessionReader: (() => number) | null = null;
const bootId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function registerStorySettingSession(reader: (() => number) | null): void { sessionReader = reader; }
/** The startup library remains backward compatible; loaded games use isolated runtime caches.
 * Authoritative durable state is in each save payload, never a player-name keyed setting. */
export function resolveSessionSettingKey(key: string): string {
  const session = sessionReader?.();
  return key === 'storyWeavingSystem' && session !== undefined && session !== 0 ? `${key}.session.${bootId}.${session}` : key;
}
