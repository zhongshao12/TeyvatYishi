import type { 聊天消息, 叙事插图 } from '@/models/chat';

export interface PostTurnNarrativeImageTaskInput {
  enabled: boolean;
  mode: 'auto' | 'manual';
  hasImageConfig: boolean;
  history: 聊天消息[];
  targetMessageId: string;
  generate: () => Promise<叙事插图[] | null>;
  assertActive?: () => void;
}

export interface PostTurnNarrativeImageTaskResult {
  status: 'skipped' | 'failed' | 'no_change' | 'success';
  history: 聊天消息[];
  generatedCount: number;
  detail?: string;
}

export async function runPostTurnNarrativeImageTask(
  input: PostTurnNarrativeImageTaskInput,
): Promise<PostTurnNarrativeImageTaskResult> {
  if (!input.enabled || input.mode !== 'auto') {
    return { status: 'skipped', history: input.history, generatedCount: 0 };
  }
  if (!input.hasImageConfig) {
    return {
      status: 'failed',
      history: input.history,
      generatedCount: 0,
      detail: '正文生图主文生图接口未启用，无法生成故事快照。',
    };
  }
  const images = await input.generate();
  input.assertActive?.();
  if (!images?.length) {
    return { status: 'no_change', history: input.history, generatedCount: 0 };
  }
  const history = input.history.map((message) =>
    message.id === input.targetMessageId && message.role === 'assistant'
      ? { ...message, narrativeImages: [...(message.narrativeImages ?? []), ...images] }
      : message,
  );
  return {
    status: 'success',
    history,
    generatedCount: images.length,
    detail: `生成了 ${images.length} 张正文插图`,
  };
}
