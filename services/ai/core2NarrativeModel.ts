import type { CoreTurnDependencies } from '@/core/settlement/turnRunner';
import { core2TextCompletion as chatCompletionNonStream } from './core2TextCompletion';
import { runValidatedMainNarrativeRequest } from '@/hooks/useGame/mainNarrativeRequestStage';
import { resolveMainNarrativeMaxAttempts } from './mainNarrativeRetryPolicy';
import { parseNarrativeTurn } from './narrativeTurnParser';
import { isNonRetryableAIError } from './deepSeekRecovery';
import { resolveNarrativeMaxTokens } from '@/utils/presetPresentation';
import { coreEntityNamePattern } from '@/core/settlement/entityResolution';

export function createCore2NarrativeModel(complete = chatCompletionNonStream): CoreTurnDependencies['generateNarrative'] {
  return async ({ context, config: inputConfig, signal, snapshot: inputSnapshot }) => {
    if (!inputConfig?.baseUrl.trim() || !inputConfig.model.trim()) throw Error('CORE2_MAIN_MODEL_UNCONFIGURED');
    const config = structuredClone(inputConfig), snapshot = structuredClone(inputSnapshot), owned = structuredClone(context);
    const messages = owned.messages;
    const party = snapshot.records.filter(record => record.domain === 'npc' && owned.validation?.partyNpcIds.includes(record.entityId));
    const result = await runValidatedMainNarrativeRequest({
      maxAttempts: resolveMainNarrativeMaxAttempts({ autoRetryOnError: (config.retryCount ?? 0) > 0, autoRetryCount: config.retryCount ?? 0, requiresValidationRepair: !!party.length || !!owned.validation?.wordCountTarget }),
      signal, wordCountTarget: owned.validation?.wordCountTarget,
      getMissingPartyMembers: text => party.flatMap(record => record.domain === 'npc' && !new RegExp(coreEntityNamePattern(record, snapshot), 'iu').test(text) ? [record.value.姓名] : []),
      appendRetryInstruction: content => { messages.push({ role: 'user', content }); },
      isNonRetryableError: isNonRetryableAIError,
      request: async () => {
        const fullText = await complete(config, { systemPrompt: owned.systemPrompt, messages: [...messages], purpose: 'main', signal,
          maxTokens: resolveNarrativeMaxTokens(config.maxTokens, owned.validation?.wordCountTarget), temperature: config.temperature, topP: config.topP, topK: config.topK, topA: config.topA, minP: config.minP,
          repetitionPenalty: config.repetitionPenalty, frequencyPenalty: config.frequencyPenalty, presencePenalty: config.presencePenalty, maxContext: config.maxContext,
        });
        return { fullText, parsed: parseNarrativeTurn(fullText) };
      },
    });
    return result.result.fullText;
  };
}
export const generateCore2Narrative = createCore2NarrativeModel();
