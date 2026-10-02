/**
 * 正文里的「玩家 ↔ NPC 亲密事件」证据扫描。
 *
 * ## 为什么重写（2026-09-29）
 *
 * 旧实现按 `，,；;` 切**子句**，并在**单个子句内**要求「NPC 全名 + 动作 + 玩家指代」三者共现，
 * 还额外要求子句长度 ≥ 8。真实行文（尤其第二人称叙述）几乎不满足：
 *   - `安柏亲吻了你。`（6 字）→ 死于长度闸；
 *   - `安柏俯下身，轻轻吻住了云。` → 名字与动作被 `，` 切开，**永远**不命中；
 *   - `她轻轻吻住了云。` → 代词主语，无法归属；
 *   - `「不要停……」安柏吻住了云。` → 子句含引号即整条丢弃（动作其实在引号外）；
 *   - `安柏在琴声里轻轻亲吻了云。` → 另一个单字角色名「琴」以**子串**形式命中「琴声」而被误杀。
 * 而变量模型被明文要求「亲密事件不要输出 affinityDelta」，于是漏判 = 好感度**静默不涨**。
 *
 * ## 现在的规则（逐条对应上面的漏判）
 *
 * 1. **粒度到句子**：主体在动作之前出现（同一句内 ≤ 24 字）即成立，允许跨一个逗号。
 * 2. **代词回指**：句子内动作前出现 `她/他/对方/那人` 而无具名主体时，回指**前两句内**最近被点名的可归属角色。
 * 3. **玩家侧**：`你/你的/我/我的/自己/旅行者/玩家姓名`，且必须与动作**同一子句**（保持精度：
 *    `安柏告诉云，丽莎亲吻了琴` 不算玩家参与）。
 * 4. **引号只屏蔽内容**：把 `「」“”『』‘’` 内部替换成等长占位符，对白不计、动作照算，且下标保持对齐。
 * 5. **否定/未实现**只看动作前 12 字窗口，不再整句否决（`她想起从前的吻，随后又吻了你` 仍能结算后一个动作）。
 * 6. **单字名子串防护**：长度 1 的姓名后面紧跟常见构词延续字（如「琴**声**」「空**气**」「荧**光**」）时不算点名。
 * 7. **归属竞争代替一票否决**：`安柏和丽莎一起拥抱了云` 这种**共同完成**标为 ambiguous 由调用方丢弃；
 *    而 `安柏亲吻了云，丽莎在旁边看着`（第三方仅在别处出现）正常结算。
 *    不通过成年硬闸的角色不参与主体竞争（否则「派蒙」能把别人的 +5 一起带走）。
 *
 * 只接受**已完成、肯定、直接归属于玩家与该 NPC** 的事件；否定、假设、转述、计划、旁观一律不算。
 */

type IntimacyTier = 'sex' | 'kiss' | 'flirt' | 'touch';

export interface NpcIntimacyEvent {
  tier: IntimacyTier;
  evidence: string;
  /** 同句多人共同完成同一动作 → 归属不唯一，调用方不得据此加分。 */
  ambiguous: boolean;
}

export interface NpcIntimacySubject {
  id: string;
  姓名?: string;
  aliases?: readonly string[];
  /** false = 该角色未通过成年硬闸，不参与主体归属，也不能让别的事件被它牵连丢弃。 */
  eligible?: boolean;
  /** false = 该角色被集中 NSFW 策略判定不得进入性爱档（亲吻/拥抱等低档位仍可结算）。 */
  allowSex?: boolean;
}

export interface NpcIntimacyMatch {
  npcId: string;
  tier: IntimacyTier;
  evidence: string;
  ambiguous: boolean;
}

const TIERS: readonly { tier: IntimacyTier; pattern: RegExp }[] = [
  {
    tier: 'sex',
    pattern: /(性爱|做爱|交合|性交|交欢|欢好|欢爱|云雨|巫山|鱼水之欢|春宵|缠绵|亲热|温存)/u,
  },
  {
    tier: 'kiss',
    pattern: /(亲吻|接吻|拥吻|吻了|吻上|吻住|吻遍|吻落|吻别|轻吻|深吻|亲了|亲上)/u,
  },
  {
    tier: 'flirt',
    pattern: /(暧昧|表白|告白|示爱|谈情|情话|调情|倾心|互诉衷肠|表明心意)/u,
  },
  {
    tier: 'touch',
    pattern: /(牵手|牵起|牵住|牵着|拉手|十指相扣|握住.{0,4}手|挽住|挽着|搂住|搂着|搂在怀里|搂抱|揽住|揽着|揽入怀|拥入怀|怀抱|拥抱|抱住|抱紧|相拥|依偎|靠在.{0,6}(?:怀里|肩上|身上)|贴在一起)/u,
  },
];

/** 否定的、未发生的、转述的、旁人视角的动作。只看动作前 12 字窗口，不再整句否决。 */
const UNREALIZED = /(没有|并未|未曾|不曾|尚未|拒绝|推开|挣脱|躲开|抽开|抽回|避开|梦见|幻想|假如|如果|倘若|打算|准备|计划|想要|试图|可能|或许|也许|将要|即将|曾经|听说|据说|转述|谈起|提起|看见|看到|目睹|旁观|在旁)/u;
const UNREALIZED_WINDOW = 12;

