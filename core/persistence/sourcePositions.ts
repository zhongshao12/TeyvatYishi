import type { SourceRecord } from '../contracts/event';
import type { SourcePosition } from '../contracts/storage';
export function sourcePosition(record:SourceRecord,commitSeq:number|null):SourcePosition {
  return {ref:record.ref,scope:record.scope,operationId:record.operationId,kind:record.kind,commitSeq};
}
