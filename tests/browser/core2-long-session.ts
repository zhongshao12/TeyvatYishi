/**
 * M09 browser harness: real IndexedDB, no fake-indexeddb, no product App import.
 * Serve the repository with `vite` and open /tests/browser/core2-long-session.html.
 * It uses its own `test-core2-browser-*` database and never touches player data.
 */
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import type { CoreRepository } from '@/core/contracts/storage';
import { makeSeed } from '@/tests/unit/core2/fixtures';
import { commitCorpusTurn, corpusMoment, type CorpusEventSpec, type CorpusSession } from '@/tests/unit/core2/coreSessionHarness';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';

const DATABASE = 'test-core2-browser-long-session';
const NPCS = ['npc-amber', 'npc-lisa', 'npc-jean', 'npc-kaeya', 'npc-barbara', 'npc-diluc'];
const LOCATIONS = ['蒙德城', '风起地', '鹰翔海滩', '千风神殿', '低语森林'];
const output = document.querySelector<HTMLPreElement>('#output');
const status = document.querySelector<HTMLParagraphElement>('#status');

function report(kind: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({ kind, at: new Date().toISOString(), ...payload });
  if (output) output.textContent = `${output.textContent ?? ''}${line}\n`;
  console.log(line);
}
function say(message: string): void { if (status) status.textContent = message; }

function syntheticEvents(turn: number): CorpusEventSpec[] {
  return Array.from({ length: 5 }, (_, index) => {
    const actor = NPCS[(turn + index) % NPCS.length]!, location = LOCATIONS[(turn + index) % LOCATIONS.length]!;
    return {
      eventId: `event-b${String(turn).padStart(5, '0')}-${index}`, type: 'narrative.observe', actors: [actor], targets: [],
      text: `第${turn}回合·第${index + 1}段：${actor.slice(4)}在${location}记录了第${turn}次旅途见闻。`, location,
      visibility: { kind: 'public' as const, npcIds: [] }, knowledge: ['witnessed' as const], knowledgeNpcIds: [actor],
    };
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? Error('delete failed'));
    // The deletion request is still pending. Keep the exclusive action active
    // until onsuccess rather than claiming the fixture disappeared.
    request.onblocked = () => say('等待其它测试页关闭，测试库尚未删除。');
  });
}

async function open(): Promise<CorpusSession> {
  await deleteDatabase();
  const repo: CoreRepository = createIndexedRepository({ databaseName: DATABASE }), seed = makeSeed();
  await repo.initialize(seed);
  return { repo, seed, scope: seed.head.scope, sessionId: seed.head.sessionId, head: seed.head, committedTurns: 0, databaseName: DATABASE };
}

async function buildSession(session: CorpusSession, turns: number): Promise<void> {
  const started = performance.now();
  for (let turn = 1; turn <= turns; turn += 1) {
    if (turn % 25 === 0) say(`正在提交第 ${turn} / ${turns} 回合……`);
    await commitCorpusTurn(session, { turn, events: syntheticEvents(turn) });
  }
  const buildMs = Math.round(performance.now() - started);
  report('core2-browser-long-session-build', {
    turns, events: turns * 5, coreSeq: session.head.coreSeq, buildMs,
    turnsPerSecond: Math.round((turns / Math.max(1, buildMs)) * 1000 * 10) / 10,
    heapMB: 'memory' in performance ? Math.round(((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize) / 1024 / 1024) : null,
  });
  say(`造数完成：${turns} 回合 / ${turns * 5} 事件，${buildMs} ms。`);
}

async function measure(session: CorpusSession, turns: number): Promise<void> {
  const stateStarted = performance.now();
  const state = await session.repo.readState(session.scope);
  const readStateMs = Math.round((performance.now() - stateStarted) * 100) / 100;
  const sourceStarted = performance.now();
  const firstSource = await session.repo.readSource({ sourceId: 'source-0001', sourceVersion: 1 });
  const firstSourceReadMs = Math.round((performance.now() - sourceStarted) * 100) / 100;
  const checkpoint = await session.repo.readRecoveryCheckpoint(session.scope);
  const head = await session.repo.readHead(session.scope);
  const durations: number[] = []; let selectedLeaves = 0;
  for (let sample = 0; sample < 20; sample += 1) {
    say(`正在测量第 ${sample + 1} / 20 次召回（简化负载，不是正式验收）……`);
    const turn = 1 + ((sample * 37) % Math.max(1, turns));
    const started = performance.now();
    const recalled = await retrieveCoreMemories({
      scope: session.scope, head, audience: { target: 'main', npcIds: [] }, entityIds: [NPCS[sample % NPCS.length]!],
      locations: [LOCATIONS[sample % LOCATIONS.length]!], query: `第${turn}回合 ${LOCATIONS[sample % LOCATIONS.length]} 旅途见闻`,
      moment: corpusMoment(Math.max(1, turns), `op-browser-${sample}`), k: 8,
    }, { repo: session.repo });
    selectedLeaves += recalled.selectedLeafIds.length;
    durations.push(Math.round((performance.now() - started) * 100) / 100);
  }
  const sorted = [...durations].sort((a, b) => a - b);
  report('core2-browser-long-session-measure', {
    measurementScope: 'ledger-only', acceptancePassed: false,
    turns, records: state.records.length, sourceFound: Boolean(firstSource), readStateMs, firstSourceReadMs,
    checkpointSeq: checkpoint.coreSeq, recoveryCommits: head.coreSeq - checkpoint.coreSeq,
    recallSamples: durations.length, selectedLeaves, recallMedianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    recallP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
    recallMaxMs: sorted[sorted.length - 1] ?? 0,
  });
  say('测量完成：结果见下方 JSON。');
}

function download(name: string): void {
  const text = JSON.stringify((output?.textContent ?? '').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as unknown), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

let session: CorpusSession | null = null;
let builtTurns = 0;
let busy = false;
const setBusy = (value: boolean) => { busy = value; for (const button of document.querySelectorAll<HTMLButtonElement>('.row button, #build-100, #build-1000, #measure, #export, #reset')) button.disabled = value; };
const bind = (id: string, handler: () => Promise<void>) => {
  document.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', () => {
    if (busy) return;
    setBusy(true);
    void handler().catch((error: unknown) => { say(`失败：${String(error)}`); report('core2-browser-long-session-error', { id, error: String(error) }); }).finally(() => setBusy(false));
  });
};
bind('build-100', async () => { session = await open(); builtTurns = 0; await buildSession(session, 100); builtTurns = 100; });
bind('build-1000', async () => { session = await open(); builtTurns = 0; await buildSession(session, 1000); builtTurns = 1000; });
bind('measure', async () => { session ??= await open(); if (!builtTurns) { await buildSession(session, 100); builtTurns = 100; } await measure(session, builtTurns); });
bind('export', async () => { download('core2-long-session.json'); });
bind('reset', async () => { await deleteDatabase(); session = null; builtTurns = 0; say('测试库已删除。'); });
report('core2-browser-long-session-ready', { database: DATABASE, fakeIndexedDB: false });
