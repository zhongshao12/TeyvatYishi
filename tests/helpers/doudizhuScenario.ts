import type { DoudizhuUiAction } from '../../models/teyvat/doudizhu';
import type { TeyvatGameState } from '../../models/teyvat/state';
import { listLegalDoudizhuPlays } from '../../services/doudizhu/rules';
import { applyDoudizhuGameAction } from '../../services/doudizhu/settlement';

/** Find a terminal turn using only real, legal actions; never fabricate cards or logs. */
export function findDoudizhuTerminalTurn(
  createState: () => TeyvatGameState,
  npcIds: readonly [string, string],
  winningSide: 'landlord' | 'farmers',
): { before: TeyvatGameState; action: DoudizhuUiAction; after: TeyvatGameState } {
  for (let seed = 1; seed <= 80; seed += 1) {
    let state = applyDoudizhuGameAction(createState(), { type: 'invite', npcIds: [...npcIds], seed, gameId: `scenario-${seed}` });
    state = applyDoudizhuGameAction(state, { type: 'bid', points: 3 });
    for (let turn = 0; turn < 100; turn += 1) {
      const game = state.斗地主.currentGame;
      if (!game || game.phase === 'finished' || game.activeSeat !== 0) break;
      const legal = listLegalDoudizhuPlays(game.hands[0], game.trick?.pattern);
      const cards = game.trick
        ? legal.sort((a, b) => a.length - b.length)[0]
        : legal.sort((a, b) => b.length - a.length)[0];
      const action: DoudizhuUiAction = cards ? { type: 'play', cards } : { type: 'pass' };
      const after = applyDoudizhuGameAction(state, action);
      if (after.斗地主.currentGame?.phase === 'finished') {
        if (after.斗地主.currentGame.result?.winningSide === winningSide) return { before: state, action, after };
        break;
      }
      if (after.斗地主.lastError) break;
      state = after;
    }
  }
  throw new Error(`No legal ${winningSide} finish found`);
}
