import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createDesktopRepository } from '@/core/persistence/desktopRepository';
import type { CoreDesktopTransport } from '@/core/persistence/desktopProtocol';
import { assertRepositoryContract } from './repositoryContract';
import { assertDerivedRepositoryContract } from './derivedRepositoryContract';
import { assertSnapshotRepositoryContract } from './snapshotRepositoryContract';
import { assertAssetRepositoryContract } from './assetRepositoryContract';
import { assertIndexRepositoryContract } from './indexRepositoryContract';
import { assertCommitmentDateRepositoryContract } from './commitmentDateRepositoryContract';
import { assertSourceQueryRepositoryContract } from './sourceQueryRepositoryContract';
import { assertCheckpointRepositoryContract } from './checkpointRepositoryContract';
import { assertBranchRecoveryRepositoryContract } from './branchRecoveryRepositoryContract';
import { assertSaveSlotsRepositoryContract } from './saveSlotsRepositoryContract';
import { assertImportRepositoryContract, makeImportFixture } from './importRepositoryContract';
import { encodePreparedImport } from '@/core/persistence/desktopProtocol';
import { assertExportRepositoryContract } from './exportRepositoryContract';
import {assertIndexMaintenanceContract} from './indexMaintenanceContract';
import { assertJobRunnerContract } from './jobRunnerContract';
import { assertViewQueryContract } from './viewQueryContract';
import { assertJobCommitGuardContract } from './jobCommitGuardContract';
import { assertJobRetryContract } from './jobRetryContract';
import { assertRuntimeRepositoryContract } from './runtimeRepositoryContract';
import { assertNewsRepositoryContract } from './newsRepositoryContract';
import { assertImagePublicationContract } from './imagePublicationContract';
import { assertImageJobContract } from './imageJobContract';
import { assertPhonePhotoContextContract } from './phonePhotoContextContract';
import { assertStoryContentContract } from './storyContentContract';
import { assertJourneyDirectoryContract } from './journeyDirectoryContract';
import { assertProfileCompletionContract } from './profileCompletionContract';

