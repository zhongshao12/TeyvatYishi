type IntimacyTier = 'sex' | 'kiss' | 'flirt' | 'touch';

export interface NpcIntimacyEvent {
  tier: IntimacyTier;
  evidence: string;
}

const TIERS: readonly { tier: IntimacyTier; pattern: RegExp }[] = [
  { tier: 'sex', pattern: /(性爱|做爱|交合|性交|交欢|欢好|欢爱|云雨|巫山|鱼水之欢|春宵)/u },
  { tier: 'kiss', pattern: /(亲吻|接吻|吻了|吻上|吻住|吻别|轻吻|深吻|亲了|亲上)/u },
  { tier: 'flirt', pattern: /(暧昧|表白|告白|示爱|谈情|情话|调情|倾心|互诉衷肠|表明心意)/u },
  { tier: 'touch', pattern: /(牵手|牵起|牵住|牵着|拉手|十指相扣|握住.{0,4}手|挽住|挽着|搂住|搂着|搂在怀里|拥抱|抱住|抱紧|依偎|靠在.{0,6}(?:怀里|肩上|身上)|贴在一起)/u },
];

const UNREALIZED = /(没有|并未|未曾|不曾|尚未|拒绝|推开|挣脱|躲开|抽开|抽回|避开|梦见|幻想|假如|如果|倘若|打算|准备|计划|想要|试图|可能|或许|也许|将要|即将|曾经|回忆|听说|据说|转述|谈起|提起|看见|看到|目睹|旁观|在旁)/u;
const PLAYER_SECOND_PERSON = /(?:你|你的)/u;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attributed(clause: string, npcName: string, playerNames: readonly string[], action: RegExp): boolean {
  const escapedNpc = escapeRegex(npcName);
  const escapedPlayers = playerNames.map(escapeRegex).join('|');
  const actionSource = action.source;
  const direct = new RegExp(`(?:${escapedNpc}).{0,16}${actionSource}.{0,16}(?:${escapedPlayers})|(?:${escapedPlayers}).{0,16}${actionSource}.{0,16}(?:${escapedNpc})`, 'u');
  const together = new RegExp(`(?:${escapedNpc}).{0,4}(?:与|和|跟|同|向)(?:${escapedPlayers}).{0,16}${actionSource}|(?:${escapedPlayers}).{0,4}(?:与|和|跟|同|向)(?:${escapedNpc}).{0,16}${actionSource}`, 'u');
  return direct.test(clause) || together.test(clause);
}

/** Only completed, affirmative, directly attributed player↔NPC events are accepted. */
export function detectNpcIntimacyEvent(
  body: string,
  npc: { 姓名: string; aliases?: readonly string[] },
  playerName: string,
  allowSex = true,
): NpcIntimacyEvent | null {
  const names = [npc.姓名, ...(npc.aliases ?? [])].map((name) => name.trim()).filter(Boolean);
  const players = [playerName.trim()].filter(Boolean);
  let best: NpcIntimacyEvent | null = null;
  for (const sentence of body.split(/(?<=[。！？!?\n])/u)) {
    const clauses = sentence.split(/[，,；;]/u).map((clause) => clause.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (clause.length < 8 || UNREALIZED.test(clause) || /[“”「」]/u.test(clause)) continue;
      const playerTokens = PLAYER_SECOND_PERSON.test(clause) ? [...players, '你', '你的'] : players;
      if (!playerTokens.length || !names.some((name) => clause.includes(name))) continue;
      const tier = TIERS.find((candidate) => (allowSex || candidate.tier !== 'sex')
        && names.some((name) => attributed(clause, name, playerTokens, candidate.pattern)));
      if (!tier) continue;
      const currentBestTier = best?.tier;
      if (!currentBestTier || TIERS.findIndex((candidate) => candidate.tier === tier.tier)
        < TIERS.findIndex((candidate) => candidate.tier === currentBestTier)) {
        best = { tier: tier.tier, evidence: clause.slice(0, 240) };
      }
    }
  }
  return best;
}
