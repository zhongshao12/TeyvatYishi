import { 格式化NPC关系, 获取NPC兼容关系, 限制NPC好感度 } from '../../models/npc';
import type { TeyvatNpcRecord } from '../../models/teyvat/character';
import { isValidDoudizhuGame, type DoudizhuGame, type DoudizhuUiAction } from '../../models/teyvat/doudizhu';
import type { TeyvatGameState } from '../../models/teyvat/state';
import { applyDoudizhuMove, isReachableDoudizhuGame, startDoudizhuGame } from './game';
import { chooseDoudizhuNpcMove, createDoudizhuNpcView } from './strategy';

const withError = (state: TeyvatGameState, message: string): TeyvatGameState => ({
  ...state,
  斗地主: { ...state.斗地主, lastError: message.slice(0, 300) },
});

const participants = (state: TeyvatGameState, ids: readonly [string, string]): [TeyvatNpcRecord, TeyvatNpcRecord] | null => {
  const first = state.NPC.find((npc) => npc.id === ids[0]);
  const second = state.NPC.find((npc) => npc.id === ids[1]);
  return first && second && first !== second && !first.archived && !second.archived ? [first, second] : null;
};

const describeRealMoment = (game: DoudizhuGame): string => {
  const moments = game.publicLog.filter((entry) => entry.type === 'play').slice(-2).map((entry) => {
    const speaker = entry.seat === 0 ? '玩家' : entry.seat === 1 ? '第一位同伴' : '第二位同伴';
    const count = entry.cards?.length ?? 0;
    return `${speaker}打出${count}张牌`;
  });
  return moments.length ? `关键回合：${moments.join('，')}。` : '三人依次叫分并完成了牌局。';
};

function settle(state: TeyvatGameState, game: DoudizhuGame, roster: [TeyvatNpcRecord, TeyvatNpcRecord]): TeyvatGameState {
  if (!game.result || game.settled || state.斗地主.settledGameIds.includes(game.id)) return state;
  const result = game.result;
  const playerName = state.旅行者.姓名 || '玩家';
  const moment = describeRealMoment(game);
  const deltas = roster.map((npc) => 限制NPC好感度(npc.affinity + 5) - npc.affinity) as [number, number];
  const updatedNpcs = state.NPC.map((npc) => {
    const index = roster.findIndex((invited) => invited.id === npc.id);
    if (index < 0) return npc;
    const affinity = 限制NPC好感度(npc.affinity + 5);
    const side = (index + 1) === game.landlord ? '地主' : '农民';
    const won = (result.winningSide === 'landlord') === ((index + 1) === game.landlord);
    const summary = `【斗地主】${npc.姓名}与${playerName}、${roster[1 - index]!.姓名}完成一局斗地主；作为${side}${won ? '获胜' : '虽败仍完成对局'}。${moment}`;
    const memoryId = `doudizhu:${game.id}:${npc.id}`;
    const storyMemories = npc.sharedMemories.filter((memory) => !memory.id.startsWith('doudizhu:'));
    const cardMemories = npc.sharedMemories.filter((memory) => memory.id.startsWith('doudizhu:') && memory.id !== memoryId);
    const storyExperiences = npc.relationshipLedger.sharedExperiences.filter((item) => !item.startsWith('【斗地主】'));
    const cardExperiences = npc.relationshipLedger.sharedExperiences.filter((item) => item.startsWith('【斗地主】') && item !== summary);
    return {
      ...npc,
      affinity,
      relationship: 获取NPC兼容关系(affinity),
      sharedMemories: [...storyMemories, ...cardMemories.slice(-49), {
        id: memoryId,
        turn: state.turnCount,
        summary,
        source: 'other' as const,
        relatedNpcIds: roster.map((participant) => participant.id).filter((id) => id !== npc.id),
      }],
      relationshipLedger: {
        ...npc.relationshipLedger,
        recentInteraction: summary,
        currentStage: 格式化NPC关系(affinity, npc.intimate),
        sharedExperiences: [...storyExperiences, ...cardExperiences.slice(-49), summary],
      },
    };
  });
  const results = roster.map((npc, index) => ({
    command: { action: 'add' as const, key: `NPC.[id=${npc.id}].affinity`, value: deltas[index]! },
    ok: true,
    kind: 'command' as const,
    evidence: '斗地主完成：受邀同伴固定好感 +5（遵守上限）',
  }));
  return {
    ...state,
    NPC: updatedNpcs,
    叙事: {
      ...state.叙事,
      variableBatches: [...state.叙事.variableBatches, {
        id: `doudizhu:${game.id}`,
        turn: state.turnCount,
        timestamp: state.turnCount,
        source: 'doudizhu' as const,
        results,
        committedChanges: roster.map((npc, index) => ({
          kind: 'affinity' as const,
          id: npc.id,
          name: npc.姓名,
          before: npc.affinity,
          after: 限制NPC好感度(npc.affinity + 5),
        })),
      }].slice(-300),
    },
    斗地主: {
      ...state.斗地主,
      currentGame: { ...game, settled: true },
      settledGameIds: [...state.斗地主.settledGameIds.filter((id) => id !== game.id), game.id].slice(-50),
      recentGames: [...state.斗地主.recentGames.filter((entry) => entry.id !== game.id), {
        id: game.id,
        npcIds: [...game.npcIds] as [string, string],
        landlord: game.landlord!,
        winningSide: result.winningSide,
      }].slice(-20),
      lastError: undefined,
    },
  };
}

