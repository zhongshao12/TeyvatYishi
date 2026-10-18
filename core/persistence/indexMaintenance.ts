import type { CoreRepository,IndexReceipt,IndexPosting,IndexStatus,IndexTarget } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import { assertId,ownDto } from './repositoryValidation';
export interface IndexBuildRequest {scope:CoreScope;sessionId:string;signal?:AbortSignal}
/** Candidate terms, not proof of visibility. Never reads source bodies. */
export function indexTerms(text:string):string[] {
  const terms=new Set<string>();
  for(const word of text.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu)??[]) {
    if(/^[a-z0-9_]+$/.test(word)) terms.add(word);
    else {const chars=Array.from(word);if(chars.length===1) terms.add(word);for(let i=0;i<chars.length-1 && terms.size<100;i++) terms.add(chars.slice(i,i+2).join(''));}
    if(terms.size>=100) break;
  }
  return [...terms].slice(0,100);
}
export async function maintainCoreIndexes(repo:CoreRepository,input:IndexBuildRequest):Promise<IndexReceipt> {
  const scope=ownDto('scope',input.scope),sessionId=input.sessionId,signal=input.signal;assertId(sessionId);
  let indexVersion=0;
  const cancelled=(reason:string):IndexReceipt=>({status:'cancelled',reason,indexVersion});
  if(signal?.aborted) return cancelled('cancelled');
  const head=await repo.readHead(scope),previous=await repo.readIndexStatus(scope);indexVersion=previous.indexVersion;
  const incremental=previous.status!=='missing' && previous.contentVersion==='recall-v2';
  if(head.sessionId!==sessionId || signal?.aborted) return cancelled('session_changed');
  const postings:IndexPosting[]=[],seen=new Set<string>();
  const replacedTargets:IndexTarget[]=[];
  const add=(target:IndexPosting['target'],targetId:string,commitSeq:number,memoryRevision:number,kind:IndexPosting['kind'],values:string[])=>{
    for(const key of values) if(key.trim()) {
      const identity=JSON.stringify([target,targetId,kind,key]);if(seen.has(identity)) continue;seen.add(identity);
      postings.push({scope,target,targetId,commitSeq,memoryRevision,kind,key});
    }
  };
  let cursor:string|undefined;
  do {
    if(signal?.aborted) return cancelled('cancelled');
    const page=await repo.queryEvents({scope,cutoffSeq:head.coreSeq,afterSeq:incremental?previous.coreSeq:0,limit:50,...(cursor?{cursor}:{})});
    for(const event of page.items) {
      replacedTargets.push({target:'event',targetId:event.eventId});
      add('event',event.eventId,event.commitSeq,0,'npc',[...event.actorIds,...event.targetIds]);
      add('event',event.eventId,event.commitSeq,0,'location',event.occurredMoment.location?[event.occurredMoment.location]:[]);
      add('event',event.eventId,event.commitSeq,0,'type',[event.type]);
      add('event',event.eventId,event.commitSeq,0,'keyword',indexTerms(event.evidenceRefs.map(ref=>ref.quote).join(' ')));
    }
    cursor=page.nextCursor;
  } while(cursor);
  do {
    if(signal?.aborted) return cancelled('cancelled');
    const page=await repo.queryMemoryRows({scope,cutoffSeq:head.coreSeq,memoryRevision:head.memoryRevision,afterRevision:incremental?previous.memoryRevision:0,limit:50,...(cursor?{cursor}:{})});
    for(const row of page.items) {
      const memory=row.record;
      replacedTargets.push({target:'memory',targetId:memory.memoryId});
      if(memory.status!=='active') continue;
      add('memory',memory.memoryId,row.commitSeq,row.publishedRevision,'npc',memory.npcIds);
      add('memory',memory.memoryId,row.commitSeq,row.publishedRevision,'location',memory.locations);
      add('memory',memory.memoryId,row.commitSeq,row.publishedRevision,'type',[memory.layer,...(memory.pinned?['protected']:[])]);
      add('memory',memory.memoryId,row.commitSeq,row.publishedRevision,'keyword',indexTerms(memory.text));
    }
    cursor=page.nextCursor;
  } while(cursor);
  if(signal?.aborted) return cancelled('cancelled');
  if((await repo.readHead(scope)).sessionId!==sessionId) return cancelled('session_changed');
  return repo.publishIndex({scope,sessionId,cutoffSeq:head.coreSeq,memoryRevision:head.memoryRevision,expectedIndexVersion:indexVersion,mode:incremental?'merge':'replace',...(incremental?{replacedTargets}:{}),postings,contentVersion:'recall-v2'});
}
/** A lagging cache cannot be reported as a complete recall. Try catch-up once,
 * then provide an explicit failure for UI / caller to surface and retry. */
export async function requireCurrentCoreIndex(repo:CoreRepository,input:IndexBuildRequest):Promise<IndexStatus> {
  const request={scope:ownDto('scope',input.scope),sessionId:input.sessionId,signal:input.signal};
  try {
    const status=await repo.readIndexStatus(request.scope);if(status.status==='ready' && status.contentVersion==='recall-v2') return status;
    const receipt=await maintainCoreIndexes(repo,request),updated=await repo.readIndexStatus(request.scope);
    if(receipt.status!=='published' || updated.status!=='ready' || updated.contentVersion!=='recall-v2') throw new Error(receipt.reason??'head_advanced_during_catchup');
    return updated;
  } catch(error) {throw new Error(`CORE2_INDEX_UNAVAILABLE: ${error instanceof Error?error.message:String(error)}`);}
}
