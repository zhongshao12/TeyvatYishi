import type { TeyvatNpcRecord } from '../../models/teyvat/character';
import type { DoudizhuGame, DoudizhuMove, DoudizhuSeat } from '../../models/teyvat/doudizhu';
import { classifyDoudizhuPlay, listLegalDoudizhuPlays, rankOfCard } from './rules';

type NpcProfile = Pick<TeyvatNpcRecord, 'id' | 'affinity' | 'personality' | 'speechStyle'>;

export interface DoudizhuNpcView {
  seat: 1 | 2;
  hand: number[];
  phase: DoudizhuGame['phase'];
  landlord: DoudizhuSeat | null;
  activeSeat: DoudizhuSeat;
  highestBid: number;
  bids: DoudizhuGame['bids'];
  trick: DoudizhuGame['trick'];
  publicLog: DoudizhuGame['publicLog'];
  seed: number;
  redeals: number;
}

export function createDoudizhuNpcView(game: DoudizhuGame, seat: 1 | 2): DoudizhuNpcView {
  return {
    seat,
    hand: [...game.hands[seat]],
    phase: game.phase,
    landlord: game.landlord,
    activeSeat: game.activeSeat,
    highestBid: game.highestBid,
    bids: [...game.bids] as DoudizhuGame['bids'],
    trick: game.trick ? { ...game.trick, cards: [...game.trick.cards] } : null,
    publicLog: game.publicLog.map((entry) => ({ ...entry, ...(entry.cards ? { cards: [...entry.cards] } : {}) })),
    seed: game.seed,
    redeals: game.redeals,
  };
}

const sameSide = (a: DoudizhuSeat, b: DoudizhuSeat, landlord: DoudizhuSeat): boolean =>
  (a === landlord) === (b === landlord);

export function chooseDoudizhuNpcMove(view: DoudizhuNpcView, profile: NpcProfile): DoudizhuMove {
  if (view.activeSeat !== view.seat || view.phase === 'finished') throw new Error('NPC_NOT_ACTIVE');
  if (view.phase === 'bidding') {
    const ranks = view.hand.map(rankOfCard);
    const bombs = new Set(ranks.filter((rank) => ranks.filter((other) => other === rank).length === 4)).size;
    const strength = ranks.filter((rank) => rank >= 15).length * 2 + bombs * 3 + ranks.filter((rank) => rank >= 13 && rank < 15).length;
    const desired: 0 | 1 | 2 | 3 = strength >= 10 ? 3 : strength >= 7 ? 2 : strength >= 4 ? 1 : 0;
    return { type: 'bid', seat: view.seat, points: desired > view.highestBid ? desired : 0 };
  }
  const legal = listLegalDoudizhuPlays(view.hand, view.trick?.pattern);
  if (legal.length === 0) return { type: 'pass', seat: view.seat };
  if (view.trick && view.landlord !== null && sameSide(view.trick.seat, view.seat, view.landlord)) {
    const immediateWin = legal.find((cards) => cards.length === view.hand.length);
    if (immediateWin) return { type: 'play', seat: view.seat, cards: immediateWin };
    if (profile.affinity >= 20) return { type: 'pass', seat: view.seat };
  }
  const scored = legal.map((cards) => {
    const pattern = classifyDoudizhuPlay(cards)!;
    const specialCost = pattern.kind === 'rocket' ? 50 : pattern.kind === 'bomb' ? 30 : 0;
    const rankCost = pattern.mainRank + (cards.some((id) => rankOfCard(id) >= 15) ? 8 : 0);
    const score = view.trick
      ? specialCost + rankCost + cards.length / 100
      : specialCost + rankCost / 100 - cards.length * 3;
    return { cards, score, key: cards.join(',') };
  });
  scored.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
  return { type: 'play', seat: view.seat, cards: scored[0]!.cards };
}

const styleOf = (profile: NpcProfile): 'bright' | 'formal' | 'teasing' | 'scholar' | 'quiet' => {
  const text = `${profile.personality} ${profile.speechStyle}`.slice(0, 300);
  if (/骑士|严谨|正式|克制|责任|团长/.test(text)) return 'formal';
  if (/调侃|慵懒|玩笑|狡黠|戏谑/.test(text)) return 'teasing';
  if (/研究|学者|实验|知识|推演/.test(text)) return 'scholar';
  if (/活泼|热情|开朗|轻快|元气/.test(text)) return 'bright';
  return 'quiet';
};

export function describeDoudizhuNpcMove(move: DoudizhuMove, profile: NpcProfile, result?: DoudizhuGame['result']): string {
  const style = styleOf(profile);
  const lines = {
    bright: { bid: '嘿嘿，这局我想试试当地主！', play: '看我的，这手应该不错！', pass: '这轮先交给你啦！', win: '太好了，咱们配合得真棒！' },
    formal: { bid: '我来承担这一局的地主位。', play: '这手牌，稳妥地推进。', pass: '这一轮由你继续。', win: '配合得当，这局赢得漂亮。' },
    teasing: { bid: '哎呀，地主的位置倒也有趣。', play: '这张牌，你接得住吗？', pass: '呵呵，先让你表现一下。', win: '看来今天的手气偏向我们呢。' },
    scholar: { bid: '牌势允许，我试着叫分。', play: '按牌面推演，应该这样出。', pass: '暂时保留手牌，观察下一轮。', win: '这局的关键转折值得记下。' },
    quiet: { bid: '我叫一分，试试看。', play: '我出这一手。', pass: '这轮不要。', win: '这局结束了，打得不错。' },
  } as const;
  if (result) return lines[style].win;
  return lines[style][move.type];
}
