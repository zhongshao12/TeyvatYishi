import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { 创建NPC记录 } from '@/models/npc';
import { applyLegacyNpcRecords, mapTeyvatNpcsToLegacy, toLegacyTraveler, applyLegacyGameStateOverrides } from '@/hooks/useGameState';

const anchor = { 正面提示词: 'silver hair, blue eyes, star brooch', 负面提示词: 'red hair', 场景生图自动注入: false };
describe('recorded visual anchors survive formal save projections', () => {
  it('keeps NPC anchors through projection, serialization, normalization and reload', () => {
    const npc = { ...创建NPC记录({ 姓名: 'Anchor explorer', 初见回合: 1 }), 图像档案: { 角色锚点: anchor } };
    const game = applyLegacyNpcRecords(createEmptyTeyvatGameState(), [npc]);
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(game)));
    expect(mapTeyvatNpcsToLegacy(restored)[0]?.图像档案?.角色锚点).toMatchObject(anchor);
  });
  it('keeps traveler anchors when committing the legacy editor and reopening', () => {
    const game = createEmptyTeyvatGameState();
    const traveler = { ...toLegacyTraveler(game), 图像档案: { 角色锚点: anchor } };
    const updated = applyLegacyGameStateOverrides(game, { 旅人: traveler });
    expect(toLegacyTraveler(normalizeTeyvatGameState(JSON.parse(JSON.stringify(updated)))).图像档案?.角色锚点).toMatchObject(anchor);
  });
});
