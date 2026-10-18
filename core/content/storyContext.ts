import type { CoreTurnDependencies } from '../settlement/turnRunner';
import type { createCoreStoryResources } from './storyCatalog';

export type CoreStoryResources = ReturnType<typeof createCoreStoryResources>;
type StoryTurnPorts = Omit<CoreTurnDependencies, 'repo' | 'getActiveSession' | 'onSource'> & { factModel: NonNullable<CoreTurnDependencies['factModel']> };

/** Each main/retry owns its own policy. Loading a resource never writes game state. */
export function attachCoreStoryResources(ports: StoryTurnPorts, resources: CoreStoryResources): StoryTurnPorts {
  const rulePolicy: import('../settlement/domainRules').CoreRulePolicy = { ...ports.rulePolicy, storyNodes: resources.getNodes() };
  return { ...ports, rulePolicy,
    async preparePolicy(input) {
      await ports.preparePolicy?.(input);
      const changesStory = input.playerActions?.some(action => action.command.type === 'story_edit' || action.command.type === 'story_content'
        || action.command.type === 'review_fact' && [action.command.candidate, ...action.command.groupCandidates ?? []].some(candidate => candidate.kind === 'story')
        || action.command.type === 'correct_event' && action.command.command.type === 'story_edit');
      if (input.kind !== 'main' && !changesStory) return;
      const prepared = await resources.prepare(input.snapshot, input.signal); rulePolicy.storyNodes = prepared.catalog; rulePolicy.storyContent = prepared.baselineCatalog;
    },
    async assembleContext(input) {
      const prepared = await resources.prepare(input.snapshot, input.signal); rulePolicy.storyNodes = prepared.catalog;
      const context = await ports.assembleContext(input);
      return { ...context, systemPrompt: `${context.systemPrompt}\n\n${prepared.prompt}` };
    },
    async factModel(input) {
      // A variable-only retry can skip narrative generation entirely. It still
      // resolves the exact registered resources before extracting or settling.
      const prepared = await resources.prepare(input.snapshot, input.signal); rulePolicy.storyNodes = prepared.catalog;
      return ports.factModel({ ...input, storyCatalog: prepared.nodes });
    },
  };
}
