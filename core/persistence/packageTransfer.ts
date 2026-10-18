import type { CoreScope } from '../contracts/identity';
import type { CoreRepository, PreparedImport, CoreAsset } from '../contracts/storage';
import { packCloudBackupPart, unpackCloudBackupPart, sha256Hex } from '@/services/cloudBackupPackage';
import { findApiKeyFieldPaths } from '@/services/storage/sensitiveSettings';
import { prepareExportGraph } from './exportGraph';
import { ownPreparedImport, validateImportGraph } from './preparedImports';
import { dataFields } from './binaryAssets';
import { ownDto, stableJson, sameScope } from './repositoryValidation';
import { isCoreJsonData } from '../contracts/validation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { STATE_IMAGE_FIELDS } from './stateAssets';
import { packageContainsPrivateData } from './packagePrivacy';

const magic=new TextEncoder().encode('TEYVAT-CORE2\n');
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export const CORE_PACKAGE_LIMITS={maxFileBytes:91*1024*1024,maxEntryBytes:96*1024*1024,maxUnpackedBytes:128*1024*1024,maxEntries:4096};
function noCredentials(value:unknown) {
  if(findApiKeyFieldPaths(value).length) throw new Error('CORE2_PACKAGE_CONTAINS_CREDENTIALS');
  const inspect=(value:unknown):void=>{
    if(!value || typeof value!=='object') return;
    for(const [key,item] of Object.entries(value)) {
      if(/^(?:githubToken|accessToken|refreshToken|authorization|password|secret)$/i.test(key) && item) throw new Error('CORE2_PACKAGE_CONTAINS_CREDENTIALS');
      inspect(item);
    }
  };
  inspect(value);
}
function encodeJson(value:unknown):Uint8Array { noCredentials(value);return encoder.encode(stableJson(value)); }
/** Pure local byte transport reuse; it does not invoke cloud/network backup. */
export async function encodeCorePackage(input:PreparedImport):Promise<Blob> {
  const value=ownPreparedImport(input);validateImportGraph(value);
  value.manifest.containsPrivateData=value.manifest.containsPrivateData || packageContainsPrivateData(value);
  const {manifest,assets,...graph}=value;
  const entries=[{name:'graph.json',bytes:encodeJson({...graph,assets:assets.map(({bytes:_bytes,...asset})=>asset)})},
    ...assets.map((asset,index)=>({name:`assets/${index}.bin`,bytes:asset.bytes}))];
  const files=await Promise.all(entries.map(async entry=>({path:entry.name,size:entry.bytes.length,checksum:await sha256Hex(entry.bytes)})));
  entries.unshift({name:'manifest.json',bytes:encodeJson({...manifest,files})});
  const part=await packCloudBackupPart(entries);
  const header=encodeJson({kind:'teyvat-core2-package',formatVersion:1,compression:part.compression,checksum:part.sha256});
  const prefix=new Uint8Array(magic.length+4);prefix.set(magic);new DataView(prefix.buffer).setUint32(magic.length,header.length,true);
  return new Blob([prefix,header,part.bytes],{type:'application/vnd.teyvat.core2-package'});
}
export async function exportCorePackage(repo:CoreRepository,input:CoreScope):Promise<Blob> {
  return encodeCorePackage(prepareExportGraph(await repo.readExportRecords(ownDto('scope',input))));
}

