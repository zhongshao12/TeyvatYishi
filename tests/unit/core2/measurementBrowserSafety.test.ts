// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
// Lifecycle only: retrieval correctness has separate real-repository tests.
// Avoid paying for twenty full ranking runs just to detect a second database open.
vi.mock('@/core/retrieval/retrieveMemory', () => ({ retrieveCoreMemories: vi.fn(async () => ({ selectedLeafIds: ['fixture-leaf'] })) }));

async function loadHarness(factory: IDBFactory) {
  vi.resetModules(); vi.stubGlobal('indexedDB', factory);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  document.body.innerHTML = '<button id="build-100"></button><button id="build-1000"></button><button id="measure"></button><button id="export"></button><button id="reset"></button><p id="status"></p><pre id="output"></pre>';
  await import('@/tests/browser/core2-long-session');
}
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('serializes destructive fixture actions and never reports a blocked database deletion as completed', async () => {
  const factory = new IDBFactory(), request = factory.open('test-core2-browser-long-session');
  const held = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  let blocked = false;
  const original = factory.deleteDatabase.bind(factory), deleting = vi.spyOn(factory, 'deleteDatabase').mockImplementation(name => {
    const result = original(name); result.addEventListener('blocked', () => { blocked = true; }); return result;
  });
  try {
    await loadHarness(factory); button('reset').click(); button('reset').click();
    await vi.waitFor(() => expect(blocked).toBe(true));
    expect(deleting).toHaveBeenCalledTimes(1);
    expect(button('build-100').disabled).toBe(true);
    expect(document.querySelector('#status')!.textContent).toContain('等待其它测试页关闭');
    expect(document.querySelector('#status')!.textContent).not.toContain('已删除');
    held.close(); await vi.waitFor(() => expect(button('build-100').disabled).toBe(false));
    expect(document.querySelector('#status')!.textContent).toBe('测试库已删除。');
  } finally { held.close(); }
});

it('keeps an implicitly created corpus for the next measurement instead of deleting and rebuilding it', async () => {
  const factory = new IDBFactory(), deleting = vi.spyOn(factory, 'deleteDatabase');
  await loadHarness(factory);
  button('measure').click();
  await vi.waitFor(() => expect(document.querySelector('#status')!.textContent).toContain('测量完成'), { timeout: 30_000 });
  expect(deleting).toHaveBeenCalledTimes(1);
  button('measure').click();
  await vi.waitFor(() => expect(document.querySelector('#output')!.textContent!.split('"kind":"core2-browser-long-session-measure"')).toHaveLength(3), { timeout: 30_000 });
  expect(deleting).toHaveBeenCalledTimes(1);
  let exported: Blob | undefined;
  const ownURL = globalThis.URL;
  vi.stubGlobal('URL', class extends ownURL {
    static override createObjectURL(blob: Blob) { exported = blob; return 'blob:fixture'; }
    static override revokeObjectURL() { /* Synthetic download, no real browser resource. */ }
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await vi.waitFor(() => expect(button('export').disabled).toBe(false)); button('export').click();
  const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(exported!); });
  const report = JSON.parse(text) as { kind: string }[];
  expect(report.filter(row => row.kind === 'core2-browser-long-session-measure')).toHaveLength(2);
}, 65_000);
