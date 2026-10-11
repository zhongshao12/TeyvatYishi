import type { ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { NPC_APPEARANCE_KEYS, npcAppearanceSourceLabel } from '@/services/npcAppearanceFacts';

/** A read-only public projection; never receives a private archive or a mutation callback. */
export function CodexCharacterDetails({ facts }: { facts: ImageCharacterFacts }) {
  return <section className="space-y-2 text-[13px] leading-6" aria-label="当前旅程角色外貌">
    <h4 className="font-serif tracking-[0.2em]">当前旅程 · 公开外貌</h4>
    {facts.appearance && <p>{facts.appearance}</p>}
    {facts.outfit && <p>穿着：{facts.outfit}</p>}
    <dl>{NPC_APPEARANCE_KEYS.flatMap(key => {
      const fact = facts.appearanceDetails?.[key];
      return fact ? [<div key={key} className="flex flex-wrap gap-x-2"><dt>{key}</dt><dd>{fact.value} <span className="text-xs opacity-75">（{npcAppearanceSourceLabel(fact.source)}）</span></dd></div>] : [];
    })}</dl>
  </section>;
}
