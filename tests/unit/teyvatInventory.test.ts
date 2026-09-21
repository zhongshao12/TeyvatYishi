import { describe, expect, it } from 'vitest';
import * as itemModel from '../../models/teyvat/items';
import * as inventoryActions from '../../utils/inventoryActions';
import * as gameStateMappers from '../../hooks/useGameState';
import { restorePreTurnSnapshot } from '../../hooks/useGame/turnSnapshot';
import { reduceVariableCommands } from '../../utils/variableExecutor';
import { validateCommand } from '../../utils/variableRegistry';

type NormalizeTeyvatItem = (input: unknown) => itemModel.TeyvatItem;
type AddInventoryItem = (
  inventory: itemModel.TeyvatInventory,
  item: unknown,
) => itemModel.TeyvatInventory;
type ConsumeInventoryItem = (
  inventory: itemModel.TeyvatInventory,
  itemId: string,
  quantity: number,
) => itemModel.TeyvatInventory;
type TurnCheckpoint = {
  turnCount: number;
  pendingOpeningTrigger: string | null;
  inventory?: itemModel.TeyvatInventory;
};
type ToLegacyTurnCheckpoint = (checkpoint: TurnCheckpoint) => Record<string, unknown>;
type FromLegacyTurnCheckpoint = (snapshot: Record<string, unknown>) => TurnCheckpoint;

function normalizer(): NormalizeTeyvatItem {
  const candidate = (itemModel as typeof itemModel & { normalizeTeyvatItem?: NormalizeTeyvatItem }).normalizeTeyvatItem;
  expect(candidate, 'models/teyvat/items.ts must export normalizeTeyvatItem').toBeTypeOf('function');
  return candidate as NormalizeTeyvatItem;
}

function addItem(): AddInventoryItem {
  const candidate = (inventoryActions as typeof inventoryActions & { addInventoryItem?: AddInventoryItem }).addInventoryItem;
  expect(candidate, 'utils/inventoryActions.ts must export addInventoryItem').toBeTypeOf('function');
  return candidate as AddInventoryItem;
}

function consumeItem(): ConsumeInventoryItem {
  const candidate = (inventoryActions as typeof inventoryActions & { consumeInventoryItem?: ConsumeInventoryItem }).consumeInventoryItem;
  expect(candidate, 'utils/inventoryActions.ts must export consumeInventoryItem').toBeTypeOf('function');
  return candidate as ConsumeInventoryItem;
}

function checkpointMappers(): [ToLegacyTurnCheckpoint, FromLegacyTurnCheckpoint] {
  const candidates = gameStateMappers as typeof gameStateMappers & {
    toLegacyTurnCheckpoint?: ToLegacyTurnCheckpoint;
    fromLegacyTurnCheckpoint?: FromLegacyTurnCheckpoint;
  };
  expect(candidates.toLegacyTurnCheckpoint, 'useGameState must export the checkpoint serializer').toBeTypeOf('function');
  expect(candidates.fromLegacyTurnCheckpoint, 'useGameState must export the checkpoint deserializer').toBeTypeOf('function');
  return [candidates.toLegacyTurnCheckpoint as ToLegacyTurnCheckpoint, candidates.fromLegacyTurnCheckpoint as FromLegacyTurnCheckpoint];
}

function flowerArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'artifact-flower-1',
    category: 'artifact',
    name: '旅途之花',
    description: '记录远行时光的花饰。',
    quantity: 1,
    rarity: 5,
    obtainedAtTurn: 8,
    artifactSlot: 'flower',
    ...overrides,
  };
}

function foodItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'food-egg-1',
    category: 'food',
    name: '提瓦特煎蛋',
    description: '简单可靠的恢复料理。',
    quantity: 2,
    rarity: 1,
    obtainedAtTurn: 3,
    stackable: true,
    source: '猎鹿人餐馆',
    narrativeEffects: ['热气腾腾'],
    useEffects: [{ target: '恢复体力', value: 20, basis: '热食' }],
    sourceDetail: '莎拉亲手装袋',
    obtainedAt: '新历 3 日',
    value: 200,
    ...overrides,
  };
}

