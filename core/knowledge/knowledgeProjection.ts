import type { EventDraft } from '../contracts/event';
import type { KnowledgeRecord } from '../contracts/knowledge';
import type { CoreSnapshot } from '../contracts/state';
import { validateCoreDto } from '../contracts/validation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { coreEntityNamePattern } from '../settlement/entityResolution';
import { coreIntimacyMatch } from '../settlement/relationshipRules';

/** Projects only explicit learning evidence, never the cast list or event public visibility alone. */
export function projectCoreKnowledge(events: EventDraft[], state: CoreSnapshot): KnowledgeRecord[] {
  const result = new Map<string, KnowledgeRecord>();
  for (const event of events) {
    if (event.journeyId !== state.head.scope.journeyId || event.branchId !== state.head.scope.branchId) throw Error('CORE2_KNOWLEDGE_SCOPE');
    if (!validateCoreDto('eventDraft', event).ok) throw Error('CORE2_KNOWLEDGE_EVENT_INVALID');
    if (event.type.startsWith('player.') || event.type === 'narration.recorded') continue;
    for (const record of state.records) {
      if (record.domain !== 'npc') continue;
      const names = coreEntityNamePattern(record, state);
      const evidenceByMode = new Map<KnowledgeRecord['mode'], typeof event.evidenceRefs>();
      for (const ref of event.evidenceRefs) for (const text of ref.quote.split(/[，,；;。！？!?\n]/u)) {
        if (/(?:没有|并未|未曾|准备|打算|假如).{0,16}(?:看见|目睹|读|听说|告诉)/u.test(text)) continue;
        const subject = `(?:${names})`;
        let mode: KnowledgeRecord['mode'] | undefined;
        if (event.fact?.kind === 'relationship' && event.fact.npcId === record.entityId
          && coreIntimacyMatch({ proposal: event.fact, evidenceRefs: [ref] }, state)) mode = 'witnessed';
        else if (event.fact?.kind === 'experience' && event.fact.participantIds.includes(record.entityId)) mode = 'witnessed';
        else if (new RegExp(`${subject}.{0,6}(?:听说|听闻|据说)`, 'u').test(text)) mode = 'rumor';
        else if (event.visibility.kind === 'public' && new RegExp(`${subject}.{0,6}(?:读到|阅读|看了).{0,10}(?:报纸|报道|消息|简报)`, 'u').test(text)) mode = 'read_public';
        else if (new RegExp(`(?:告诉|告知|通知).{0,3}${subject}|向${subject}(?:讲述|说明|解释|透露)|${subject}.{0,4}(?:得知|获知|收到消息)`, 'u').test(text)) mode = 'told';
        else if (new RegExp(`${subject}.{0,6}(?:亲眼|目睹|看见|见证)|${subject}(?:把|将).{0,20}(?:交给|递给|送给|放入)|${subject}.{0,4}(?:亲吻|拥抱|加入.{0,3}队伍|离开.{0,3}队伍)`, 'u').test(text)) mode = 'witnessed';
        else if (event.fact?.kind === 'commitment' && event.fact.participantIds.includes(record.entityId) && new RegExp(`${subject}.{0,4}(?:约定|承诺|答应)`, 'u').test(text)) mode = 'witnessed';
        if (mode) {
          const refs = evidenceByMode.get(mode) ?? [];
          if (!refs.includes(ref)) refs.push(ref);
          evidenceByMode.set(mode, refs);
        }
      }
      for (const [mode, evidenceRefs] of evidenceByMode) {
        const knowledgeId = `knowledge-${checksumUtf8(stableJson([state.head.scope, event.eventId, record.entityId, mode]))}`;
        const row: KnowledgeRecord = { knowledgeId, scope: structuredClone(state.head.scope), npcId: record.entityId, eventId: event.eventId, mode, evidenceRefs: structuredClone(evidenceRefs), learnedMoment: structuredClone(event.occurredMoment), nature: mode === 'rumor' || mode === 'inferred' ? 'belief' : 'fact', version: 1 };
        if (!validateCoreDto('knowledge', row).ok) throw Error('CORE2_KNOWLEDGE_INVALID');
        result.set(knowledgeId, row);
      }
    }
  }
  return [...result.values()];
}
