import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkillPanel } from '@/components/features/GameSystems/SkillPanel';
import { PathPanel } from '@/components/features/GameSystems/PathPanel';
import { SteambirdPanel } from '@/components/features/GameSystems/SteambirdPanel';
import { IrminsulPanel } from '@/components/features/GameSystems/IrminsulPanel';
import { MapPanel } from '@/components/features/GameSystems/MapPanel';
import { createEmptyTeyvatMapState, unlockStatue } from '@/models/teyvat/map';
import type { 角色数据结构 } from '@/models/character';
import { 创建空角色 } from '@/models/character';
import { useState } from 'react';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';

// S3-S6 面板视觉回归：天赋手账 / 元素共鸣 / 蒸汽鸟报 / 世界树。
const meta: Meta = { title: '冒险者手账/系统面板', parameters: { layout: 'fullscreen' } };
export default meta;

const noop = () => undefined;

const traveler: 角色数据结构 = {
  ...创建空角色(),
  姓名: '荧',
  主元素: 'anemo',
  元素共鸣: [
    { element: 'anemo', source: 'traveler_resonance', mastery: 72, unlocked: true, unlockedAt: '旅行历 1000.03.07', notes: '初见风魔龙时与风元素建立的共鸣。' },
    { element: 'geo', source: 'traveler_resonance', mastery: 45, unlocked: true, unlockedAt: '旅行历 1000.05.12', notes: '在璃月岩神像前获得的岩之共鸣。' },
    { element: 'pyro', source: 'vision', mastery: 0, unlocked: false, unlockedAt: '', notes: '' },
  ],
  天赋: [
    { id: 't1', 名称: '异邦风涡', 类别: 'elemental_skill', 关联元素: 'anemo', 等级: 6, 说明: '以掌心聚起风流，把敌人向外推开，卷起尘屑遮蔽视线。' },
    { id: 't2', 名称: '星落斩', 类别: 'normal_attack', 关联元素: '', 等级: 3, 说明: '挥出干净的五段剑击，收势时带回一记挑斩。' },
    { id: 't3', 名称: '风壁', 类别: 'passive', 关联元素: 'anemo', 等级: 1, 说明: '队伍在强风环境中受到的干扰降低。' },
  ],
};

const talentListStory: StoryObj = {
  render: () => <SkillPanelStory />,
};
function SkillPanelStory() {
  const [current, setCurrent] = useState(traveler);
  return (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))', padding: 16 }}>
      <SkillPanel traveler={current} onTravelerChange={setCurrent} apiSettings={undefined} />
    </div>
  );
}

const pathStory: StoryObj = {
  render: () => (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))', padding: 16 }}>
      <PathPanel traveler={traveler} onTravelerChange={noop} />
    </div>
  ),
};

const steambirdNews: SteambirdNews = {
  articles: [
    { id: 'a1', section: 'local', status: 'published', title: '风魔龙阴影渐散，西风骑士团加强城郊巡逻', body: '近日风龙废墟方向的异常气流已经平息，西风骑士团宣布将增加城郊巡逻频次。\n有酒馆侍者称，深夜偶尔仍能听见巨龙掠过长空的低鸣。', turn: 4, timestamp: Date.now() - 3600_000, important: true, organizationTags: ['西风骑士团'], relatedSystems: ['主剧情'], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'a2', section: 'world', status: 'published', title: '请仙典仪筹备进入最后阶段', body: '七星宣布今年请仙典仪的流程将有"微小调整"，商会普遍关注新税率。', turn: 3, timestamp: Date.now() - 7200_000, important: false, organizationTags: ['璃月七星'], relatedSystems: [], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'a3', section: 'investigation', status: 'published', title: '冒险家协会发布新一批委托', body: '凯瑟琳提醒旅行者：深渊法师的活动痕迹有所增加，结伴出行更安全。', turn: 2, timestamp: Date.now() - 86400_000, important: false, organizationTags: ['冒险家协会'], relatedSystems: ['任务'], narrativeSeriesId: '', narrativeSegmentId: '', createdAt: Date.now(), updatedAt: Date.now() },
  ],
};

const steambirdStory: StoryObj = {
  render: () => (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
      <SteambirdPanel steambird={steambirdNews} turnCount={4} />
    </div>
  ),
};

const irminsulMemory: IrminsulMemory = {
  entries: [
    { id: 'e1', title: '风魔龙之影·初次相遇', summary: '旅行者与派蒙在风起地遭遇受蚀的风魔龙，被迫撤离。', sourceTurns: [1, 2], keywords: ['风魔龙', '风起地'], recordedAt: '旅行历 1000.03.08', archiveType: 'medium', sourceText: '【旁白】紫电划过天幕，巨龙的影子罩住了整片草原。', turn: 2 },
    { id: 'e2', title: '安柏的委托', summary: '安柏委托旅行者调查低语森林的异常足迹。', sourceTurns: [3], keywords: ['安柏', '委托'], recordedAt: '旅行历 1000.03.09', archiveType: 'short', sourceText: '', turn: 3 },
  ],
};

const irminsulStory: StoryObj = {
  render: () => (
    <div style={{ height: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
      <IrminsulPanel memory={irminsulMemory} />
    </div>
  ),
};

export { talentListStory as 天赋手账, pathStory as 元素共鸣, steambirdStory as 蒸汽鸟报, irminsulStory as 世界树 };

const mapStory: StoryObj = {
  render: () => {
    let map = unlockStatue(createEmptyTeyvatMapState(), 'mondstadt');
    map = unlockStatue(map, 'liyue');
    return (
      <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
        <MapPanel map={map} currentRegion="mondstadt" turnCount={4} onUnlockStatue={noop} onTeleport={noop} />
      </div>
    );
  },
};
export { mapStory as 七国地图 };
