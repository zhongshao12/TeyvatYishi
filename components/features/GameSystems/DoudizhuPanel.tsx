import { useEffect, useMemo, useState } from 'react';
import type { TeyvatNpcRecord } from '@/models/teyvat/character';
import { isValidDoudizhuGame, type DoudizhuState, type DoudizhuUiAction } from '@/models/teyvat/doudizhu';
import { canBeatDoudizhuPlay, classifyDoudizhuPlay, rankOfCard } from '@/services/doudizhu/rules';
import { CLIP_SECTION, CLIP_SMALL, insetRing } from '@/styles/clipPaths';

interface DoudizhuPanelProps {
  state: DoudizhuState;
  npcs: readonly TeyvatNpcRecord[];
  onAction: (action: DoudizhuUiAction) => void;
}

const CARD_RANKS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
const SUITS = ['♠', '♥', '♣', '♦'];
const face = (id: number) => {
  const rank = rankOfCard(id);
  return rank >= 16 ? CARD_RANKS[rank] : `${CARD_RANKS[rank] ?? rank}${SUITS[id % 4]}`;
};
const seatName = (seat: number, roster: readonly (TeyvatNpcRecord | undefined)[]) => seat === 0 ? '你' : roster[seat - 1]?.姓名 ?? `同伴${seat}`;
const freshId = () => globalThis.crypto?.randomUUID?.() ?? `doudizhu-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const freshSeed = () => {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
  return Date.now() | 0;
};

export function DoudizhuPanel({ state, npcs, onAction }: DoudizhuPanelProps) {
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [localError, setLocalError] = useState('');
  const eligible = useMemo(() => npcs.filter((npc) => npc.id && !npc.archived), [npcs]);
  const game = state.currentGame;
  const roster = game ? game.npcIds.map((id) => npcs.find((npc) => npc.id === id)) : [];
  const unavailable = Boolean(game && (roster.some((npc) => !npc || npc.archived) || !isValidDoudizhuGame(game)));

  useEffect(() => {
    setSelected([]);
    setLocalError('');
  }, [game?.id, game?.played.length]);

  const invite = () => {
    if (!firstId || !secondId || firstId === secondId) {
      setLocalError('请选择两位不同的已结识同伴。');
      return;
    }
    setLocalError('');
    onAction({ type: 'invite', npcIds: [firstId, secondId], seed: freshSeed(), gameId: freshId() });
  };
  const play = () => {
    if (!game || selected.length === 0) {
      setLocalError('请先选择要打出的手牌。');
      return;
    }
    const pattern = classifyDoudizhuPlay(selected);
    if (!pattern) {
      setLocalError('选中的牌不构成合法牌型。');
      return;
    }
    if (game.trick && !canBeatDoudizhuPlay(pattern, game.trick.pattern)) {
      setLocalError('这手牌压不过桌面牌；可改选或选择不要。');
      return;
    }
    setSelected([]);
    setLocalError('');
    onAction({ type: 'play', cards: selected });
  };

  return (
    <section className="space-y-4 text-sm" style={{ color: 'rgb(var(--tj-text-primary))' }}>
      <div className="px-4 py-4" style={{ background: 'linear-gradient(135deg,rgba(var(--tj-accent-primary),0.14),rgba(var(--tj-surface-strong),0.9))', boxShadow: insetRing(0.22), clipPath: CLIP_SECTION }}>
        <div className="font-serif text-lg tracking-[0.18em]">✦ 同伴斗地主</div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.95)' }}>约两位熟识的旅伴围桌打牌。牌局可随存档继续；每局结束两位同伴各获好感 +5，不改变旅程时间。</p>
      </div>

      {(localError || state.lastError) && <p role="alert" className="px-3 py-2 text-xs" style={{ background: 'rgba(var(--tj-ui-danger),0.13)', boxShadow: insetRing(0.25), clipPath: CLIP_SMALL }}>{localError || state.lastError}</p>}

      {!game ? (
        <div className="space-y-3 px-4 py-4" style={{ background: 'rgba(var(--tj-bg-primary),0.55)', boxShadow: insetRing(0.18), clipPath: CLIP_SECTION }}>
          <div className="font-serif text-sm">邀请两位同伴</div>
          <label className="block text-xs">第一位同伴
            <select aria-label="第一位同伴" value={firstId} onChange={(event) => setFirstId(event.target.value)} className="mt-1 block w-full rounded border p-2 text-sm text-slate-900">
              <option value="">请选择</option>{eligible.map((npc) => <option value={npc.id} key={npc.id}>{npc.姓名}</option>)}
            </select>
          </label>
          <label className="block text-xs">第二位同伴
            <select aria-label="第二位同伴" value={secondId} onChange={(event) => setSecondId(event.target.value)} className="mt-1 block w-full rounded border p-2 text-sm text-slate-900">
              <option value="">请选择</option>{eligible.map((npc) => <option value={npc.id} key={npc.id}>{npc.姓名}</option>)}
            </select>
          </label>
          <button type="button" onClick={invite} className="px-4 py-2 font-semibold" style={{ background: 'rgba(var(--tj-accent-primary),0.2)', boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>开始新局</button>
          {eligible.length < 2 && <p className="text-xs">至少需要两位未归档的已结识同伴。</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="px-4 py-3" style={{ background: 'rgba(var(--tj-bg-primary),0.56)', boxShadow: insetRing(0.18), clipPath: CLIP_SECTION }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-serif">{game.phase === 'bidding' ? '叫分阶段' : game.phase === 'finished' ? '本局结束' : '出牌阶段'}</span>
              <button type="button" onClick={() => onAction({ type: 'abandon' })} className="px-3 py-1 text-xs" style={{ boxShadow: insetRing(0.25), clipPath: CLIP_SMALL }}>退出牌局</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              {game.hands.map((hand, seat) => <div key={seat} className="min-w-0 px-1 py-2" style={{ background: seat === game.activeSeat ? 'rgba(var(--tj-accent-primary),0.15)' : 'rgba(var(--tj-surface-strong),0.5)' }}>
                <div className="truncate">{seatName(seat, roster)}{game.landlord === seat ? ' · 地主' : game.landlord === null ? '' : ' · 农民'}</div>
                <div className="mt-1">{hand.length} 张</div>
              </div>)}
            </div>
            {game.trick && <div className="mt-3 text-xs">桌面：{seatName(game.trick.seat, roster)} · {game.trick.cards.map(face).join(' ')}</div>}
          </div>

          {unavailable ? <p className="px-4 py-3 text-xs" style={{ boxShadow: insetRing(0.24) }}>受邀同伴已归档、找不到，或牌局数据无法继续。请退出牌局后重新选人；不会结算好感。</p>
            : game.phase === 'finished' ? <div className="px-4 py-4" style={{ boxShadow: insetRing(0.2), clipPath: CLIP_SECTION }}>
              <div className="font-serif text-base">{game.result?.winningSide === 'landlord' ? '地主获胜' : '农民获胜'}</div>
              <p className="mt-1 text-xs">{game.settled ? '牌局已结算：两位同伴各获好感 +5，并留下同行记忆。' : '牌局结果待结算。'}</p>
            </div> : game.activeSeat !== 0 ? <p className="text-xs">同伴正在出牌……</p>
              : game.phase === 'bidding' ? <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((points) => <button key={points} type="button" disabled={points > 0 && points <= game.highestBid} onClick={() => onAction({ type: 'bid', points: points as 0 | 1 | 2 | 3 })} className="px-3 py-2 disabled:opacity-40" style={{ boxShadow: insetRing(0.24), clipPath: CLIP_SMALL }}>{points === 0 ? '不叫' : `叫 ${points} 分`}</button>)}
              </div> : <div className="space-y-3">
                <div className="flex flex-wrap gap-2" aria-label="你的手牌">
                  {[...game.hands[0]].sort((a, b) => rankOfCard(a) - rankOfCard(b) || a - b).map((id) => <button key={id} data-card-id={id} type="button" aria-label={`选择 ${face(id)}`} aria-pressed={selected.includes(id)} onClick={() => { setLocalError(''); setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]); }} className="min-w-9 rounded px-2 py-3 font-semibold transition-transform" style={{ background: selected.includes(id) ? 'rgba(var(--tj-accent-primary),0.33)' : 'rgba(var(--tj-surface-strong),0.9)', boxShadow: insetRing(selected.includes(id) ? 0.6 : 0.25), transform: selected.includes(id) ? 'translateY(-6px)' : 'none' }}>{face(id)}</button>)}
                </div>
                <div className="flex gap-2"><button type="button" onClick={play} className="px-4 py-2" style={{ background: 'rgba(var(--tj-accent-primary),0.2)', boxShadow: insetRing(0.3), clipPath: CLIP_SMALL }}>出牌</button>
                  {game.trick && <button type="button" onClick={() => { setSelected([]); setLocalError(''); onAction({ type: 'pass' }); }} className="px-4 py-2" style={{ boxShadow: insetRing(0.2), clipPath: CLIP_SMALL }}>不要</button>}</div>
              </div>}

          <div className="px-4 py-3 text-xs" style={{ background: 'rgba(var(--tj-bg-primary),0.5)', boxShadow: insetRing(0.14), clipPath: CLIP_SECTION }}>
            <div className="font-serif">最近出牌</div>
            <ul className="mt-2 space-y-1" aria-label="最近出牌">
              {game.publicLog.slice(-8).map((entry, index) => <li key={`${game.id}-${index}-${entry.seat}-${entry.type}`}>{seatName(entry.seat, roster)} · {entry.type === 'bid' ? entry.points ? `叫 ${entry.points} 分` : '不叫' : entry.type === 'pass' ? '不要' : `打出 ${entry.cards?.map(face).join(' ')}`}</li>)}
              {game.publicLog.length === 0 && <li>尚无行动。</li>}
            </ul>
          </div>
        </div>
      )}

      {state.recentGames.length > 0 && <div className="text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.9)' }}>最近已完成 {state.recentGames.length} 局 · 无下注</div>}
    </section>
  );
}
