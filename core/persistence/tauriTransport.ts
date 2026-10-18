import type { CoreDesktopTransport } from './desktopProtocol';

/** No data-path argument and no browser fallback on native failure. */
export function createTauriCoreTransport(): CoreDesktopTransport {
  return { async send(request) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<unknown>('core2_store_request', { request });
  } };
}
