import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { CORE_PACKAGE_LIMITS, encodeCorePackage, exportCorePackage, prepareCoreImport, remapCoreImport } from '@/core/persistence/packageTransfer';
import { makeImportFixture } from './importRepositoryContract';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { coreSummaryFingerprint, readCoreSummaryPlan, DEFAULT_CORE_MEMORY_SETTINGS } from '@/core/jobs/summaryPlan';
import { readCorePhonePlan, serializeCorePhonePlan } from '@/core/jobs/phonePlan';
import { validateImportGraph } from '@/core/persistence/preparedImports';

it('exports and prepares a validated package without opening or publishing a destination',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-package-export'});
  const {batch}=await makeImportFixture(repo);
  const file=await exportCorePackage(repo,batch.scope);
  const prepared=await prepareCoreImport(file);
  expect(prepared.manifest.kind).toBe('teyvat-core2-package');
  expect(prepared.manifest.formatVersion).toBe(1);
  expect(prepared.branches.find(row=>row.state.head.scope.branchId===prepared.manifest.scope.branchId)?.state.records).toHaveLength(11);
  expect(Array.from(prepared.assets[0]!.bytes)).toEqual([0,255,128,10]);
});

it('remaps registered frozen job plans, but never rewrites prompt prose or unknown fingerprints', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-job-plan-remap' });
  const { value } = await makeImportFixture(repo), job = value.jobs[0]!.record;
  const oldScope = structuredClone(job.scope), prose = `不要改写 ${oldScope.journeyId} ${job.operationId}`;
  job.configFingerprint = coreSummaryFingerprint(job.scope, job.operationId, { ...DEFAULT_CORE_MEMORY_SETTINGS, prompt: prose });
  const summary = remapCoreImport(value).jobs[0]!.record, plan = readCoreSummaryPlan(summary);
  expect(plan.scope).toEqual(summary.scope); expect(plan.scope).not.toEqual(oldScope); expect(plan.operationId).toBe(summary.operationId); expect(plan.settings.prompt).toBe(prose);
  job.kind = 'courier';
  job.configFingerprint = serializeCorePhonePlan({ version: 1, scope: job.scope, target: 'private', channelId: 'existing-channel', npcId: 'npc-amber', playerEventId: value.events[0]!.eventId, playerOperationId: job.operationId, replyOperationId: 'old-reply-operation', outputSourceRef: { sourceId: 'old-reply-source', sourceVersion: 1 }, modelIdentity: 'existing-model', summarySettings: { ...DEFAULT_CORE_MEMORY_SETTINGS, prompt: prose } });
  const imported = remapCoreImport(value), phone = imported.jobs[0]!.record, phonePlan = readCorePhonePlan(phone);
  expect(phonePlan.scope).toEqual(phone.scope); expect(phonePlan.playerOperationId).toBe(phone.operationId); expect(phonePlan.playerEventId).toBe(imported.events[0]!.eventId);
  expect(phonePlan.replyOperationId).not.toBe('old-reply-operation'); expect(phonePlan.outputSourceRef.sourceId).not.toBe('old-reply-source'); expect(phonePlan.summarySettings.prompt).toBe(prose);
  job.configFingerprint = `custom-config:${prose}`;
  expect(remapCoreImport(value).jobs[0]!.record.configFingerprint).toBe(job.configFingerprint);
});

it.each(['missing-original-event', 'self'])('rejects an imported reply pointing to %s', async target => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-import-reply-${target}` });
  const { value } = await makeImportFixture(repo);
  value.events[0]!.replyToEventId = target === 'self' ? value.events[0]!.eventId : target;
  expect(() => validateImportGraph(value)).toThrow('CORE2_IMPORT_REPLY_PROVENANCE');
});
it('rejects a legacy schema package without interpreting it as an empty new journey',async()=>{
  await expect(prepareCoreImport(new Blob([JSON.stringify({schemaVersion:2,存档名称:'旧档'})]))).rejects.toThrow();
});
it('rejects unknown future versions, altered bytes and excessive decompression',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-package-limits'});
  const {batch}=await makeImportFixture(repo),file=await exportCorePackage(repo,batch.scope);
  const bytes=new Uint8Array(await file.arrayBuffer()),changed=new Uint8Array(bytes);
  const prefix=new TextEncoder().encode('TEYVAT-CORE2\n').length+4;
  const header=new TextDecoder().decode(bytes.subarray(prefix,prefix+new DataView(bytes.buffer).getUint32(prefix-4,true)));
  const index=header.indexOf('"formatVersion":1');expect(index).toBeGreaterThanOrEqual(0);
  changed[prefix+index+'"formatVersion":'.length]=50;
  await expect(prepareCoreImport(new Blob([changed]))).rejects.toThrow('CORE2_PACKAGE_VERSION');
  changed.set(bytes);changed[changed.length-1]=changed[changed.length-1]!^1;
  await expect(prepareCoreImport(new Blob([changed]))).rejects.toThrow('CORE2_PACKAGE_CHECKSUM');
  await expect(prepareCoreImport(file,{...CORE_PACKAGE_LIMITS,maxUnpackedBytes:100})).rejects.toThrow(/超过|too|大小/);
});
it('rejects missing references and credential fields rather than stripping evidence',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-package-secrets'}),{value}=await makeImportFixture(repo);
  const missing=structuredClone(value);missing.sources=[];
  await expect(encodeCorePackage(missing)).rejects.toThrow('CORE2_IMPORT_SOURCE_NOT_REACHABLE');
  const secret=structuredClone(value) as typeof value & {apiKey:string};secret.apiKey='private-test-key';
  await expect(encodeCorePackage(secret)).rejects.toThrow();
  const valid=await exportCorePackage(repo,value.manifest.scope);
  expect(new TextDecoder().decode(await valid.arrayBuffer())).not.toContain('private-test-key');
});
it('maps only identifier fields and preserves prose even when it contains an old ID',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-package-identifiers'}),{value}=await makeImportFixture(repo);
  const originalId=value.sources[0]!.record.ref.sourceId;
  value.sources[0]!.record.blocks.push({blockId:'extra-text',kind:'content',text:`玩家提到 ${originalId} 不是技术引用`});
  const next=remapCoreImport(value);
  expect(next.sources[0]!.record.ref.sourceId).not.toBe(originalId);
  expect(next.sources[0]!.record.blocks.at(-1)?.text).toBe(`玩家提到 ${originalId} 不是技术引用`);
  expect(next.snapshots.every(snapshot=>snapshot.scope.journeyId===next.manifest.scope.journeyId)).toBe(true);
});
it('keeps asset: image links intact after ID collisions are remapped, without rewriting prose',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-package-avatar'}),{value}=await makeImportFixture(repo);
  const assign=(records:typeof value.branches[0]['state']['records'])=>{const npc=records.find(row=>row.domain==='npc');if(npc?.domain==='npc') {npc.value.avatar='asset:asset-fixture';npc.value.appearance='提到了 asset:asset-fixture，这是文字';}};
  value.branches.forEach(row=>assign(row.state.records));value.snapshots.forEach(row=>{assign(row.state.records);row.checksum=checksumUtf8(stableJson(row.state));});
  const next=remapCoreImport(value),npc=next.branches[0]!.state.records.find(row=>row.domain==='npc');
  expect(npc?.domain==='npc' && npc.value.avatar).toBe(`asset:${next.assets[0]!.assetId}`);
  expect(npc?.domain==='npc' && npc.value.appearance).toBe('提到了 asset:asset-fixture，这是文字');
});
