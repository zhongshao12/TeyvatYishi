import type { CoreDesktopAction, CoreDesktopTransport, CoreStoreRequest } from './desktopProtocol';
import { decodeAsset, encodeAssetPublication, encodePreparedImport } from './desktopProtocol';
import { assertId, ownDto, ownMemoryQuery, ownQuery } from './repositoryValidation';
import { ownCommitmentQuery } from './commitmentDates';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import type { CoreDtoKind, CoreDtoTypes } from '../contracts/validation';
import type { CoreRepository, Page, ImportedMemory } from '../contracts/storage';
import { dataFields } from './binaryAssets';
import type { WireExportRecords } from './desktopProtocol';
import { ownExportRecords } from './exportGraph';

/** Native errors propagate. There is deliberately no IndexedDB fallback. */
export function createDesktopRepository(transport: CoreDesktopTransport): CoreRepository {
  async function call<T>(action: CoreDesktopAction, args: unknown[]): Promise<T> {
    const request = { action, args };
    if (!isCoreJsonData(request)) throw new Error('CORE2_INVALID_NATIVE_REQUEST');
    const result = await transport.send(structuredClone(request) as CoreStoreRequest);
    if (!isCoreJsonData(result)) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
    return structuredClone(result) as T;
  }
  function dto<K extends CoreDtoKind>(kind: K, value: unknown): CoreDtoTypes[K] {
    if (!validateCoreDto(kind, value).ok) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
    return value as CoreDtoTypes[K];
  }
  async function dtoCall<K extends CoreDtoKind>(kind: K, action: CoreDesktopAction, args: unknown[]): Promise<CoreDtoTypes[K]> { return dto(kind, await call(action, args)); }
  async function nullable<K extends CoreDtoKind>(kind: K, action: CoreDesktopAction, args: unknown[]): Promise<CoreDtoTypes[K] | null> { const result = await call(action, args); return result === null ? null : dto(kind, result); }
  async function page<K extends CoreDtoKind>(kind: K, action: CoreDesktopAction, query: unknown): Promise<Page<CoreDtoTypes[K]>> {
    const result = await call<Record<string, unknown>>(action, [query]);
    if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.items) || !Object.keys(result).every(key => ['items', 'nextCursor'].includes(key)) || (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
    return { items: result.items.map(value => dto(kind, value)), ...(result.nextCursor ? { nextCursor: result.nextCursor as string } : {}) };
  }
  async function write(action: CoreDesktopAction, args: unknown[]): Promise<void> { if (await call(action, args) !== null) throw new Error('CORE2_INVALID_NATIVE_RESPONSE'); }
  return {
    async queryJourneys(query) { return page('journeyEntry', 'queryJourneys', ownDto('journeyQuery', query)); },
    async initialize(input) { return dtoCall('head', 'initialize', [ownDto('seed', input)]); },
    async readHead(scope) { return dtoCall('head', 'readHead', [ownDto('scope', scope)]); },
    async readState(scope) { return dtoCall('snapshot', 'readState', [ownDto('scope', scope)]); },
    async readRecoveryCheckpoint(scope) { return dtoCall('snapshotRecord','readRecoveryCheckpoint',[ownDto('scope',scope)]); },
    async readExportRecords(scope) {
      const result=await call<WireExportRecords>('readExportRecords',[ownDto('scope',scope)]);
      if(!result || !Array.isArray(result.assets)) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
      try { return ownExportRecords({...result,assets:result.assets.map(asset=>{const decoded=decodeAsset(asset);if(!decoded) throw new Error();return decoded;})}); }
      catch { throw new Error('CORE2_INVALID_NATIVE_RESPONSE'); }
    },
    async activateSession(scope, sessionId) { assertId(sessionId); return dtoCall('head', 'activateSession', [ownDto('scope', scope), sessionId]); },
    async putSource(input) { return dtoCall('sourceRef', 'putSource', [ownDto('source', input)]); },
    async appendOperationSource(input) { return dtoCall('operation', 'appendOperationSource', [ownDto('operationSourceAppend', input)]); },
    async readSource(reference) { return nullable('source', 'readSource', [ownDto('sourceRef', reference)]); },
    async prepareOperation(input) { return write('prepareOperation', [ownDto('operation', input)]); },
    async stageOperation(input) { return write('stageOperation', [ownDto('stage', input)]); },
    async cancelOperation(scope, operationId) { assertId(operationId); return write('cancelOperation', [ownDto('scope', scope), operationId]); },
    async readOperation(scope, operationId) { assertId(operationId); return nullable('operation', 'readOperation', [ownDto('scope', scope), operationId]); },
    async commit(input) { return dtoCall('commitReceipt', 'commit', [ownDto('commit', input)]); },
    async publishDerived(input) { return dtoCall('derivedReceipt', 'publishDerived', [ownDto('derived', input)]); },
    async queryEvents(query) { return page('event', 'queryEvents', ownQuery(query, ['eventIds', 'npcIds', 'types', 'turns', 'locations','afterSeq', 'channelIds', 'direction'])); },
    async queryOperations(query) { return page('operation', 'queryOperations', ownDto('operationQuery', query)); },
    async queryCommittedOperations(query) { return page('operation','queryCommittedOperations',ownDto('committedOperationQuery',query)); },
    async queryKnowledge(query) { return page('knowledge', 'queryKnowledge', ownQuery(query, ['npcIds', 'eventIds'])); },
    async queryCommitments(query) { return page('commitment', 'queryCommitments', ownCommitmentQuery(query)); },
    async queryJobs(query) { return page('job', 'queryJobs', ownQuery(query, ['statuses', 'kinds', 'jobIds', 'activeAttemptsOnly'])); },
    async queryMemories(query) { return page('memory', 'queryMemories', ownMemoryQuery(query)); },
    async readMemoryVersions(query) {
      const result = await call<unknown[]>('readMemoryVersions', [ownDto('memoryVersionQuery', query)]);
      if (!Array.isArray(result)) throw Error('CORE2_INVALID_NATIVE_RESPONSE');
      return result.map(record => dto('memory', record));
    },
    async queryMemoryRows(query) {
      const result=await call<{items:ImportedMemory[];nextCursor?:string}>('queryMemoryRows',[ownMemoryQuery(query)]);
      dataFields(result,result.nextCursor===undefined?['items']:['items','nextCursor'],'CORE2_INVALID_NATIVE_RESPONSE');
      if(!Array.isArray(result.items) || result.nextCursor!==undefined && typeof result.nextCursor!=='string') throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
      return {items:result.items.map(row=>{
        dataFields(row,['record','commitSeq','publishedRevision'],'CORE2_INVALID_NATIVE_RESPONSE');
        if(!Number.isSafeInteger(row.commitSeq) || row.commitSeq<0 || !Number.isSafeInteger(row.publishedRevision) || row.publishedRevision<1) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
        return {...row,record:dto('memory',row.record)};
      }),...(result.nextCursor?{nextCursor:result.nextCursor}:{})};
    },
    async querySources(query) {
      let owned: typeof query;
      try { owned = ownDto('sourceQuery', query); } catch { throw new Error('CORE2_INVALID_QUERY'); }
      return page('source', 'querySources', owned);
    },
    async enqueueJob(input) { return write('enqueueJob', [ownDto('job', input)]); },
    async cancelJob(scope, jobId) { assertId(jobId); return write('cancelJob', [ownDto('scope', scope), jobId]); },
    async claimJob(input) { return nullable('job', 'claimJob', [ownDto('jobClaim', input)]); },
    async finishJob(input) { return write('finishJob', [ownDto('jobFinish', input)]); },
    async saveJobStep(input) { return write('saveJobStep', [ownDto('jobStep', input)]); },
    async publishSnapshot(snapshot, slot) { return write('publishSnapshot', [ownDto('snapshotRecord', snapshot), ownDto('saveSlot', slot)]); },
    async readSnapshot(id) { assertId(id); return nullable('snapshotRecord', 'readSnapshot', [id]); },
    async listSaveSlots(journeyId) { assertId(journeyId); const result = await call<unknown>('listSaveSlots', [journeyId]); if (!Array.isArray(result)) throw new Error('CORE2_INVALID_NATIVE_RESPONSE'); return result.map(row => dto('saveSlot', row)); },
    async fork(input) { return dtoCall('head', 'fork', [ownDto('fork', input)]); },
    async readAsset(id) { assertId(id); return decodeAsset(await call('readAsset', [id])); },
    async publishAsset(input) { return write('publishAsset', [encodeAssetPublication(input)]); },
    async readIndexStatus(scope) { return dtoCall('indexStatus', 'readIndexStatus', [ownDto('scope', scope)]); },
    async queryPostings(query) {return page('indexPosting','queryPostings',ownDto('postingQuery',query));},
    async publishIndex(input) { return dtoCall('indexReceipt', 'publishIndex', [ownDto('indexPatch', input)]); },
    async importPrepared(input) { return dtoCall('head', 'importPrepared', [encodePreparedImport(input)]); },
  };
}