describe('normalizeTeyvatItem', () => {
  it('normalizes a five-star flower artifact and reconstructs only formal fields', () => {
    const input = flowerArtifact({
      hiddenAlias: true,
      effects: ['花饰微光'],
      useEffects: [{ target: '恢复体力', value: 2, basis: '测试', hiddenNestedAlias: true }],
    });

    const normalized = normalizer()(input);

    expect(normalized).toEqual({
      id: 'artifact-flower-1',
      category: 'artifact',
      name: '旅途之花',
      description: '记录远行时光的花饰。',
      quantity: 1,
      rarity: 5,
      obtainedAtTurn: 8,
      artifactSlot: 'flower',
      effects: ['花饰微光'],
      useEffects: [{ target: '恢复体力', value: 2, basis: '测试' }],
    });
    expect(normalized).not.toBe(input);
    expect(normalized.effects).not.toBe((input as unknown as { effects: string[] }).effects);
    expect(normalized.useEffects).not.toBe((input as unknown as { useEffects: unknown[] }).useEffects);
  });

  it.each([0, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid rarity %s with INVALID_ITEM_RARITY',
    (rarity) => {
      expect(() => normalizer()(flowerArtifact({ rarity }))).toThrow('INVALID_ITEM_RARITY');
    },
  );

  it('rejects legacy color rarity and light-cone category instead of translating active writes', () => {
    expect(() => normalizer()(foodItem({ rarity: '金' }))).toThrow('INVALID_ITEM_RARITY');
  });

  it.each([
    { lightcone: '旧光锥字段' },
    { quality: '金' },
    { 品质: '金' },
    { category: 'lightcone' },
  ])('explicitly rejects active writes containing legacy item keys: %j', (legacy) => {
    expect(() => normalizer()(foodItem(legacy))).toThrow('LEGACY_ITEM_FIELD_NOT_ALLOWED');
  });

  it.each([undefined, '', 'head', 'Flower'])('requires one official artifact slot, received %s', (artifactSlot) => {
    const input = flowerArtifact();
    if (artifactSlot === undefined) delete (input as { artifactSlot?: unknown }).artifactSlot;
    else (input as { artifactSlot?: unknown }).artifactSlot = artifactSlot;
    expect(() => normalizer()(input)).toThrow('INVALID_ARTIFACT_SLOT');
  });

  it('rejects artifact slots on non-artifact items', () => {
    expect(() => normalizer()(foodItem({ artifactSlot: 'flower' }))).toThrow('UNEXPECTED_ARTIFACT_SLOT');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'requires a positive integer quantity, received %s',
    (quantity) => {
      expect(() => normalizer()(foodItem({ quantity }))).toThrow('INVALID_ITEM_QUANTITY');
    },
  );
});

describe('immutable inventory actions', () => {
  it('adds a normalized item without mutating the inventory or input', () => {
    const inventory: itemModel.TeyvatInventory = { items: [], mora: 777 };
    const input = foodItem({ hiddenAlias: true });

    const next = addItem()(inventory, input);

    expect(next).toEqual({ items: [foodItem()], mora: 777 });
    expect(next).not.toBe(inventory);
    expect(next.items).not.toBe(inventory.items);
    expect(next.items[0]).not.toBe(input);
    expect(input).toHaveProperty('hiddenAlias', true);
  });

  it('stacks by id while preserving existing formal metadata and both inputs', () => {
    const existing = normalizer()(foodItem());
    const inventory: itemModel.TeyvatInventory = { items: [existing], mora: 1200 };
    const incoming = foodItem({ quantity: 3, name: '不应覆盖原名称', source: '不应覆盖原来源' });

    const next = addItem()(inventory, incoming);

    expect(next.items).toEqual([{ ...existing, quantity: 5 }]);
    expect(next.mora).toBe(1200);
    expect(next.items[0]).not.toBe(existing);
    expect(inventory.items[0]!.quantity).toBe(2);
    expect(incoming.quantity).toBe(3);
  });

  it.each([0, -1, 1.5])('rejects invalid addition quantity %s', (quantity) => {
    expect(() => addItem()({ items: [], mora: 0 }, foodItem({ quantity }))).toThrow('INVALID_ITEM_QUANTITY');
  });

  it('decrements a stack immutably and preserves metadata', () => {
    const existing = normalizer()(foodItem());
    const inventory: itemModel.TeyvatInventory = { items: [existing], mora: 90 };

    const next = consumeItem()(inventory, existing.id, 1);

    expect(next).toEqual({ items: [{ ...existing, quantity: 1 }], mora: 90 });
    expect(next).not.toBe(inventory);
    expect(next.items).not.toBe(inventory.items);
    expect(next.items[0]).not.toBe(existing);
    expect(existing.quantity).toBe(2);
  });

  it('removes a stack only when consumption reaches exactly zero', () => {
    const existing = normalizer()(foodItem());
    const inventory: itemModel.TeyvatInventory = { items: [existing], mora: 90 };

    const next = consumeItem()(inventory, existing.id, 2);

    expect(next).toEqual({ items: [], mora: 90 });
    expect(inventory.items).toEqual([existing]);
  });

  it('rejects underflow, unknown ids, and invalid consumption quantities', () => {
    const inventory: itemModel.TeyvatInventory = { items: [normalizer()(foodItem())], mora: 0 };

    expect(() => consumeItem()(inventory, 'missing', 1)).toThrow('UNKNOWN_INVENTORY_ITEM');
    expect(() => consumeItem()(inventory, 'food-egg-1', 3)).toThrow('INSUFFICIENT_ITEM_QUANTITY');
    expect(() => consumeItem()(inventory, 'food-egg-1', 0)).toThrow('INVALID_ITEM_QUANTITY');
    expect(() => consumeItem()(inventory, 'food-egg-1', 1.5)).toThrow('INVALID_ITEM_QUANTITY');
  });
});

describe('formal inventory variable root', () => {
  it('accepts item pushes only at 背包.items and rejects traveler-side inventory paths', () => {
    const state = { 背包: { items: [], mora: 0 } };
    const value = foodItem();

    expect(validateCommand({ action: 'push', key: '背包.items', value }, state)).toMatchObject({
      allowed: true,
      root: '背包',
      rest: 'items',
    });
    expect(validateCommand({ action: 'push', key: '旅人.背包', value }, state).allowed).toBe(false);
    expect(validateCommand({ action: 'push', key: '旅行者.背包', value }, state).allowed).toBe(false);
  });

  it.each([
    '背包.items[name=提瓦特煎蛋].quantity',
    '背包.items[id=提瓦特煎蛋].quantity',
    '背包.items[source=猎鹿人餐馆].quantity',
    '背包.items[id=FOOD-EGG-1].quantity',
  ])('rejects non-id or non-exact inventory selectors: %s', (key) => {
    const inventory = { items: [normalizer()(foodItem())], mora: 0 };
    const command = { action: 'sub' as const, key, value: 1 };

    expect(validateCommand(command, { 背包: inventory }).allowed).toBe(false);
    const reduced = reduceVariableCommands([command], { 背包: inventory } as never);
    expect(reduced.results[0]!.ok).toBe(false);
    expect(reduced.nextState.背包).toEqual(inventory);
  });

  it('consumes only an exact id and still rejects underflow', () => {
    const inventory = { items: [normalizer()(foodItem())], mora: 0 };
    const exact = reduceVariableCommands([
      { action: 'sub', key: '背包.items[id=food-egg-1].quantity', value: 1 },
    ], { 背包: inventory } as never);
    expect(exact.results[0]!.ok).toBe(true);
    expect((exact.nextState.背包 as itemModel.TeyvatInventory).items[0]!.quantity).toBe(1);

    const underflow = reduceVariableCommands([
      { action: 'sub', key: '背包.items[id=food-egg-1].quantity', value: 3 },
    ], { 背包: inventory } as never);
    expect(underflow.results[0]!.ok).toBe(false);
    expect(underflow.nextState.背包).toEqual(inventory);
  });
});

describe('pre-turn root inventory snapshot', () => {
  const expectedInventory: itemModel.TeyvatInventory = {
    items: [normalizer()(foodItem())],
    mora: 321,
  };

  it('roundtrips the formal inventory and strips unknown nested keys', () => {
    const [toLegacy, fromLegacy] = checkpointMappers();
    const rawInventory = {
      ...expectedInventory,
      hiddenRoot: true,
      items: [{
        ...foodItem(),
        hiddenItem: true,
        useEffects: [{ target: '恢复体力', value: 20, basis: '热食', hiddenEffect: true }],
      }],
    } as unknown as itemModel.TeyvatInventory;

    const serialized = toLegacy({ turnCount: 9, pendingOpeningTrigger: null, inventory: rawInventory });
    expect(serialized.背包).toEqual(expectedInventory);
    const restored = fromLegacy(serialized);
    expect(restored.inventory).toEqual(expectedInventory);
  });

  it('keeps inventory absent when mapping a historical snapshot without 背包', () => {
    const [toLegacy, fromLegacy] = checkpointMappers();

    const serialized = toLegacy({ turnCount: 4, pendingOpeningTrigger: null });
    expect(serialized).not.toHaveProperty('背包');
    const restored = fromLegacy(serialized);
    expect(restored).not.toHaveProperty('inventory');
  });

  it('does not call the inventory setter for a historical snapshot without 背包', () => {
    const [toLegacy] = checkpointMappers();
    const snapshot = toLegacy({ turnCount: 4, pendingOpeningTrigger: null, inventory: expectedInventory });
    delete snapshot.背包;
    let inventorySetterCalls = 0;
    const noop = () => undefined;
    const state = {
      set旅人: noop,
      set背包: () => { inventorySetterCalls += 1; },
      set世界: noop,
      set记忆: noop,
      set世界树: noop,
      set图鉴: noop,
      set手机: noop,
      setNPC: noop,
      set相册: noop,
      set蒸汽鸟报: noop,
      set剧情: noop,
      set剧情编织: noop,
      // A5：重掷回滚现在也会还原任务与地图（第二轮审计 A5）。
      set任务: noop,
      updateGameState: noop,
      setVariableBatches: noop,
      setQueueTasks: noop,
      setTurnCount: noop,
      setPendingOpeningTrigger: noop,
      剧情编织: undefined,
    };

    restorePreTurnSnapshot(state as never, snapshot as never);

    expect(inventorySetterCalls).toBe(0);
  });

  it('restores the root inventory through its formal setter after deep normalization', () => {
    const [toLegacy] = checkpointMappers();
    const snapshot = toLegacy({ turnCount: 9, pendingOpeningTrigger: null, inventory: expectedInventory });
    snapshot.背包 = {
      ...expectedInventory,
      hiddenRoot: true,
      items: [{ ...foodItem(), hiddenItem: true }],
    };
    let restoredInventory: itemModel.TeyvatInventory | undefined;
    const noop = () => undefined;
    const state = {
      set旅人: noop,
      set背包: (value: itemModel.TeyvatInventory) => { restoredInventory = value; },
      set世界: noop,
      set记忆: noop,
      set世界树: noop,
      set图鉴: noop,
      set手机: noop,
      setNPC: noop,
      set相册: noop,
      set蒸汽鸟报: noop,
      set剧情: noop,
      set剧情编织: noop,
      // A5：重掷回滚现在也会还原任务与地图（第二轮审计 A5）。
      set任务: noop,
      updateGameState: noop,
      setVariableBatches: noop,
      setQueueTasks: noop,
      setTurnCount: noop,
      setPendingOpeningTrigger: noop,
      剧情编织: undefined,
    };

    restorePreTurnSnapshot(state as never, snapshot as never);

    expect(restoredInventory).toEqual(expectedInventory);
  });
});
