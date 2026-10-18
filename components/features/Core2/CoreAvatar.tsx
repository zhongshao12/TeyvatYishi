import { useEffect, useState } from 'react';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreRepository } from '@/core/contracts/storage';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { CourierAvatar } from '@/components/features/Courier/CourierAvatar';

export function coreCourierName(snapshot: CoreSnapshot, id: string, preferRemark = true): string {
  const person = snapshot.records.find(row => (row.domain === 'traveler' || row.domain === 'npc') && row.entityId === id);
  const contact = snapshot.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === id);
  return preferRemark && contact?.domain === 'courier' && contact.value.kind === 'contact' && contact.value.remark ? contact.value.remark : person?.domain === 'traveler' || person?.domain === 'npc' ? person.value.姓名 : '角色';
}
export function CoreAvatar({ repo, snapshot, entityId, small = false }: { repo: CoreRepository; snapshot: CoreSnapshot; entityId: string; small?: boolean }) {
  const person = snapshot.records.find(row => (row.domain === 'traveler' || row.domain === 'npc') && row.entityId === entityId);
  const contact = snapshot.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === entityId);
  const profile = person?.domain === 'traveler' || person?.domain === 'npc' ? person.value : null;
  const name = coreCourierName(snapshot, entityId), fallback = getDefaultBuiltinAvatar(profile?.姓名 ?? name);
  const raw = contact?.domain === 'courier' && contact.value.kind === 'contact' && contact.value.avatarAssetId ? `asset:${contact.value.avatarAssetId}`
    : profile?.visualArchive.slotImages.courier || (person?.domain === 'npc' ? person.value.avatar : person?.domain === 'traveler' ? person.value.头像 : '') || fallback;
  const assetId = raw?.startsWith('asset:') ? raw.slice(6) : null, journeyId = snapshot.head.scope.journeyId;
  const key = JSON.stringify([journeyId, assetId]), [loaded, setLoaded] = useState<{ key: string; src: string } | null>(null);
  useEffect(() => {
    if (!assetId) return; let live = true, objectUrl: string | null = null;
    void repo.readAsset(assetId).then(asset => {
      if (!live || !asset || asset.scope.journeyId !== journeyId || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) return;
      objectUrl = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mimeType })); setLoaded({ key, src: objectUrl });
    }).catch(() => { /* Missing images use the stable built-in/initial fallback. */ });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId, journeyId, key, repo]);
  return <CourierAvatar name={name} src={assetId ? loaded?.key === key ? loaded.src : fallback : raw} small={small} />;
}
