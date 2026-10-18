import type { BranchHead, CoreScope, RecordRef } from '../contracts/identity';
import type { StateRecord, CoreSnapshot } from '../contracts/state';
import type { ExportRecords, PreparedImport } from '../contracts/storage';
import { dataFields } from './binaryAssets';
import { ownPreparedImport, validateImportGraph } from './preparedImports';
import { ownDto, refKey, sameScope } from './repositoryValidation';
import { checkpointForState } from './snapshots';
import { isCoreJsonData } from '../contracts/validation';
import { stateAssetIds } from './stateAssets';
import { packageContainsPrivateData } from './packagePrivacy';
import { isRegisteredStagedJobSource } from './stagedJobSources';
import { readCoreImagePlan, CORE_IMAGE_PLAN_PREFIX } from '../jobs/imagePlan';

const fields = ['scope','branches','sources','events','operations','memories','knowledge','commitments','jobs','snapshots','slots','assets'];
/** Copy and validate IPC / storage metadata before deriving any export. */
export function ownExportRecords(input: ExportRecords): ExportRecords {
  const data = dataFields(input,fields,'CORE2_INVALID_EXPORT');
  const { assets, ...json } = data;
  if (!isCoreJsonData(json) || !Array.isArray(json.branches)) throw new Error('CORE2_INVALID_EXPORT');
  const scope = ownDto('scope',json.scope as CoreScope);
  const branches = (structuredClone(json.branches) as ExportRecords['branches']).map(row=>{
    dataFields(row,row.originSnapshotId===undefined?['head','playerId']:['head','playerId','originSnapshotId'],'CORE2_INVALID_EXPORT');
    return {...row,head:ownDto('head',row.head)};
  });
  const {scope:_scope,branches:_rawBranches,...payload}=json;
  const owned = ownPreparedImport({ ...payload, assets,
    manifest:{kind:'teyvat-core2-package',formatVersion:1,scope,snapshotId:'export-validation',files:[],containsPrivateData:true},
    branches:branches.map(row=>({playerId:row.playerId,state:{head:row.head,records:[],contentRefs:[]},...(row.originSnapshotId?{originSnapshotId:row.originSnapshotId}:{})})),
  } as unknown as PreparedImport);
  const {manifest:_manifest,branches:_branches,...records}=owned;
  return {...records,scope,branches};
}

