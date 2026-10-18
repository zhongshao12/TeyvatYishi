import { expect,it } from 'vitest';
import { createFormatRegistry,upgradeCoreFormat } from '@/core/persistence/formatUpgrade';
import type { FormatEnvelope,FormatUpgradeRepository } from '@/core/persistence/formatUpgrade';

function fixture(fail=false) {
  let current:FormatEnvelope={formatVersion:1,revision:'revision-1',payload:{facts:['原始事件'],source:'不可丢失'}};
  const backups=new Map<string,FormatEnvelope>();
  const repo:FormatUpgradeRepository={
    async readFormat(){return structuredClone(current);},
    async saveFormatBackup(id,expected){if(current.revision!==expected || backups.has(id)) throw new Error('conflict');backups.set(id,structuredClone(current));},
    async readFormatBackup(id){return structuredClone(backups.get(id)??null);},
    async publishUpgradedFormat(value,expected,id){if(fail) throw new Error('interrupted');if(current.revision!==expected || !backups.has(id)) throw new Error('conflict');current=structuredClone(value);},
  };
  return {repo,backups,current:()=>current};
}
const conversion={from:1,to:2,convert:(value:unknown)=>({...value as object,testOnlyVersion:2}),validate:(value:unknown)=>({ok:!!value && typeof value==='object' && 'source' in value,errors:[],checkedRecords:2})};
it('backs up before a registered artificial 1→2 conversion and atomically publishes the validated result',async()=>{
  const {repo,backups,current}=fixture();
  expect(await upgradeCoreFormat(repo,{from:1,to:2,backupId:'backup-test',registry:createFormatRegistry([conversion])})).toEqual({ok:true,errors:[],checkedRecords:2});
  expect(backups.get('backup-test')?.payload).toEqual({facts:['原始事件'],source:'不可丢失'});
  expect(current().formatVersion).toBe(2);
});
it('leaves the previous version untouched when conversion, validation or publication fails',async()=>{
  for(const mode of ['convert','validate','publish']) {
    const {repo,current}=fixture(mode==='publish');
    const registered={...conversion,...(mode==='convert'?{convert:()=>{throw new Error('conversion failed');}}:mode==='validate'?{validate:()=>({ok:false,errors:['invalid output'],checkedRecords:1})}:{})};
    expect((await upgradeCoreFormat(repo,{from:1,to:2,backupId:'backup-test',registry:createFormatRegistry([registered])})).ok).toBe(false);
    expect(current()).toEqual({formatVersion:1,revision:'revision-1',payload:{facts:['原始事件'],source:'不可丢失'}});
  }
});
it('rejects unknown versions, unregistered transitions and unsafe backup identifiers',async()=>{
  const {repo,backups}=fixture();
  for(const request of [
    {from:1,to:3,backupId:'backup'}, {from:2,to:3,backupId:'backup'}, {from:1,to:2,backupId:'../old'},
  ]) expect((await upgradeCoreFormat(repo,{...request,registry:createFormatRegistry([conversion])})).ok).toBe(false);
  expect(backups.size).toBe(0);
});
it('does not overwrite an existing backup and verifies that the backup really matches the captured version',async()=>{
  const {repo,current}=fixture();
  let reads=0;
  const corrupt={...repo,readFormatBackup:async()=>++reads===1?null:{formatVersion:1,revision:'wrong',payload:{}}};
  expect((await upgradeCoreFormat(corrupt,{from:1,to:2,backupId:'backup',registry:createFormatRegistry([conversion])})).ok).toBe(false);
  expect(current().formatVersion).toBe(1);
  expect((await upgradeCoreFormat(repo,{from:1,to:2,backupId:'backup',registry:createFormatRegistry([conversion])})).ok).toBe(false);
});
it('rejects a concurrent revision change at atomic publication instead of overwriting it',async()=>{
  const {repo,current}=fixture();
  const concurrent={...repo,publishUpgradedFormat:async()=>{throw new Error('CORE2_UPGRADE_REVISION_CHANGED');}};
  const result=await upgradeCoreFormat(concurrent,{from:1,to:2,backupId:'backup',registry:createFormatRegistry([conversion])});
  expect(result.errors).toEqual(['CORE2_UPGRADE_REVISION_CHANGED']);expect(current().formatVersion).toBe(1);
});
it('validates every registered step and publishes only the final version, not intermediate partial upgrades',async()=>{
  const {repo,current,backups}=fixture();
  const result=await upgradeCoreFormat(repo,{from:1,to:3,backupId:'backup-chain',registry:createFormatRegistry([conversion,{...conversion,from:2,to:3}])});
  expect(result).toEqual({ok:true,errors:[],checkedRecords:4});expect(current().formatVersion).toBe(3);expect(backups.size).toBe(1);
});
