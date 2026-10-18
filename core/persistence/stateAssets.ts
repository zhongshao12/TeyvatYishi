import type { StateRecord } from '../contracts/state';

export const STATE_IMAGE_FIELDS=new Set(['头像','avatar','profileImage','fullPortrait','profile','narrative','courier','femaleChest','femaleGenital','maleGenital','rear','bodyReference']);
/** Only typed image-link fields. A prose occurrence of asset: is not a reference. */
export function stateAssetIds(record:StateRecord):string[] {
  const ids:string[]=[];
  const link=(value:unknown)=>{if(typeof value==='string' && value.startsWith('asset:')) ids.push(value.slice(6));};
  if(record.domain==='album') ids.push(record.value.assetId);
  if(record.domain==='courier' && record.value.kind==='contact' && record.value.avatarAssetId) ids.push(record.value.avatarAssetId);
  if(record.domain==='courier' && record.value.kind==='moment') ids.push(...record.value.imageAssetIds);
  if(record.domain==='traveler' || record.domain==='npc') {
    link(record.domain==='traveler'?record.value.头像:record.value.avatar);
    const visual=record.value.visualArchive;link(visual.profileImage);link(visual.fullPortrait);
    Object.values(visual.slotImages).forEach(link);
    if(record.domain==='npc' && record.value.matureArchive) Object.values(record.value.matureArchive.partImages).forEach(link);
  }
  return ids;
}