export function applyDoudizhuGameAction(state: TeyvatGameState, action: DoudizhuUiAction): TeyvatGameState {
  if (action.type === 'abandon') return {
    ...state,
    斗地主: { ...state.斗地主, currentGame: null, lastError: undefined },
  };
  if (action.type === 'invite') {
    if (state.斗地主.currentGame && state.斗地主.currentGame.phase !== 'finished') {
      return withError(state, '请先结束或退出当前牌局。');
    }
    if (!participants(state, action.npcIds)) return withError(state, '找不到受邀同伴，或其中一位已归档。');
    if (state.斗地主.settledGameIds.includes(action.gameId)) return withError(state, '这局的编号已结算，请重新开始。');
    try {
      const currentGame = startDoudizhuGame(action.npcIds, action.seed, action.gameId);
      return { ...state, 斗地主: { ...state.斗地主, currentGame, lastError: undefined } };
    } catch (error) {
      return withError(state, error instanceof Error ? error.message : '无法创建牌局。');
    }
  }

  const game = state.斗地主.currentGame;
  if (!game || !isValidDoudizhuGame(game) || !isReachableDoudizhuGame(game)) return withError(state, '牌局数据损坏或无效，请返回选人重新开始。');
  const roster = participants(state, game.npcIds);
  if (!roster) return withError(state, '受邀同伴找不到或已归档，请退出牌局后重新选人。');
  if (game.phase === 'finished' || game.settled || state.斗地主.settledGameIds.includes(game.id)) {
    return withError(state, '这一局已经结束，不会重复结算。');
  }
  if (game.activeSeat !== 0) return withError(state, '还没有轮到你出手。');
  try {
    let next = applyDoudizhuMove(game, action.type === 'bid'
      ? { type: 'bid', seat: 0, points: action.points }
      : action.type === 'play' ? { type: 'play', seat: 0, cards: action.cards }
        : { type: 'pass', seat: 0 });
    let steps = 0;
    while (next.phase !== 'finished' && next.activeSeat !== 0 && steps < 24) {
      const seat = next.activeSeat as 1 | 2;
      const move = chooseDoudizhuNpcMove(createDoudizhuNpcView(next, seat), roster[seat - 1]!);
      next = applyDoudizhuMove(next, move);
      steps += 1;
    }
    if (steps >= 24) return withError(state, '牌局自动回合已暂停，请重新载入或退出该局。');
    const updated = { ...state, 斗地主: { ...state.斗地主, currentGame: next, lastError: undefined } };
    return next.phase === 'finished' ? settle(updated, next, roster) : updated;
  } catch (error) {
    return withError(state, error instanceof Error ? error.message : '牌局操作失败。');
  }
}
