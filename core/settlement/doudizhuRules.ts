import type { BasicPlayerCommand } from './actions';
import type { RuleContext } from './ruleContext';
import { applyDoudizhuMove } from '@/services/doudizhu/game';
import { chooseDoudizhuNpcMove, createDoudizhuNpcView } from '@/services/doudizhu/strategy';
import { 限制NPC好感度, 格式化NPC关系 } from '@/models/npc';

export function applyCoreDoudizhuTurn(ctx: RuleContext, command: Extract<BasicPlayerCommand, { type: 'doudizhu_turn' | 'doudizhu_abandon' }>): void {
  const record = ctx.get('doudizhu'), old = record.value.currentGame;
  if (!old || old.id !== command.gameId || record.version !== command.expectedVersion) throw Error('牌局已更新，请按当前手牌操作。');
  if (command.type === 'doudizhu_abandon') { record.value.currentGame = null; ctx.put(record); return; }
  if (old.phase === 'finished') throw Error('牌局已结束，不会再次发放奖励。');
  let game = { ...structuredClone(old), publicLog: [] as import('@/models/teyvat/doudizhu').DoudizhuLogEntry[] };
  if (command.move) {
    if (command.move.seat !== 0 || game.activeSeat !== 0) throw Error('只能操作自己的手牌。');
    game = applyDoudizhuMove(game, command.move);
  } else if (game.activeSeat === 0) throw Error('请先叫分或选择出牌。');
  for (let step = 0; step < 12 && game.phase !== 'finished' && game.activeSeat !== 0; step++) {
    const seat = game.activeSeat;
    if (seat !== 1 && seat !== 2) throw Error('牌局座位无效。');
    const npc = ctx.get('npc', game.npcIds[seat - 1]);
    if (npc.value.archived) throw Error('有参与角色已归档，请退出牌局后重新邀请。');
    game = applyDoudizhuMove(game, chooseDoudizhuNpcMove(createDoudizhuNpcView(game, seat), npc.value));
  }
  if (game.phase === 'finished' && !old.settled) {
    game.settled = true;
    for (const id of game.npcIds) {
      const npc = ctx.get('npc', id); npc.value.affinity = 限制NPC好感度(npc.value.affinity + 5); npc.value.relationship = 格式化NPC关系(npc.value.affinity, npc.value.intimate); ctx.put(npc);
    }
  }
  const { publicLog: _log, ...stored } = game; record.value.currentGame = stored; ctx.put(record);
}
