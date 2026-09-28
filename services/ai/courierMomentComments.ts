import type { NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import type { CourierMoment } from '@/models/teyvat/courier';
import { chatCompletion } from './chatCompletionClient';
import type { CourierSenderProfile } from './courierService';

export interface MomentCommentInput {
  post: CourierMoment;
  npc: NPC记录;
  profile: CourierSenderProfile;
}

export function buildMomentCommentPrompt(input: MomentCommentInput): string {
  return [
    `你是${input.npc.姓名}。旅行者刚发布一条朋友圈，请只写你本人会留下的一条短评论。`,
    '只输出一句完整的评论正文，1～120 字，以自然的句末标点或表情结束；不要署名、旁白、系统说明或替其他角色发言。',
    '仅可使用你本人知道的共同经历；不得猜测旅行者与其他人的私下互动。',
    input.profile.personality ? `性格：${input.profile.personality}` : '',
    input.profile.speechStyle ? `说话方式：${input.profile.speechStyle}` : '',
    input.profile.playerAddress ? `对旅行者的称呼：${input.profile.playerAddress}` : '',
    input.profile.sharedExperiences?.length ? `共同经历：${input.profile.sharedExperiences.slice(-3).join('；')}` : '',
    input.profile.unfinishedBusiness?.length ? `你与旅行者的约定：${input.profile.unfinishedBusiness.slice(0, 2).join('；')}` : '',
    `旅行者动态：${input.post.content}`,
  ].filter(Boolean).join('\n');
}

export function validateMomentComment(raw: string, npcName: string): string {
  const escapedName = npcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const content = raw.trim().replace(new RegExp(`^【?${escapedName}】?[:：]\\s*`, 'u'), '').trim();
  if (!content || content.length > 120 || content.includes('\n')
    || /系统提示|提示词|记忆库|关于.{0,30}对.*印象|可低频投递|已发生事实/u.test(content)
    || !/(?:[。！？!?.…~～♪☆★]|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)$/u.test(content)) {
    throw new Error('MOMENT_COMMENT_INVALID');
  }
  return content;
}

export async function generateMomentComment(config: API配置项, input: MomentCommentInput): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await chatCompletion(config, {
      purpose: 'courier',
      messages: [{ role: 'user', content: buildMomentCommentPrompt(input) }],
      systemPrompt: '', maxTokens: Math.min(384, config.maxTokens ?? 384),
    }, {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: (error) => { throw error; },
    });
    try {
      return validateMomentComment(raw, input.npc.姓名);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'MOMENT_COMMENT_INVALID' || attempt === 1) throw error;
    }
  }
  throw new Error('MOMENT_COMMENT_INVALID');
}
