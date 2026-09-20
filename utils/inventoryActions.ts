import {
  normalizeTeyvatItem,
  type TeyvatInventory,
} from '@/models/teyvat/items';

function requirePositiveInteger(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_ITEM_QUANTITY');
}

export function addInventoryItem(inventory: TeyvatInventory, input: unknown): TeyvatInventory {
  const item = normalizeTeyvatItem(input);
  const existingIndex = inventory.items.findIndex((candidate) => candidate.id === item.id);

  if (existingIndex < 0) {
    return { ...inventory, items: [...inventory.items, item] };
  }

  const existing = inventory.items[existingIndex];
  if (!existing) throw new Error('UNKNOWN_INVENTORY_ITEM');
  if (existing.stackable === false || item.stackable === false) throw new Error('DUPLICATE_INVENTORY_ITEM');

  return {
    ...inventory,
    items: inventory.items.map((candidate, index) => (
      index === existingIndex
        ? { ...candidate, quantity: candidate.quantity + item.quantity }
        : candidate
    )),
  };
}

export function consumeInventoryItem(
  inventory: TeyvatInventory,
  itemId: string,
  quantity: number,
): TeyvatInventory {
  requirePositiveInteger(quantity);
  const existingIndex = inventory.items.findIndex((candidate) => candidate.id === itemId);
  if (existingIndex < 0) throw new Error('UNKNOWN_INVENTORY_ITEM');

  const existing = inventory.items[existingIndex];
  if (!existing) throw new Error('UNKNOWN_INVENTORY_ITEM');
  if (quantity > existing.quantity) throw new Error('INSUFFICIENT_ITEM_QUANTITY');

  if (quantity === existing.quantity) {
    return {
      ...inventory,
      items: inventory.items.filter((_, index) => index !== existingIndex),
    };
  }

  return {
    ...inventory,
    items: inventory.items.map((candidate, index) => (
      index === existingIndex
        ? { ...candidate, quantity: candidate.quantity - quantity }
        : candidate
    )),
  };
}

/** 丢弃与使用是不同语义：丢弃会留下墓碑，阻止旧叙事事实把物品重新塞回背包。 */
export function discardInventoryItem(
  inventory: TeyvatInventory,
  itemId: string,
  quantity: number,
): TeyvatInventory {
  const item = inventory.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('UNKNOWN_INVENTORY_ITEM');
  const next = consumeInventoryItem(inventory, itemId, quantity);
  if (quantity < item.quantity) return next;
  return {
    ...next,
    discardedItemIds: Array.from(new Set([...(inventory.discardedItemIds ?? []), item.id, `name:${item.name.trim()}`])),
  };
}