/** 主体与动作的最大距离（同句内）。够覆盖「安柏俯下身，轻轻吻住了云」。 */
const SUBJECT_WINDOW = 24;
/** 代词可回指的跨句范围。 */
const PRONOUN_CARRY_SENTENCES = 2;
/** 只有明确代称才回指；「少女/少年」这类普通名词太泛，不参与（会误归属路人）。 */
const SUBJECT_PRONOUNS = /(她|他|对方|那人)/u;
const CLAUSE_BOUNDARY = /[，,；;]/u;
const SENTENCE_SPLIT = /(?<=[。！？!?\n])/u;
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['「', '」'], ['“', '”'], ['『', '』'], ['‘', '’'], ['《', '》'],
];

const PLAYER_PRONOUNS: readonly string[] = ['你', '你的', '我', '我的', '自己', '旅行者'];
/** 单字名后紧跟这些字时视为构词延续，不算点名（琴声/空气/荧光…）。 */
const NAME_CONTINUATION = new Set(
  [...'声气调色音高矮长短大小老幼姐弟兄妹娘亲朋敌军师匠人工器水火风雷冰岩草木花叶云雨雪月日星光影血汗泪心肝魂魄灵神帝君王侯爵子郎曲谱弦'],
);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把引号内部的字符替换成等长占位符：屏蔽对白、保留下标对齐（归属判定依赖位置）。 */
function maskQuotedSpans(text: string): string {
  let out = text;
  for (const [open, close] of QUOTE_PAIRS) {
    let searchFrom = 0;
    for (;;) {
      const start = out.indexOf(open, searchFrom);
      if (start < 0) break;
      const end = out.indexOf(close, start + open.length);
      if (end < 0) break;
      const innerLength = end - (start + open.length);
      out = `${out.slice(0, start + open.length)}${'　'.repeat(innerLength)}${out.slice(end)}`;
      searchFrom = end + close.length;
    }
  }
  return out;
}

function namesOf(subject: NpcIntimacySubject): string[] {
  return [subject.姓名, ...(subject.aliases ?? [])]
    .map((name) => (name ?? '').trim())
    .filter(Boolean);
}

/** 单字名的子串防护：`琴声`/`空气`/`荧光` 不算点名。 */
function isNameBoundaryAcceptable(text: string, index: number, name: string): boolean {
  if (name.length > 1) return true;
  const next = text[index + 1] ?? '';
  return !next || !NAME_CONTINUATION.has(next);
}

function findNamePositions(text: string, name: string): number[] {
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(name, from);
    if (index < 0) break;
    from = index + 1;
    if (isNameBoundaryAcceptable(text, index, name)) positions.push(index);
  }
  return positions;
}

function playerTokens(playerName: string): string[] {
  const name = playerName.trim();
  const tokens = [...PLAYER_PRONOUNS];
  if (name && !tokens.includes(name)) tokens.unshift(name);
  return tokens;
}

/** 动作所在子句的起止下标，用于「玩家必须与动作同子句」的精度约束。 */
function clauseRangeAt(text: string, index: number): { start: number; end: number } {
  let start = 0;
  let end = text.length;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (char && CLAUSE_BOUNDARY.test(char)) {
      start = cursor + 1;
      break;
    }
  }
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char && CLAUSE_BOUNDARY.test(char)) {
      end = cursor;
      break;
    }
  }
  return { start, end };
}

interface SentencePart {
  text: string;
  source: string;
  offset: number;
}

function splitSentences(body: string, masked: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let offset = 0;
  for (const part of masked.split(SENTENCE_SPLIT)) {
    if (part) parts.push({ text: part, source: body.slice(offset, offset + part.length), offset });
    offset += part.length;
  }
  return parts;
}

/**
 * 扫描正文，返回每个 NPC 命中的**最高档**亲密事件。
 * 同一 NPC 同回合只保留一档，调用方据此加固定好感度。
 */