// IPC is substituted, not persistence: every request goes to compiled Rust and real files.
let executable = '';
let root = '';
const children: ChildProcessWithoutNullStreams[] = [];
const roots: string[] = [];
const timings=new Map<string,{count:number;total:number;max:number}>();
const ioTimings = new Map<string, Record<string, number>>();
beforeAll(() => {
  const result = execFileSync(process.env.CORE2_CARGO ?? 'cargo',
    ['test', '--offline', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', '--no-run', '--message-format=json'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const artifacts = result.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line) as { reason: string; executable?: string; profile?: { test: boolean } });
  executable = artifacts.find(row => row.reason === 'compiler-artifact' && row.profile?.test && row.executable)?.executable ?? '';
  expect(executable, 'compiled native test transport must be available').not.toBe('');
}, 600_000);
beforeEach(() => { timings.clear(); ioTimings.clear(); root = mkdtempSync(join(tmpdir(), 'core2-rpc-')); roots.push(root); });
afterEach(async () => {
  const trace = process.env.CORE2_NATIVE_TIMING === '1' || [...timings.values()].reduce((total,row)=>total+row.total,0)>10_000;
  if (trace) console.warn('native-fixture-timing',Object.fromEntries([...timings].map(([action,row])=>[action,{count:row.count,totalMs:Math.round(row.total),averageMs:Math.round(row.total/row.count),maxMs:Math.round(row.max)}])));
  if (trace) console.warn('native-fixture-io', Object.fromEntries(ioTimings));
  await Promise.all(children.splice(0).map(child => new Promise<void>(done => {
    if (child.exitCode !== null) { done(); return; }
    const timer = setTimeout(() => { child.kill(); }, 1000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.stdin.end();
  })));
  for (const directory of roots.splice(0)) {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}\\core2-rpc-`) && !resolve(directory).startsWith(`${resolve(tmpdir())}/core2-rpc-`)) throw new Error('unsafe fixture cleanup');
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
function transport(fault?: (point: 'derived:memories' | 'derived:receipt') => void, importFailure?: { point: string; error: string }): CoreDesktopTransport {
  const child = spawn(executable, ['--ignored', '--exact', 'core2_store_tests::core2_protocol_test_server', '--nocapture'],
    { env: { ...process.env, CORE2_TEST_ROOT: root }, windowsHide: true, stdio: 'pipe' });
  children.push(child);
  let sequence = 0;
  const pending = new Map<number, { action:string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (!line.startsWith('CORE2_TEST_RESPONSE:')) return;
    const row = JSON.parse(line.slice('CORE2_TEST_RESPONSE:'.length)) as { id: number; ok: boolean; result?: unknown; error?: string; elapsedMs:number; ioProfile?: Record<string, number> };
    const item = pending.get(row.id); if (!item) return;
    pending.delete(row.id); clearTimeout(item.timer);
    const timing=timings.get(item.action)??{count:0,total:0,max:0}; timing.count++;timing.total+=row.elapsedMs;timing.max=Math.max(timing.max,row.elapsedMs);timings.set(item.action,timing);
    const io = ioTimings.get(item.action) ?? {}; for (const [key, value] of Object.entries(row.ioProfile ?? {})) io[key] = (io[key] ?? 0) + value; ioTimings.set(item.action, io);
    if (row.ok) item.resolve(row.result); else item.reject(new Error(row.error));
  });
  child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
  child.stdin.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
  child.on('exit', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('native transport exited')); } pending.clear(); lines.close(); });
  return { send(request) {
    if (child.stdin.destroyed || child.stdin.writableEnded || child.exitCode!==null || child.signalCode!==null) return Promise.reject(new Error('native transport closed'));
    let failure: { point: string; error: string } | undefined;
    if (request.action === 'importPrepared' && importFailure) failure = importFailure;
    if (request.action === 'publishDerived' && fault) {
      for (const point of ['derived:memories', 'derived:receipt'] as const) {
        try { fault(point); } catch (error) { failure = { point, error: String(error instanceof Error ? error.message : error) }; break; }
      }
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('native transport timed out')); }, 20_000);
      pending.set(id, { action:request.action,resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, request, ...(failure ? { failure } : {}) })}\n`);
    });
  } };
}
const connect = () => createDesktopRepository(transport());
assertJobRunnerContract(async () => connect());
assertJobCommitGuardContract(async () => connect());
assertJobRetryContract(async () => connect());
assertRuntimeRepositoryContract(async () => connect());
assertNewsRepositoryContract(async () => connect(), wire => transport().send({ action: 'importPrepared', args: [wire] }));
assertImagePublicationContract(async () => connect());
assertImageJobContract(async () => connect());
assertPhonePhotoContextContract(async () => connect(), wire => transport().send({ action: 'importPrepared', args: [wire] }));
assertStoryContentContract(async () => connect());
assertJourneyDirectoryContract(async () => connect());
assertProfileCompletionContract(async () => connect());
assertIndexMaintenanceContract(async()=>connect());
assertExportRepositoryContract(async()=>connect());
assertRepositoryContract(async () => ({ repo: connect(), connect: async () => connect() }));
assertDerivedRepositoryContract(async fault => ({ repo: createDesktopRepository(transport(fault)), connect: async () => connect() }));
assertSnapshotRepositoryContract(async () => connect());
assertAssetRepositoryContract(async () => connect());
assertIndexRepositoryContract(async () => connect());
assertCommitmentDateRepositoryContract(async () => connect());
assertViewQueryContract(async () => connect());
assertSourceQueryRepositoryContract(async () => connect());
assertCheckpointRepositoryContract(async () => connect());
assertBranchRecoveryRepositoryContract(async () => connect());
assertSaveSlotsRepositoryContract(async () => connect());
assertImportRepositoryContract(async () => {
  root = mkdtempSync(join(tmpdir(), 'core2-rpc-')); roots.push(root);
  return connect();
});
describe('desktop transport boundary', () => {
  it.each(['publication-blocks', 'publication-manifest'])('an import failure at %s leaves no head or resource and can reconnect and retry', async point => {
    const { value } = await makeImportFixture(connect()); const wire = encodePreparedImport(value);
    root = mkdtempSync(join(tmpdir(), 'core2-rpc-')); roots.push(root);
    const failing = transport(undefined, { point, error: 'import-interrupted' });
    await expect(failing.send({ action: 'importPrepared', args: [wire] })).rejects.toThrow('import-interrupted');
    const next = transport();
    await expect(next.send({ action: 'readHead', args: [value.manifest.scope] })).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    expect(await next.send({ action: 'readAsset', args: ['asset-fixture'] })).toBeNull();
    expect(await next.send({ action: 'importPrepared', args: [wire] })).toEqual(value.branches[0]!.state.head);
    expect(await next.send({ action: 'readState', args: [value.manifest.scope] })).toEqual(value.branches[0]!.state);
  });
  it('the native import rejects forged graphs even when the frontend validator is bypassed', async () => {
    const { value } = await makeImportFixture(connect());
    const wire = encodePreparedImport(value);
    root = mkdtempSync(join(tmpdir(), 'core2-rpc-')); roots.push(root);
    const api = transport();
    for (const mutate of [
      (input: typeof wire) => { input.sources = input.sources.filter(row => row.commitSeq === 0); },
      (input: typeof wire) => { input.events[0]!.evidenceRefs[0]!.quote = '砂糖把一枚苹果放入玩家背包。'; },
      (input: typeof wire) => { input.sources.find(row => row.commitSeq === 1)!.commitSeq = 2; },
      (input: typeof wire) => { input.operations[0]!.receipt!.eventIds = []; },
      (input: typeof wire) => { const item = input.branches[0]!.state.records.find(row => row.domain === 'inventory')!; if (item.domain === 'inventory' && item.value.kind === 'item') item.value.quantity = 999; },
      (input: typeof wire) => { input.assets = []; },
      (input: typeof wire) => { input.events[0]!.replyToEventId = 'missing-reply-anchor'; },
      (input: typeof wire) => { input.events[0]!.replyToEventId = input.events[0]!.eventId; },
    ]) {
      const bad = structuredClone(wire); mutate(bad);
      await expect(api.send({ action: 'importPrepared', args: [bad] })).rejects.toThrow(/CORE2_IMPORT_/);
    }
    await expect(api.send({ action: 'readHead', args: [value.manifest.scope] })).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    expect(await api.send({ action: 'readAsset', args: ['asset-fixture'] })).toBeNull();
    expect(await api.send({ action: 'importPrepared', args: [wire] })).toEqual(value.branches[0]!.state.head);
  });
  it('rejects unknown actions and never turns native failures into a browser database', async () => {
    const api = transport();
    await expect(api.send({ action: 'readFile', path: 'C:/Users/zhong' } as never)).rejects.toThrow();
    await expect(connect().readHead({ journeyId: 'missing', branchId: 'missing' })).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
  });
});
