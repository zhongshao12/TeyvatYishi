import { useEffect, useState } from 'react';
import type { CoreSnapshot, StateRecord } from '@/core/contracts/state';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { listLegalDoudizhuPlays, rankOfCard } from '@/services/doudizhu/rules';
import type { DoudizhuMove } from '@/models/teyvat/doudizhu';

const labels: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
const face = (id: number) => `${labels[rankOfCard(id)] ?? rankOfCard(id)}${id < 52 ? ['♠', '♥', '♣', '♦'][id % 4] : ''}`;
export function CoreDoudizhuPanel({ snapshot, onCommand, disabled = false }: { snapshot: CoreSnapshot; disabled?: boolean; onCommand(command: BasicPlayerCommand): Promise<unknown> }) {
  const [first, setFirst] = useState(''), [second, setSecond] = useState(''), [selected, setSelected] = useState<number[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmExit, setConfirmExit] = useState(false);
  const row = snapshot.records.find(record => record.domain === 'doudizhu'), game = row?.domain === 'doudizhu' ? row.value.currentGame : null;
  const people = snapshot.records.filter((record): record is StateRecord<'npc'> => record.domain === 'npc' && !record.value.archived);
  const name = (seat: number) => seat === 0 ? '你' : people.find(record => record.entityId === game?.npcIds[seat - 1])?.value.姓名 ?? '已归档同伴';
  useEffect(() => { setSelected([]); setConfirmExit(false); }, [row?.version]);
  const run = async (command: BasicPlayerCommand) => { setBusy(true); setError(''); try { await onCommand(command); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); } };
  const move = (input?: DoudizhuMove) => { if (game && row) void run({ type: 'doudizhu_turn', gameId: game.id, expectedVersion: row.version, ...(input ? { move: input } : {}) }); };
  return <section className="core2-card core2-doudizhu" aria-label="同伴斗地主"><h2>同伴斗地主</h2><p>邀两位旅伴围桌打牌。不设下注，不推进世界时间；完成一局后两位同伴各获最多 5 点好感，经历一起记入手账。</p>
    {error && <p role="alert" className="core2-error">{error}</p>}
    <fieldset disabled={disabled || busy}>
      {!game ? <><div className="core2-card-invites">{([['第一位同伴', first, setFirst], ['第二位同伴', second, setSecond]] as const).map(([label, value, setter]) => <label key={label}>{label}<select aria-label={label} value={value} onChange={event => setter(event.target.value)}><option value="">请选择</option>{people.map(npc => <option key={npc.entityId} value={npc.entityId}>{npc.value.姓名}</option>)}</select></label>)}</div><button disabled={!first || !second || first === second} onClick={() => void run({ type: 'doudizhu_start', npcIds: [first, second], seed: crypto.getRandomValues(new Uint32Array(1))[0]!, gameId: `cards-${crypto.randomUUID()}` })}>开始新局</button></> : <>
        <div className="core2-card-opponents">{([1, 2] as const).map(seat => <article key={seat}><strong>{name(seat)}</strong><p>{game.landlord === seat ? '地主' : game.landlord === null ? '待叫分' : '农民'} · 剩余 {game.hands[seat].length} 张</p></article>)}</div>
        <p role="status">{game.phase === 'finished' ? `本局结束 · ${game.result?.winningSide === 'landlord' ? '地主' : '农民'}方获胜 · 好感已结算` : game.phase === 'bidding' ? `正在叫分 · 轮到${name(game.activeSeat)}` : `${name(game.landlord!)}是地主 · 轮到${name(game.activeSeat)}出牌`}</p>
        {game.phase !== 'bidding' && <p>底牌：{game.bottom.map(face).join('　')}</p>}
        {game.trick && <p>桌面：{name(game.trick.seat)} · {game.trick.cards.map(face).join('　')}</p>}
        <div className="core2-playing-cards" aria-label="你的手牌">{game.hands[0].slice().sort((a, b) => rankOfCard(a) - rankOfCard(b) || a - b).map(card => <button key={card} data-card-id={card} className={card < 52 && card % 2 === 1 || card === 53 ? 'red' : ''} aria-pressed={selected.includes(card)} disabled={game.phase !== 'playing' || game.activeSeat !== 0} onClick={() => setSelected(current => current.includes(card) ? current.filter(id => id !== card) : [...current, card])}>{face(card)}</button>)}</div>
        {game.phase === 'bidding' && game.activeSeat === 0 && <div>{([0, 1, 2, 3] as const).map(points => <button key={points} disabled={points > 0 && points <= game.highestBid} onClick={() => move({ type: 'bid', seat: 0, points })}>{points ? `叫${points}分` : '不叫'}</button>)}</div>}
        {game.phase === 'playing' && game.activeSeat === 0 && <div><button onClick={() => { const legal = listLegalDoudizhuPlays(game.hands[0], game.trick?.pattern); if (!legal.length) setError('本轮没有能压过的牌，可以选择不要。'); else setSelected(legal[0]!); }}>提示选牌</button><button disabled={!selected.length} onClick={() => move({ type: 'play', seat: 0, cards: selected })}>出牌</button><button disabled={!game.trick || game.trick.seat === 0} onClick={() => move({ type: 'pass', seat: 0 })}>不要</button></div>}
        {game.phase !== 'finished' && game.activeSeat !== 0 && <button onClick={() => move()}>继续牌局</button>}
        {confirmExit ? <div><p>未结束的牌局退出后不结算奖励。</p><button onClick={() => row && void run({ type: 'doudizhu_abandon', gameId: game.id, expectedVersion: row.version })}>确认退出，不计奖励</button><button onClick={() => setConfirmExit(false)}>继续打牌</button></div> : <button onClick={() => setConfirmExit(true)}>{game.phase === 'finished' ? '收起牌局' : '退出牌局'}</button>}
      </>}
    </fieldset>
  </section>;
}
