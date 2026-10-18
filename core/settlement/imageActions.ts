import type { BasicPlayerCommand } from './actions';
import type { RuleContext } from './ruleContext';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { normalizeImageCharacterEnglishCache } from '@/models/imageCharacterEnglish';
import { readCoreNpcImageFacts } from '../retrieval/imageContext';
import { sameData } from '../persistence/repositoryValidation';

export function applyCoreImageAction(ctx: RuleContext, command: Extract<BasicPlayerCommand, { type: 'image_bind' | 'image_delete' | 'image_profile_cache' }>): void {
  if (command.type === 'image_profile_cache') {
    const npc = ctx.get('npc', command.npcId), cache = normalizeImageCharacterEnglishCache(command.cache);
    if (npc.version !== command.expectedVersion || npc.value.archived || !cache || cache.sourceKey !== JSON.stringify(readCoreNpcImageFacts(npc.value))) throw Error('人物外貌已经改变，未保存过期的英文资料，请重新准备。');
    const saved = normalizeImageCharacterEnglishCache(npc.value.visualArchive.englishFacts);
    if (saved && (!sameData(saved.facts, cache.facts) || saved.sourceKey !== cache.sourceKey)) throw Error('英文基础资料已固定；只有明确手动修改基础资料后才能更新。');
    npc.value.visualArchive.englishFacts = JSON.parse(JSON.stringify(cache)); ctx.put(npc); return;
  }
  const album = ctx.get('album', command.entryId);
  if (command.type === 'image_delete') {
    if (album.version !== command.expectedVersion) throw Error('相册条目已经变动，请重新选择。');
    // Remove this view entry only. Saved history and avatar references still own the bytes.
    ctx.changes.push({ ref: { domain: 'album', entityId: album.entityId, version: album.version }, before: album, after: null,
      effectKey: 'effect-' + checksumUtf8(JSON.stringify([ctx.effectKey, 'album', album.entityId])) }); return;
  }
  if (!['npc', 'traveler'].includes(command.target) || !['profile', 'courier', 'narrative'].includes(command.slot)) throw Error('未注册的图片目标或槽位。');
  const person = command.target === 'npc' ? ctx.get('npc', command.targetId) : ctx.get('traveler', command.targetId);
  if (person.version !== command.expectedVersion || person.domain === 'npc' && person.value.archived) throw Error('人物资料已经变动或角色已归档，请重新选择。');
  const link = 'asset:' + album.value.assetId;
  person.value.visualArchive.slotImages[command.slot] = link;
  person.value.visualArchive.source = 'manual'; person.value.visualArchive.status = 'done';
  if (command.slot === 'profile') {
    person.value.visualArchive.profileImage = link;
    if (person.domain === 'npc') person.value.avatar = link; else person.value.头像 = link;
  } else if (command.slot === 'narrative') person.value.visualArchive.fullPortrait = link;
  ctx.put(person);
  if (command.slot === 'courier' && person.domain === 'npc') for (const item of ctx.state.records) {
    if (item.domain !== 'courier' || item.value.kind !== 'contact' || item.value.npcId !== person.entityId) continue;
    const contact = ctx.get('courier', item.entityId);
    if (contact.value.kind === 'contact') { contact.value.avatarAssetId = album.value.assetId; ctx.put(contact); }
  }
}
