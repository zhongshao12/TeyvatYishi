export const ITEM_CATEGORIES = ['weapon', 'artifact', 'food', 'material', 'gadget', 'quest', 'furnishing'] as const;

export type ItemCategory = typeof ITEM_CATEGORIES[number];

export const ITEM_RARITIES = [1, 2, 3, 4, 5] as const;

export type ItemRarity = typeof ITEM_RARITIES[number];

export const ARTIFACT_SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const;

export type ArtifactSlot = typeof ARTIFACT_SLOTS[number];

export interface TeyvatItem {
  id: string;
  category: ItemCategory;
  name: string;
  description: string;
  quantity: number;
  rarity: ItemRarity;
  obtainedAtTurn: number;
  artifactSlot?: ArtifactSlot;
  stackable?: boolean;
  source?: string;
  effects?: string[];
  narrativeEffects?: string[];
  useEffects?: Array<{ target: string; value: number; basis?: string }>;
  value?: number;
  sourceDetail?: string;
  obtainedAt?: string;
}

export interface TeyvatInventory {
  items: TeyvatItem[];
  mora: number;
  /** 玩家主动丢弃的物品墓碑；同时记录 id 与 name:名称，防止模型凭旧上下文复活。 */
  discardedItemIds?: string[];
}

export function createEmptyTeyvatInventory(): TeyvatInventory {
  return { items: [], mora: 0 };
}

function requireNonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(String);
}

function normalizeUseEffects(value: unknown): TeyvatItem['useEffects'] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.target !== 'string' || !candidate.target.trim()) return [];
    if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) return [];
    return [{
      target: candidate.target,
      value: candidate.value,
      ...(typeof candidate.basis === 'string' && candidate.basis ? { basis: candidate.basis } : {}),
    }];
  });
}

export function normalizeTeyvatItem(input: unknown): TeyvatItem {
  if (!isRecord(input)) throw new Error('INVALID_TEYVAT_ITEM');
  if (
    Object.prototype.hasOwnProperty.call(input, 'lightcone') ||
    Object.prototype.hasOwnProperty.call(input, 'quality') ||
    Object.prototype.hasOwnProperty.call(input, '品质') ||
    input.category === 'lightcone'
  ) {
    throw new Error('LEGACY_ITEM_FIELD_NOT_ALLOWED');
  }

  if (!ITEM_CATEGORIES.includes(input.category as ItemCategory)) throw new Error('INVALID_ITEM_CATEGORY');
  const category = input.category as ItemCategory;

  if (typeof input.rarity !== 'number' || !Number.isInteger(input.rarity) || !ITEM_RARITIES.includes(input.rarity as ItemRarity)) {
    throw new Error('INVALID_ITEM_RARITY');
  }
  const rarity = input.rarity as ItemRarity;

  const quantity = input.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('INVALID_ITEM_QUANTITY');
  }

  const obtainedAtTurn = input.obtainedAtTurn;
  if (typeof obtainedAtTurn !== 'number' || !Number.isInteger(obtainedAtTurn) || obtainedAtTurn < 0) {
    throw new Error('INVALID_ITEM_OBTAINED_TURN');
  }

  let artifactSlot: ArtifactSlot | undefined;
  if (category === 'artifact') {
    if (!ARTIFACT_SLOTS.includes(input.artifactSlot as ArtifactSlot)) throw new Error('INVALID_ARTIFACT_SLOT');
    artifactSlot = input.artifactSlot as ArtifactSlot;
  } else if (input.artifactSlot !== undefined) {
    throw new Error('UNEXPECTED_ARTIFACT_SLOT');
  }

  const effects = normalizeStringList(input.effects);
  const narrativeEffects = normalizeStringList(input.narrativeEffects);
  const useEffects = normalizeUseEffects(input.useEffects);

  return {
    id: requireNonEmptyString(input.id, 'INVALID_ITEM_ID'),
    category,
    name: requireNonEmptyString(input.name, 'INVALID_ITEM_NAME'),
    description: typeof input.description === 'string' ? input.description : '',
    quantity,
    rarity,
    obtainedAtTurn,
    ...(artifactSlot ? { artifactSlot } : {}),
    ...(typeof input.stackable === 'boolean' ? { stackable: input.stackable } : {}),
    ...(typeof input.source === 'string' && input.source ? { source: input.source } : {}),
    ...(effects ? { effects } : {}),
    ...(narrativeEffects ? { narrativeEffects } : {}),
    ...(useEffects ? { useEffects } : {}),
    ...(typeof input.value === 'number' && Number.isFinite(input.value) ? { value: input.value } : {}),
    ...(typeof input.sourceDetail === 'string' && input.sourceDetail ? { sourceDetail: input.sourceDetail } : {}),
    ...(typeof input.obtainedAt === 'string' && input.obtainedAt ? { obtainedAt: input.obtainedAt } : {}),
  };
}

export function normalizeTeyvatInventory(input: unknown): TeyvatInventory {
  const raw = isRecord(input) ? input : {};
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeTeyvatItem) : [];
  const mora = typeof raw.mora === 'number' && Number.isFinite(raw.mora)
    ? Math.max(0, Math.trunc(raw.mora))
    : 0;
  const discardedItemIds = Array.isArray(raw.discardedItemIds)
    ? Array.from(new Set(raw.discardedItemIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())))
    : [];
  return { items, mora, ...(discardedItemIds.length ? { discardedItemIds } : {}) };
}
import { isRecord } from '@/utils/valueGuards';
