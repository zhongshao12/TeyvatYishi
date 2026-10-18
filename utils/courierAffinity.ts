/** Existing phone exchange rule, shared without constructing a legacy NPC array. */
export function courierExchangeAffinity(playerText: string): number {
  const positive = /(谢谢|感谢|关心|想你|喜欢|爱你|抱歉|对不起|一起|陪你|辛苦|相信你|支持你)/u.test(playerText);
  const negative = /(讨厌|滚开|闭嘴|废物|威胁|不想见|别烦|恨你)/u.test(playerText);
  return negative ? -2 : positive ? 2 : playerText ? 1 : 0;
}
