import type { FactProposal } from '../contracts/state';
import { travelDateOrdinal, worldClockMinutes } from '../contracts/worldClock';
import { parseNarrativeNumber } from '@/utils/narrativeNumbers';
import { 限制NPC好感度, 格式化NPC关系 } from '@/models/npc';
import type { RuleContext } from './ruleContext';

export function narrativeElapsedMinutes(text: string): number | null {
  let total = 0, count = 0;
  for (const match of text.matchAll(/([零〇一二两三四五六七八九十百千]+|\d+)\s*(?:个)?(天|日|小时|分钟)(?:之)?后/gu)) {
    const value = parseNarrativeNumber(match[1]!);
    if (value === null) continue;
    total += value * (match[2] === '天' || match[2] === '日' ? 1440 : match[2] === '小时' ? 60 : 1); count++;
  }
  if (/第二天|次日|翌日/u.test(text)) { total += 1440; count++; }
  return count ? total : null;
}
export function applyWorldRule(ctx: RuleContext, p: Extract<FactProposal, { kind: 'time' | 'location' | 'weather' }>, text: string, dailyAffinity: number): void {
  const world = ctx.get('world');
  if (p.kind === 'weather') world.value.moment.weather = p.weather;
  else if (p.kind === 'location') {
    world.value.moment.location = p.location;
    const maps = ctx.state.records.filter(record => record.domain === 'map' && record.value.name === p.location);
    if (maps.length === 1) world.value.moment.locationId = maps[0]!.entityId;
    else delete world.value.moment.locationId;
    if (p.region) { world.value.region = p.region; world.value.visitedRegions = [...new Set([...world.value.visitedRegions, p.region])]; }
  } else {
    const moment = world.value.moment;
    const ordinal = travelDateOrdinal(moment.date), clock = worldClockMinutes(moment.clock);
    if (ordinal === null || clock === null) throw Error('当前游戏日期或时刻未知，不能猜测推进。');
    const duration = narrativeElapsedMinutes(text);
    if (duration !== null && duration !== p.elapsedMinutes) throw Error('正文累计时间与提议不相符。');
    let minutes = p.elapsedMinutes;
    if (p.date !== undefined || p.clock !== undefined) {
      const date = travelDateOrdinal(p.date ?? moment.date), time = worldClockMinutes(p.clock ?? moment.clock);
      if (date === null || time === null) throw Error('目标日期或时刻无效。');
      const span = (date - ordinal) * 1440 + time - clock;
      if (span < 0 || (minutes !== 0 && minutes !== span)) throw Error('禁止同日时间倒退或互相冲突的时间跨度。');
      minutes = span;
    }
    if (!Number.isSafeInteger(minutes) || minutes < 0) throw Error('时间跨度无效。');
    ctx.normalizedFact = { ...p, elapsedMinutes: minutes };
    const days = Math.floor((clock + minutes) / 1440), newClock = (clock + minutes) % 1440;
    const zeroDate = ordinal + days - 1, year = Math.floor(zeroDate / 372), withinYear = zeroDate % 372;
    moment.date = `旅行历 ${year}.${String(Math.floor(withinYear / 31) + 1).padStart(2, '0')}.${String(withinYear % 31 + 1).padStart(2, '0')}`;
    moment.clock = `${String(Math.floor(newClock / 60)).padStart(2, '0')}:${String(newClock % 60).padStart(2, '0')}`;
    if (moment.travelDay !== null) moment.travelDay += days;
    for (const record of ctx.state.records) if (record.domain === 'npc' && days) {
      const npc = ctx.get('npc', record.entityId);
      if (!npc.value.travelingTogether) continue;
      npc.value.affinity = 限制NPC好感度(npc.value.affinity + days * dailyAffinity); npc.value.relationship = 格式化NPC关系(npc.value.affinity, npc.value.intimate); ctx.put(npc);
    }
  }
  ctx.put(world);
}