/** Remap only declared identifier fields, never prose/quotes/names/content IDs. */
export function remapCoreImport(input:PreparedImport):PreparedImport {
  const value=ownPreparedImport(input),journeyId=`journey-${crypto.randomUUID()}`;
  const ids=new Map<string,string>();
  const remap=(kind:string,id:string)=>{const key=`${kind}/${id}`;let next=ids.get(key);if(!next){next=`${kind}-${crypto.randomUUID()}`;ids.set(key,next);}return next;};
  const single:Record<string,string>={sourceId:'source',eventId:'event',establishedEventId:'event',correctionOf:'event',replyToEventId:'event',playerEventId:'event',operationId:'operation',playerOperationId:'operation',postOperationId:'operation',replyOperationId:'operation',anchorOperationId:'operation',settlementId:'operation',candidateId:'candidate',jobId:'job',reuseJobId:'job',retryOfJobId:'job',retriedByJobId:'job',leaseId:'lease',sessionId:'session',memoryId:'memory',knowledgeId:'knowledge',commitmentId:'commitment',snapshotId:'snapshot',originSnapshotId:'snapshot',slotId:'slot',assetId:'asset',avatarAssetId:'asset',effectKey:'effect'};
  const lists:Record<string,string>={sourceIds:'source',eventIds:'event',selectedLeafIds:'event',candidateRefs:'candidate',jobIds:'job',memoryIds:'memory',supersededIds:'memory',leaseIds:'lease',imageAssetIds:'asset',assetRefs:'asset',effects:'effect'};
  single.publicationOperationId = 'operation';
  // Only registered, data-only plan envelopes contain executable ID references.
  // Arbitrary strings (including prompts, original source bodies and custom
  // fingerprints) remain byte-for-byte intact. No model/runtime import here.
  const configurations:Record<string,{prefix:string; operationField:string; versioned:boolean}>={
    turn_summary:{prefix:'core2-summary-plan-v1:',operationField:'operationId',versioned:true},
    courier:{prefix:'core2-phone-plan-v1:',operationField:'playerOperationId',versioned:true},
    compression:{prefix:'core2-memory-plan-v1:',operationField:'anchorOperationId',versioned:true},
    rebuild:{prefix:'core2-memory-plan-v1:',operationField:'anchorOperationId',versioned:true},
    manual_memory:{prefix:'core2-manual-memory-v1:',operationField:'operationId',versioned:false},
    news:{prefix:'core2-news-plan-v1:',operationField:'anchorOperationId',versioned:true},
    image:{prefix:'core2-image-plan-v1:',operationField:'anchorOperationId',versioned:true},
    profile:{prefix:'core2-profile-plan-v1:',operationField:'anchorOperationId',versioned:true},
  };
  const configuration=(owner:Record<string,unknown>,entry:string):string=>{
    const registered=owner.kind==='courier' && entry.startsWith('core2-proactive-plan-v1:') ? {prefix:'core2-proactive-plan-v1:',operationField:'anchorOperationId',versioned:true}
      : owner.kind==='courier' && entry.startsWith('core2-moment-plan-v1:') ? {prefix:'core2-moment-plan-v1:',operationField:'postOperationId',versioned:true}
      : typeof owner.kind==='string'?configurations[owner.kind]:undefined;
    if(!registered || !entry.startsWith(registered.prefix)) return entry;
    const plan:unknown=JSON.parse(entry.slice(registered.prefix.length));
    if(!isCoreJsonData(plan) || !plan || typeof plan!=='object' || Array.isArray(plan)) throw Error('CORE2_IMPORT_JOB_CONFIGURATION');
    const data=plan as Record<string,unknown>;
    if(!data.scope || typeof data.scope!=='object' || Array.isArray(data.scope) || !sameScope(data.scope as CoreScope,owner.scope as CoreScope)
      || data[registered.operationField]!==owner.operationId || registered.versioned && data.version!==1) throw Error('CORE2_IMPORT_JOB_CONFIGURATION_BINDING');
    return registered.prefix+stableJson(walk(data));
  };
  const walk=(item:unknown):unknown=>{
    if(Array.isArray(item)) return item.map(walk);
    if(!item || typeof item!=='object' || item instanceof Uint8Array) return item;
    return Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,
      key==='journeyId'?journeyId:key==='configFingerprint' && typeof entry==='string'?configuration(item as Record<string,unknown>,entry):STATE_IMAGE_FIELDS.has(key) && typeof entry==='string' && entry.startsWith('asset:')?`asset:${remap('asset',entry.slice(6))}`:single[key] && typeof entry==='string'?remap(single[key],entry):lists[key] && Array.isArray(entry)?entry.map(id=>remap(lists[key]!,id as string)):walk(entry)]));
  };
  const result=walk(value) as PreparedImport;
  for(const snapshot of result.snapshots) snapshot.checksum=checksumUtf8(stableJson(snapshot.state));
  for(const job of result.jobs) if(job.publication) {
    const pub=job.publication;
    const additions=pub.receipt.memoryIds.map(id=>result.memories.find(row=>row.record.memoryId===id && row.record.scope.branchId===job.record.scope.branchId && row.publishedRevision===pub.receipt.memoryRevision)!.record);
    pub.fingerprint=checksumUtf8(stableJson({...pub.descriptor,additions}));
  }
  validateImportGraph(result);return result;
}