/** Reconstruct each ancestor at its fork position, never from its future live state. */
export function prepareExportGraph(input: ExportRecords): PreparedImport {
  const data=ownExportRecords(input), bounds=new Map<string,{scope:CoreScope;seq:number;revision:number}>();
  let row=data.branches.find(row=>sameScope(row.head.scope,data.scope));
  if (!row) throw new Error('CORE2_EXPORT_LINEAGE');
  let seq=row.head.coreSeq,revision=row.head.memoryRevision;
  while(row) {
    const head:BranchHead=row.head;
    if(bounds.has(head.scope.branchId) || head.scope.journeyId!==data.scope.journeyId || seq>head.coreSeq || revision>head.memoryRevision) throw new Error('CORE2_EXPORT_LINEAGE');
    bounds.set(head.scope.branchId,{scope:head.scope,seq,revision});
    if(!head.parent) break;
    seq=Math.min(seq,head.forkSeq!);revision=Math.min(revision,head.forkMemoryRevision!);
    row=data.branches.find(row=>sameScope(row.head.scope,head.parent!));
    if(!row) throw new Error('CORE2_EXPORT_LINEAGE');
  }
  if(bounds.size!==data.branches.length) throw new Error('CORE2_EXPORT_LINEAGE');
  const within=(scope:CoreScope,cut:number,rev?:number)=>{
    const bound=bounds.get(scope.branchId);
    return !!bound && sameScope(bound.scope,scope) && cut<=bound.seq && (rev===undefined || rev<=bound.revision);
  };
  const operations=data.operations.filter(op=>op.status==='committed' ? !!op.receipt && within(op.scope,op.receipt.coreSeq) : sameScope(op.scope,data.scope));
  const sources=data.sources.filter(source=>source.commitSeq===null ? operations.some(op=>op.status!=='committed' && sameScope(op.scope,source.record.scope) && op.operationId===source.record.operationId)
    || sameScope(source.record.scope,data.scope) && data.jobs.some(job=>within(job.record.scope,job.commitSeq) && isRegisteredStagedJobSource(source.record,job.record)) : within(source.record.scope,source.commitSeq));
  const events=data.events.filter(event=>within({journeyId:event.journeyId,branchId:event.branchId},event.commitSeq));
  const snapshots=data.snapshots.filter(snapshot=>within(snapshot.scope,snapshot.coreSeq,snapshot.memoryRevision));
  const memories=data.memories.filter(row=>within(row.record.scope,row.commitSeq,row.publishedRevision));
  const jobs=data.jobs.filter(row=>within(row.record.scope,row.commitSeq)).map(row=>{
    const outside=!!row.publication && !within(row.record.scope,row.commitSeq,row.publication.receipt.memoryRevision);
    if(row.record.status==='running' || outside) {
      // A held lease cannot resume on another machine. Keep sources and lease
      // history, but never pretend a clipped future summary was published.
      return {record:{...row.record,status:'failed' as const,leaseId:null,steps:outside?[]:row.record.steps,
        failure:{code:'CORE2_IMPORT_INTERRUPTED',detail:outside?'Output is beyond the exported fork.':'Active work was interrupted by export.'}},
        commitSeq:row.commitSeq,leaseIds:row.leaseIds,...(!outside && row.publication?{publication:row.publication}:{})};
    }
    return row;
  });
  for (let index = 0; index < jobs.length; index++) {
    const row = jobs[index]!, id = row.record.retriedByJobId;
    if (!id) continue;
    const next = data.jobs.find(target => sameScope(target.record.scope, row.record.scope) && target.record.jobId === id);
    if (next && !within(next.record.scope, next.commitSeq)) {
      // Exported history stops at the fork. Only clip a proven future link in
      // this detached package; never mutate the live parent or hide corruption.
      const record = { ...row.record }; delete record.retriedByJobId;
      jobs[index] = { ...row, record };
    }
  }
  const branches=data.branches.map(branch=>{
    const bound=bounds.get(branch.head.scope.branchId)!;
    const head={...branch.head,coreSeq:bound.seq,memoryRevision:bound.revision};
    const baseline=head.parent ? snapshots.find(row=>row.snapshotId===branch.originSnapshotId) : snapshots.find(row=>sameScope(row.scope,head.scope)&&row.coreSeq===0&&row.memoryRevision===0);
    if(!baseline) throw new Error('CORE2_EXPORT_BASELINE');
    const state=new Map<string,{record:StateRecord|null;ref:RecordRef}>();
    for(const record of baseline.state.records) state.set(refKey(record),{record:{...record,scope:head.scope},ref:{domain:record.domain,entityId:record.entityId,version:record.version}});
    for(const ref of baseline.state.tombstones??[]) state.set(refKey(ref),{record:null,ref});
    for(const event of events.filter(event=>event.branchId===head.scope.branchId && event.commitSeq>(head.forkSeq??0)).sort((a,b)=>a.commitSeq-b.commitSeq))
      for(const change of event.committedChanges) state.set(refKey(change.ref),{record:change.after,ref:{...change.ref,version:change.ref.version+1}});
    const projection:CoreSnapshot={head,contentRefs:baseline.state.contentRefs,records:[...state.values()].flatMap(row=>row.record?[row.record]:[]),tombstones:[...state.values()].filter(row=>!row.record).map(row=>row.ref)};
    return {playerId:branch.playerId,state:projection,...(branch.originSnapshotId?{originSnapshotId:branch.originSnapshotId}:{})};
  });
  const selected=branches.find(row=>sameScope(row.state.head.scope,data.scope))!;
  const selectedSnapshot=checkpointForState(selected.state); snapshots.push(selectedSnapshot);
  const slots=data.slots.filter(slot=>snapshots.some(snapshot=>snapshot.snapshotId===slot.snapshotId));
  const assetIds=new Set<string>();
  const collect=(record:StateRecord)=>stateAssetIds(record).forEach(id=>assetIds.add(id));
  [...branches.map(row=>row.state),...snapshots.map(row=>row.state)].forEach(state=>state.records.forEach(collect));
  events.forEach(event=>event.committedChanges.forEach(change=>{if(change.before) collect(change.before);if(change.after) collect(change.after);}));
  sources.forEach(source => source.record.assetRefs?.forEach(id => assetIds.add(id)));
  for (const job of jobs) if (sameScope(job.record.scope, data.scope) && job.record.kind === 'image' && job.record.configFingerprint.startsWith(CORE_IMAGE_PLAN_PREFIX)) assetIds.add(readCoreImagePlan(job.record).assetId);
  const value:PreparedImport={manifest:{kind:'teyvat-core2-package',formatVersion:1,scope:data.scope,snapshotId:selectedSnapshot.snapshotId,files:[],
    containsPrivateData:false},
    branches,sources,events,operations,memories,
    knowledge:data.knowledge.filter(row=>within(row.record.scope,row.commitSeq)),commitments:data.commitments.filter(row=>within(row.record.scope,row.commitSeq)),jobs,
    snapshots,slots,assets:data.assets.filter(asset=>assetIds.has(asset.assetId))};
  value.manifest.containsPrivateData=packageContainsPrivateData(value);
  validateImportGraph(value); return value;
}
