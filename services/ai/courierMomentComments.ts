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
    '只输出评论正文，1～120 字；不要署名、旁白、系统说明或替其他角色发言。',
    '仅可使用你本人知道的共同经历；不得猜测旅行者与其他人的私下互动。',
    input.profile.personality ? `性格：${input.profile.personality}` : '',
    input.profile.speechStyle ? `说话方式：${input.profile.speechStyle}` : '',
    input.profile.playerAddress ? `对旅行者的称呼：${input.profile.playerAddress}` : '',
    input.profile.sharedExperiences?.length ? `共同经历：${input.profile.sharedExperiences.slice(-3).join('；')}` : '',
    input.profile.unfinishedBusiness?.length ? `你与旅行者的约定：${input.profile.unfinishedBusiness.slice(0, 2).join('；')}` : '',
    `旅行者动态：${input.post.content}`,
  ].filter(Boolean).join('\n');
}

export async function generateMomentComment(config: API配置项, input: MomentCommentInput): Promise<string> {
  const raw = await chatCompletion(config, {
    purpose: 'courier',
    messages: [{ role: 'user', content: buildMomentCommentPrompt(input) }],
    systemPrompt: '', maxTokens: 256,
  }, {
    onDelta: () => undefined,
    onDone: () => undefined,
    onError: (error) => { throw error; },
  });
  const escapedName = input.npc.姓名.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const content = raw.trim().replace(new RegExp(`^【?${escapedName}】?[:：]\\s*`, 'u'), '').trim();
  if (!content || content.length > 120 || content.includes('\n')
    || /系统提示|提示词|记忆库|关于.{0,30}对.*印象|可低频投递|已发生事实/u.test(content)) {
    throw new Error('MOMENT_COMMENT_INVALID');
  }
  return content;
}