export function scanNpcIntimacyEvents(
  body: string,
  subjects: readonly NpcIntimacySubject[],
  options: { playerName?: string; allowSex?: boolean } = {},
): NpcIntimacyMatch[] {
  if (!body.trim()) return [];
  const allowSex = options.allowSex !== false;
  const participants = subjects.filter((subject) => subject.eligible !== false && namesOf(subject).length > 0);
  if (!participants.length) return [];
  const allowSexById = new Map(participants.map((subject) => [subject.id, subject.allowSex !== false]));
  const masked = maskQuotedSpans(body);
  const players = playerTokens(options.playerName ?? '');
  const sentences = splitSentences(body, masked);
  const best = new Map<string, { tier: IntimacyTier; evidence: string; rank: number; ambiguous: boolean }>();
  let carriedSubjectId: string | null = null;
  let carriedAge = 0;

  for (const sentence of sentences) {
    const mentions: { id: string; index: number }[] = [];
    for (const subject of participants) {
      for (const name of namesOf(subject)) {
        for (const index of findNamePositions(sentence.text, name)) mentions.push({ id: subject.id, index });
      }
    }
    mentions.sort((left, right) => left.index - right.index);
    const pronounPositions = [...sentence.text.matchAll(new RegExp(SUBJECT_PRONOUNS.source, 'gu'))]
      .map((match) => match.index ?? -1)
      .filter((index) => index >= 0);
    const carriedForSentence = carriedAge <= PRONOUN_CARRY_SENTENCES ? carriedSubjectId : null;

    for (const { tier, pattern } of TIERS) {
      if (tier === 'sex' && !allowSex) continue;
      for (const match of sentence.text.matchAll(new RegExp(pattern.source, 'gu'))) {
        const index = match.index ?? -1;
        if (index < 0) continue;
        const unrealizedWindow = sentence.text.slice(Math.max(0, index - UNREALIZED_WINDOW), index);
        if (UNREALIZED.test(unrealizedWindow)) continue;
        const clause = clauseRangeAt(sentence.text, index);
        const clauseText = sentence.text.slice(clause.start, clause.end);

        // 主体：优先动作前的最近点名；否则动作后 24 字内的点名（玩家主动式「你吻住了安柏」）；
        // 都没有但有代词时回指前两句内的具名主体。
        const before = [...mentions].reverse().find((mention) => mention.index < index
          && index - mention.index <= SUBJECT_WINDOW);
        const after = before ? undefined : mentions.find((mention) => mention.index > index
          && mention.index - index <= SUBJECT_WINDOW);
        const subjectId = before?.id ?? (after && players.some((token) => clauseText.includes(token))
          ? after.id
          : pronounPositions.some((position) => position < index)
            ? carriedForSentence
            : null);
        if (!subjectId) continue;
        // 性爱档还要过**逐个主体**的集中 NSFW 策略（NSFW 关闭时整体跳过，见上面的 allowSex）。
        if (tier === 'sex' && allowSexById.get(subjectId) === false) continue;

        // 玩家参与：必须与动作**同一子句**内出现玩家指代。
        if (!players.some((token) => clauseText.includes(token))) continue;

        const ambiguous = mentions.some((mention) => mention.id !== subjectId
          && mention.index < index
          && index - mention.index <= SUBJECT_WINDOW
          && /(和|与|跟|同|一起)/u.test(sentence.text.slice(mention.index, index))
          && !CLAUSE_BOUNDARY.test(sentence.text.slice(mention.index, index)));
        const rank = TIERS.findIndex((candidate) => candidate.tier === tier);
        const current = best.get(subjectId);
        if (current && current.rank <= rank) continue;
        best.set(subjectId, { tier, evidence: sentence.source.trim().slice(0, 240), rank, ambiguous });
      }
    }

    const lastNamed = mentions.at(-1);
    if (lastNamed) {
      carriedSubjectId = lastNamed.id;
      carriedAge = 0;
    } else {
      carriedAge += 1;
    }
  }

  return [...best.entries()].map(([npcId, value]) => ({
    npcId,
    tier: value.tier,
    evidence: value.evidence,
    ambiguous: value.ambiguous,
  }));
}

/**
 * 单记录版本的兼容包装（旧的调用点与单测按「一个 NPC」提问）。
 * 跨记录归属竞争请用 `scanNpcIntimacyEvents`。
 */
export function detectNpcIntimacyEvent(
  body: string,
  npc: { id?: string; 姓名: string; aliases?: readonly string[] },
  playerName: string,
  allowSex = true,
): NpcIntimacyEvent | null {
  const subject: NpcIntimacySubject = {
    id: npc.id ?? 'npc',
    姓名: npc.姓名,
    aliases: npc.aliases,
    eligible: true,
  };
  const [match] = scanNpcIntimacyEvents(body, [subject], { playerName, allowSex });
  return match ? { tier: match.tier, evidence: match.evidence, ambiguous: match.ambiguous } : null;
}

/**
 * 「这段文字在说亲密接触」的**宽松**提示（不用于结算，只用于去重判断）。
 *
 * 用途：模型在系统已经按固定档位结算了同一角色的亲密事件时又自报了一份 affinityDelta，
 * 但它的 evidence 是**改写**而不是逐字引用 —— 这时逐字比对（`removeDuplicateModelIntimacyAffinity`）
 * 会漏判，导致 +5/+30 被双计。这里只问「这段证据是不是在说亲密动作」，用一个刻意放宽的词表
 * （含单独的「吻」「抱」「牵」），代价是偶尔会把同回合另一条正面变化的模型增量一起丢掉；
 * 而模型本就被要求不要为已识别的亲密事件再写一份增量，所以这个代价可接受。
 */
const INTIMACY_PARAPHRASE_HINT = /(吻|做爱|性爱|缠绵|亲热|温存|相拥|拥抱|搂|牵起|牵手|依偎|表白|告白|示爱|暧昧|情话|亲密)/u;

export function mentionsIntimacyAct(text: string): boolean {
  return INTIMACY_PARAPHRASE_HINT.test(text);
}

/** 正则转义的调试入口（保持导出，便于单测与排查）。 */
export const __intimacyRegexEscape = escapeRegex;
