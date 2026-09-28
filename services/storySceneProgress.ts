import type { 剧情编织分段, 剧情编织进度锚点 } from '@/models/storyWeaving';

export function advanceStorySceneProgress(input: {
  segment: 剧情编织分段;
  anchor: 剧情编织进度锚点;
  userInput: string;
  body: string;
  turnCount: number;
}): 剧情编织进度锚点 {
  const { segment, anchor, body, userInput, turnCount } = input;
  if (segment.处理状态 !== '已完成' || segment.运行状态 !== '当前'
    || anchor.当前分段ID !== segment.id || !userInput.trim() || !body.trim()
    || turnCount <= (anchor.最近场景推进回合 ?? 0)) return anchor;

  const scenes = segment.场景节点 ?? [];
  const completed = new Set(anchor.已完成场景ID ?? []);
  const currentIndex = scenes.findIndex((scene) => scene.id === anchor.当前场景ID && !completed.has(scene.id));
  const sceneIndex = currentIndex >= 0 ? currentIndex : scenes.findIndex((scene) => !completed.has(scene.id));
  const scene = scenes[sceneIndex];
  if (!scene?.完成证据.length) return anchor;

  const normalizedBody = body.replace(/\s+/gu, '');
  const hasCompletedResult = scene.完成证据.some((rawEvidence) => {
    const evidence = rawEvidence.replace(/\s+/gu, '');
    if (!evidence) return false;
    const index = normalizedBody.indexOf(evidence);
    if (index < 0) return false;
    const before = normalizedBody.slice(Math.max(0, index - 12), index);
    return !/(?:没有|尚未|未能|并未|无法|不能|不曾|如果|假如|可能|打算|计划|准备|将要|下一步要)$/u.test(before);
  });
  if (!hasCompletedResult) return anchor;

  completed.add(scene.id);
  return {
    ...anchor,
    当前场景ID: scenes.find((item, index) => index > sceneIndex && !completed.has(item.id))?.id,
    已完成场景ID: scenes.filter((item) => completed.has(item.id)).map((item) => item.id),
    最近场景推进回合: turnCount,
    updatedAt: Date.now(),
  };
}
