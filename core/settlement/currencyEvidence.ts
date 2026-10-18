import type { CoreSnapshot } from '../contracts/state';
import { coreEntityNamePattern } from './entityResolution';
import { parseNarrativeNumber } from '@/utils/narrativeNumbers';

/** Prove one player-wallet transfer, not a price, balance, someone else's
 * purchase or a net amount guessed by the extractor. Ambiguity stays pending. */
export function provenCoreMoraDelta(text: string, snapshot: CoreSnapshot): number | null {
  const player = snapshot.records.find(row => row.domain === 'traveler');
  if (!player || /看着|看见|目睹|听说|声称|据说|得知|表示|告诉|说道/u.test(text)) return null;
  const amounts = [...text.matchAll(/([零〇一二两三四五六七八九十百千万亿\d]+)\s*(?:枚|个)?\s*摩拉/gu)];
  if (amounts.length !== 1) return null;
  const amount = amounts[0]!, literal = amount[1]!, suffix = literal.at(-1);
  const multiplier = suffix === '万' ? 10_000 : suffix === '亿' ? 100_000_000 : 1;
  const quantity = parseNarrativeNumber(multiplier === 1 ? literal : literal.slice(0, -1));
  if (quantity === null || quantity <= 0 || !Number.isSafeInteger(quantity * multiplier)) return null;
  const names = `(?:${coreEntityNamePattern(player, snapshot)}|玩家|你)`, before = text.slice(0, amount.index), after = text.slice(amount.index! + amount[0].length);
  const received = new RegExp(`${names}\\s*(?:获得|收到|接过|拾取|赚得|得到|领取|获赠)(?:了)?\\s*$`, 'u').test(before);
  const spent = new RegExp(`${names}\\s*(?:(?:向|付给|交给)[^。！？；，,\\n]{1,24}?)?(?:花费|花掉|花|支付|付出|支出|失去)(?:了)?\\s*$`, 'u').test(before);
  const playerGiving = new RegExp(`${names}\\s*把\\s*$`, 'u').test(before) && /^\s*(?:交给|递给|赠给|转给|支付给)/u.test(after);
  const givenToPlayer = !new RegExp(names, 'u').test(before) && /把\s*$/u.test(before) && new RegExp(`^\\s*(?:交给|递给|赠给|转给|支付给)(?:了)?\\s*${names}`, 'u').test(after);
  if ((received || givenToPlayer) === (spent || playerGiving)) return null;
  return (received || givenToPlayer ? 1 : -1) * quantity * multiplier;
}
