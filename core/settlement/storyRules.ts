import type { FactCandidate } from '../contracts/event';
import type { CoreRulePolicy } from './domainRules';
import type { RuleContext } from './ruleContext';

export function hasCoreStoryCompletionEvidence(text: string): boolean {
  if (/并未|没有|尚未|未曾|还没|仍未|计划|准备|打算|如果|是否|也许|可能|预计|即将|完成后|结束后/u.test(text)) return false;
  return /(?:主线|篇章|章节|剧情|节点)[^。！？\n]{0,48}(?:完成|结束|告一段落)|(?:完成|结束)[^。！？\n]{0,48}(?:主线|篇章|章节|剧情|节点)/u.test(text);
}

export function applyCoreStoryRule(ctx: RuleContext, candidate: FactCandidate, policy: CoreRulePolicy): void {
  const proposal = candidate.proposal; if (proposal.kind !== 'story') throw Error('剧情提议类型无效。');
  const node = policy.storyNodes.find(row => row.seriesId === proposal.seriesId && row.nodeId === proposal.nodeId), story = ctx.get('story');
  if (!node || !node.prerequisites.every(id => story.value.completedNodeIds.includes(id))) throw Error('剧情节点不存在或前置未完成。');
  if (proposal.action === 'complete') {
    if (story.value.seriesId !== node.seriesId || story.value.nodeId !== node.nodeId || story.value.status !== 'progressing') throw Error('只能完成当前正在进行的剧情节点。');
    if (!hasCoreStoryCompletionEvidence(candidate.evidenceRefs.map(ref => ref.quote).join('\n'))) throw Error('缺少当前节点已经完成的明确叙述。');
    story.value.status = 'completed';
    story.value.completedNodeIds = [...new Set([...story.value.completedNodeIds, node.nodeId])];
  } else {
    if (story.value.completedNodeIds.includes(node.nodeId)) throw Error('已完成节点不会因普通叙事再次开启；如需调整请使用剧情编辑。');
    story.value = { ...story.value, seriesId: node.seriesId, chapterId: node.chapterId, nodeId: node.nodeId, status: 'progressing' };
  }
  ctx.put(story); ctx.normalizedFact = { ...proposal, action: proposal.action ?? 'enter', chapterId: node.chapterId };
}
