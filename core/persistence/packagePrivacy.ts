import type { PreparedImport } from '../contracts/storage';
export function packageContainsPrivateData(value:Pick<PreparedImport,'events'|'sources'|'memories'|'branches'|'snapshots'>):boolean {
  return value.events.some(event=>event.visibility.kind!=='public') || value.memories.some(row=>row.record.visibility.kind!=='public') ||
    value.sources.some(row=>['courier','moment','player_input','manual'].includes(row.record.kind)) ||
    [...value.branches.map(row=>row.state),...value.snapshots.map(row=>row.state)].some(state=>state.records.some(record=>record.domain==='npc' && !!record.value.matureArchive));
}
