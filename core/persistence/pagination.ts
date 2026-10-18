import type { Page } from '../contracts/storage';
import { stableJson } from './repositoryValidation';
export function paged<T>(items:T[],query:{ cursor?: string; limit?: number },identity:(item:T)=>string):Page<T> {
  const descriptor=Object.fromEntries(Object.entries(query).filter(([key])=>key!=='cursor'));
  const prefix=`core2-page/${stableJson(descriptor)}/`;
  let offset=0;
  if(query.cursor) {
    if(!query.cursor.startsWith(prefix)) throw new Error('CORE2_CURSOR_MISMATCH');
    const index=items.findIndex(item=>identity(item)===query.cursor!.slice(prefix.length));
    if(index<0) throw new Error('CORE2_CURSOR_STALE');offset=index+1;
  }
  const end=offset+(query.limit??50),page=items.slice(offset,end);
  if(end>=items.length) return {items:page};
  const nextCursor=prefix+identity(page.at(-1)!);
  if(nextCursor.length>1000) throw new Error('CORE2_CURSOR_TOO_LARGE');
  return {items:page,nextCursor};
}
