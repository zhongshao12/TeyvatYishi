const QUERY_LABEL_RE = /(?:玩家当前输入|当前输入|当前地点|当前相关人物|相关人物|最近正文|最近剧情|当前篇章|上下文)\s*[：:]\s*/giu;
const TOKEN_RE = /[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu;
const CJK_RE = /^\p{Script=Han}+$/u;
const MAX_QUERY_FRAGMENTS = 96;

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '');
}

function isUsefulStrongTerm(term: string): boolean {
  if (!term) return false;
  return CJK_RE.test(term) ? term.length >= 1 : term.length >= 2;
}

export interface RetrievalQueryProfile {
  compact: string;
  fragments: string[];
}

export function buildRetrievalQueryProfile(query: string): RetrievalQueryProfile | null {
  const labeledContent = query.replace(QUERY_LABEL_RE, ' ').trim();
  if (!labeledContent) return null;
  const compact = normalizeText(labeledContent);
  if (!compact) return null;

  const fragments = new Set<string>();
  for (const match of labeledContent.matchAll(TOKEN_RE)) {
    const token = normalizeText(match[0]);
    if (!token) continue;
    if (!CJK_RE.test(token)) {
      if (token.length >= 2) fragments.add(token);
      continue;
    }
    if (token.length <= 4) fragments.add(token);
    for (let size = 2; size <= Math.min(4, token.length); size += 1) {
      for (let index = 0; index <= token.length - size; index += 1) {
        fragments.add(token.slice(index, index + size));
        if (fragments.size >= MAX_QUERY_FRAGMENTS) break;
      }
      if (fragments.size >= MAX_QUERY_FRAGMENTS) break;
    }
    if (fragments.size >= MAX_QUERY_FRAGMENTS) break;
  }
  return { compact, fragments: [...fragments] };
}

export function scoreRetrievalCandidate(
  profile: RetrievalQueryProfile,
  searchableText: string,
  strongTerms: readonly string[],
): number {
  const source = normalizeText(searchableText);
  const normalizedStrongTerms = new Set(
    strongTerms.map(normalizeText).filter(isUsefulStrongTerm),
  );
  let strongScore = 0;
  for (const term of normalizedStrongTerms) {
    if (profile.compact.includes(term)) strongScore += 8 + Math.min(term.length, 12);
  }

  let fragmentHits = 0;
  for (const fragment of profile.fragments) {
    if (source.includes(fragment)) fragmentHits += 1;
  }
  if (strongScore === 0 && fragmentHits < 2) return 0;
  return strongScore + fragmentHits;
}