export async function prepareCoreImport(file:Blob,limits=CORE_PACKAGE_LIMITS):Promise<PreparedImport> {
  if(file.size>limits.maxFileBytes || file.size<magic.length+4) throw new Error('CORE2_PACKAGE_SIZE');
  const prefix=new Uint8Array(await file.slice(0,magic.length+4).arrayBuffer());
  if(!magic.every((byte,index)=>prefix[index]===byte)) throw new Error('CORE2_PACKAGE_FORMAT');
  const length=new DataView(prefix.buffer).getUint32(magic.length,true);
  if(length>4096 || length<1 || magic.length+4+length>=file.size) throw new Error('CORE2_PACKAGE_HEADER');
  const header=dataFields(JSON.parse(decoder.decode(await file.slice(prefix.length,prefix.length+length).arrayBuffer())),['kind','formatVersion','compression','checksum'],'CORE2_PACKAGE_HEADER');
  if(header.kind!=='teyvat-core2-package' || header.formatVersion!==1) throw new Error('CORE2_PACKAGE_VERSION');
  if(!['none','gzip'].includes(header.compression as string) || typeof header.checksum!=='string') throw new Error('CORE2_PACKAGE_HEADER');
  const part=new Uint8Array(await file.slice(prefix.length+length).arrayBuffer());
  if(await sha256Hex(part)!==header.checksum) throw new Error('CORE2_PACKAGE_CHECKSUM');
  const entries=await unpackCloudBackupPart(part,header.compression as 'none'|'gzip',limits);
  const parse=(path:string)=>{const bytes=entries.get(path);if(!bytes) throw new Error('CORE2_PACKAGE_MISSING_FILE');return JSON.parse(decoder.decode(bytes));};
  const manifest=ownDto('manifest',parse('manifest.json'));
  const names=new Set(['manifest.json']);
  for(const file of manifest.files) {
    if(names.has(file.path)) throw new Error('CORE2_PACKAGE_DUPLICATE_FILE');names.add(file.path);
    const bytes=entries.get(file.path);
    if(!bytes || bytes.length!==file.size || await sha256Hex(bytes)!==file.checksum) throw new Error('CORE2_PACKAGE_FILE_CHECKSUM');
  }
  if(names.size!==entries.size || !names.has('graph.json')) throw new Error('CORE2_PACKAGE_FILE_SET');
  const graph=parse('graph.json');noCredentials(graph);
  if(!Array.isArray(graph.assets)) throw new Error('CORE2_INVALID_IMPORT');
  const assets=graph.assets.map((asset:Omit<CoreAsset,'bytes'>,index:number)=>{
    const bytes=entries.get(`assets/${index}.bin`);if(!bytes) throw new Error('CORE2_PACKAGE_MISSING_ASSET');return {...asset,bytes};
  });
  if(entries.size!==assets.length+2) throw new Error('CORE2_PACKAGE_FILE_SET');
  const value=ownPreparedImport({...graph,manifest,assets});validateImportGraph(value);
  // Import is staging only. The caller explicitly confirms privacy and publishes
  // once, using repository.importPrepared; no destination is opened here.
  const requiredPrivate=packageContainsPrivateData(value);
  if(requiredPrivate && !value.manifest.containsPrivateData) throw new Error('CORE2_PACKAGE_PRIVACY_FLAG');
  return remapCoreImport(value);
}
