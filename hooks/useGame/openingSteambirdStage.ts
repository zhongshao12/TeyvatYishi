import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { 世界状态 } from '@/models/world';
import { runSteambirdGenerationStep, type SteambirdGenerationStepResult } from './steambirdWorkflow';

function formatOriginalProtagonist(originalProtagonist: 世界状态['原著主角']): string {
  if (originalProtagonist === '荧') return '原作主角荧';
  if (originalProtagonist === '空') return '原作主角空';
  if (originalProtagonist === '空荧双主角') return '原作主角空与荧';
  if (originalProtagonist === '无主角') return '无固定原著主角（玩家以自定义身份独行）';
  return '所选原著主角';
}

export function buildOpeningSteambirdPreprocess(params: {
  current: SteambirdNews;
  world: 世界状态;
  turnCount: number;
  now?: number;
}): SteambirdGenerationStepResult | null {
  const openingArchive = params.world.开局档案;
  const regionName = openingArchive?.地区名称 ?? params.world.当前地点 ?? '未知地区';
  const chapterName = openingArchive?.章节锚点名称 ?? params.world.起航之地ID ?? '未命名章节';
  const openingPressure = openingArchive?.整理档案?.特别要求?.length
    ? openingArchive.整理档案.特别要求.join('；')
    : openingArchive?.章节参考说明 || params.world.当前地点 || '当前开局地区';
  const body = [
    `开局初始化：当前开局为${regionName}「${chapterName}」。`,
    `章节参考：${openingArchive?.章节参考说明 ?? '按当前开局档案和世界状态生成首回合世界事件苗头。'}`,
    `开局压力：${openingPressure}`,
    openingArchive?.玩家介入原文 ? `玩家介入：${openingArchive.玩家介入原文}` : '',
    `原著主角配置：${formatOriginalProtagonist(params.world.原著主角)}`,
  ].filter(Boolean).join('\n');

  return runSteambirdGenerationStep({
    current: params.current,
    publicFacts: [{ title: `${regionName}开局见闻`, detail: body }],
    turnCount: params.turnCount + 1,
    now: params.now,
  });
}
