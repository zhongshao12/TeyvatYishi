import type { RuleContext } from './ruleContext';
import type { BasicPlayerCommand } from './actions';
import type { CoreRulePolicy } from './domainRules';
import { STORY_CONTENT_FIELDS, storyFieldFingerprint, validStoryFieldValue } from '../content/storyEdits';

export function applyStoryContentAction(ctx: RuleContext, command: Extract<BasicPlayerCommand, { type: 'story_content' }>, policy: CoreRulePolicy): void {
  const story = ctx.get('story'), node = policy.storyContent?.find(row => row.seriesId === command.seriesId && row.nodeId === command.nodeId);
  if (story.version !== command.expectedVersion || !node || !STORY_CONTENT_FIELDS.includes(command.field)
    || command.baseFingerprint !== storyFieldFingerprint(node[command.field] ?? '')) throw Error('剧情资料或编辑版本已改变，请重新打开资料后保存。');
  const edits = (story.value.resourceEdits ?? []).filter(row => row.seriesId !== command.seriesId || row.nodeId !== command.nodeId || row.field !== command.field);
  if (command.action === 'set') {
    if (!validStoryFieldValue(command.field, command.value)) throw Error('剧情字段内容无效或过长。');
    edits.push({ seriesId: command.seriesId, nodeId: command.nodeId, field: command.field, baseFingerprint: command.baseFingerprint, value: structuredClone(command.value) });
  } else if (command.action !== 'reset' || command.value !== undefined) throw Error('未注册的剧情资料操作。');
  story.value.resourceEdits = edits; ctx.put(story);
}
