import type { IntegrityReport } from '../contracts/storage';
import { isCoreJsonData } from '../contracts/validation';
import { assertId, sameData } from './repositoryValidation';

export interface FormatEnvelope {formatVersion:number;revision:string;payload:unknown}
/** Future host adapter must implement immutable backup and atomic revision CAS.
 * The current repositories support format 1 only; no production 1→2 is registered. */
export interface FormatUpgradeRepository {
  readFormat():Promise<FormatEnvelope>;
  saveFormatBackup(backupId:string,expectedRevision:string):Promise<void>;
  readFormatBackup(backupId:string):Promise<FormatEnvelope|null>;
  publishUpgradedFormat(value:FormatEnvelope,expectedRevision:string,backupId:string):Promise<void>;
}
export interface FormatConversion {from:number;to:number;convert(value:unknown):unknown|Promise<unknown>;validate(value:unknown):IntegrityReport}
export interface FormatRegistry {chain(from:number,to:number):readonly FormatConversion[]|undefined}
export interface FormatUpgradeRequest {from:number;to:number;backupId:string;registry:FormatRegistry}
/** Code-owned registrations only, not a model response or package-supplied script. */
export function createFormatRegistry(conversions:readonly FormatConversion[]):FormatRegistry {
  const registered=new Map<string,FormatConversion>();
  for(const entry of conversions) {
    if(!Number.isSafeInteger(entry.from) || entry.from<1 || !Number.isSafeInteger(entry.to) || entry.to<=entry.from || typeof entry.convert!=='function' || typeof entry.validate!=='function') throw new Error('CORE2_INVALID_FORMAT_REGISTRATION');
    const key=`${entry.from}/${entry.to}`;if(registered.has(key)) throw new Error('CORE2_DUPLICATE_FORMAT_REGISTRATION');
    registered.set(key,Object.freeze({...entry}));
  }
  return Object.freeze({chain:(from:number,to:number)=>{
    const queue:{version:number;steps:FormatConversion[]}[]=[{version:from,steps:[]}],seen=new Set<number>();
    while(queue.length) {
      const next=queue.shift()!;if(seen.has(next.version)) continue;seen.add(next.version);
      if(next.version===to && next.steps.length) return Object.freeze(next.steps);
      for(const entry of [...registered.values()].sort((a,b)=>a.to-b.to)) if(entry.from===next.version && entry.to<=to) queue.push({version:entry.to,steps:[...next.steps,entry]});
    }
    return undefined;
  }});
}
export const productionFormatRegistry=createFormatRegistry([]);

export async function upgradeCoreFormat(repo:FormatUpgradeRepository,request:FormatUpgradeRequest):Promise<IntegrityReport> {
  let checkedRecords=0;
  try {
    const {from,to,backupId,registry}=request;assertId(backupId);
    const chain=registry.chain(from,to);
    if(!chain?.length || chain[0]!.from!==from || chain.at(-1)!.to!==to || chain.some((step,index)=>index>0 && step.from!==chain[index-1]!.to)) throw new Error('CORE2_UNREGISTERED_FORMAT_UPGRADE');
    const current=await repo.readFormat();
    if(!isCoreJsonData(current) || current.formatVersion!==from) throw new Error('CORE2_FORMAT_VERSION_MISMATCH');
    const captured=structuredClone(current);assertId(captured.revision);
    if(await repo.readFormatBackup(backupId)) throw new Error('CORE2_BACKUP_ALREADY_EXISTS');
    await repo.saveFormatBackup(backupId,captured.revision);
    if(!sameData(await repo.readFormatBackup(backupId),captured)) throw new Error('CORE2_BACKUP_VERIFICATION_FAILED');
    let payload=structuredClone(captured.payload);
    for(const conversion of chain) {
      payload=await conversion.convert(payload);
      if(!isCoreJsonData(payload)) throw new Error('CORE2_INVALID_UPGRADED_DATA');
      const report=conversion.validate(payload);
      if(!report.ok || report.errors.length || !Number.isSafeInteger(report.checkedRecords) || report.checkedRecords<0) throw new Error(`CORE2_UPGRADE_VALIDATION_FAILED: ${report.errors.join('; ')}`);
      checkedRecords+=report.checkedRecords;payload=structuredClone(payload);
    }
    // No piecemeal writes or in-place conversion. The host must CAS the complete
    // version pointer against captured.revision, retaining the verified backup.
    await repo.publishUpgradedFormat({formatVersion:to,revision:`revision-${crypto.randomUUID()}`,payload},captured.revision,backupId);
    return {ok:true,errors:[],checkedRecords};
  } catch(error) {return {ok:false,errors:[error instanceof Error?error.message:String(error)],checkedRecords};}
}
