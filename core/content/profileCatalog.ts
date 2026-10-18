import type { NpcState } from '../contracts/state';
import { matchCanonical } from '@/data/canonicalCharacters';
import { CANONICAL_ARCHIVE_BASELINES } from '@/utils/npcArchiveBaseline';
import { getAvatarCharacterProfile } from '@/data/avatarCharacterProfiles';

export const PUBLIC_PROFILE_FIELDS = ['appearance', 'clothing', 'personality', 'speechStyle', '说明', 'gender'] as const;
export type PublicProfileField = typeof PUBLIC_PROFILE_FIELDS[number];
export interface CoreProfileData { version: string; fields: Partial<Record<PublicProfileField, string>>; appearanceFacts: NonNullable<NpcState['appearanceFacts']> }
export interface CoreProfileCatalog { read(identity: Pick<NpcState, '姓名' | 'aliases' | 'canonical'>, signal?: AbortSignal): Promise<CoreProfileData> }
export function createCoreProfileCatalog(): CoreProfileCatalog {
  return { async read(identity, signal) {
    if (signal?.aborted) throw Error('CORE2_PROFILE_CANCELLED');
    const name = identity.canonical && matchCanonical(identity.姓名)?.name, base = name ? CANONICAL_ARCHIVE_BASELINES[name] : undefined;
    const avatar = name ? getAvatarCharacterProfile(name, identity.aliases) : undefined;
    const fields: CoreProfileData['fields'] = {};
    for (const [key, value] of [['appearance', base?.外貌], ['clothing', base?.穿着 ?? avatar?.常用穿着], ['personality', base?.性格], ['speechStyle', base?.说话方式], ['说明', base?.介绍], ['gender', base?.性别]] as const) if (value?.trim()) fields[key] = value;
    const appearanceFacts: CoreProfileData['appearanceFacts'] = {};
    for (const key of ['发色', '瞳色', '身高', '体重'] as const) if (avatar?.[key]?.trim()) appearanceFacts[key] = { value: avatar[key], source: 'canon' };
    // No adulthood decisions, private archive, inferred measurements or history.
    return { version: 'bundled-public-profile-v1', fields, appearanceFacts };
  } };
}
