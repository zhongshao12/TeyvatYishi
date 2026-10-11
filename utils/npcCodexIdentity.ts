import { matchCanonical, matchCanonicalIdentity } from '@/data/canonicalCharacters';

const exactName = (name: string | undefined) => name?.trim().toLocaleLowerCase() || '';

/** Match an existing durable canon identity or an exact name/alias; never a substring or a descriptive tag. */
export function matchesNpcCodexIdentity(npc: { id?: string; 姓名: string; 别名?: string }, entry: { name: string }): boolean {
  const name = exactName(entry.name);
  if (!name) return false;
  if ([npc.姓名, npc.别名].some(candidate => exactName(candidate) === name)) return true;
  const canonical = matchCanonicalIdentity({ id: npc.id, name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [] });
  return Boolean(canonical && matchCanonical(entry.name)?.name === canonical.name);
}
