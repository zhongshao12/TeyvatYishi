import { 解析天气标签, 验证天气合法性 } from '@/data/weatherRules';
import type { 角色数据结构 } from '@/models/character';
import type { FactCandidate } from '@/models/teyvat/narrativeTurn';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { 归一化世界状态, type 世界状态 } from '@/models/world';
import {
  applyElementalEchoResult,
  canInviteElementalEcho,
  ELEMENTAL_ECHO_MASTERY_GAIN,
} from '@/services/elementalAttunementService';
import { appendWorldEvents } from '@/utils/worldEvents';

export interface NarrativeWorldStageInput {
  world: 世界状态;
  traveler: 角色数据结构;
  factCandidates: FactCandidate[];
  rawResponseText: string;
}

export interface NarrativeWorldStageResult {
  world: 世界状态;
  traveler: 角色数据结构;
  worldFacts: string[];
}

/** 将正文已经确认的世界事实、元素回响与天气一次性结算到本地快照。 */
export function applyNarrativeWorldStage(input: NarrativeWorldStageInput): NarrativeWorldStageResult {
  let world = 归一化世界状态(input.world);
  let traveler = input.traveler;
  const worldFactCandidates = input.factCandidates
    .filter((candidate) => candidate.domain === 'world' || candidate.domain === 'location' || candidate.domain === 'time')
    .map((candidate) => candidate.fact);
  if (worldFactCandidates.length) {
    world = {
      ...world,
      全局事件: appendWorldEvents(world.全局事件, worldFactCandidates),
    };
  }

  const systemFacts = input.factCandidates
    .filter((candidate) => candidate.domain === 'system')
    .map((candidate) => candidate.fact);
  const inviteFact = systemFacts.find((fact) => /^elemental_echo_invite:/i.test(fact));
  if (inviteFact && !world.元素回响邀请 && !world.进行中元素回响) {
    const invitedRaw = inviteFact.split(':').slice(1).join(':').trim().toLowerCase();
    const invitedId = ELEMENT_IDS.includes(invitedRaw as ElementId) ? invitedRaw as ElementId : null;
    if (invitedId) {
      const target = traveler.元素共鸣.find((item) => item.element === invitedId);
      if (target && canInviteElementalEcho(target)) {
        world = { ...world, 元素回响邀请: invitedId };
      } else {
        console.warn('[sendWorkflow] 元素回响邀请被忽略：目标元素未达到回响资格。', invitedId);
      }
    } else {
      console.warn('[sendWorkflow] 无法解析元素回响邀请。', inviteFact);
    }
  }

  const judgementFact = systemFacts.find((fact) => /^elemental_echo_result:/i.test(fact));
  if (judgementFact && world.进行中元素回响) {
    const elementId = world.进行中元素回响;
    const judgementRaw = judgementFact.split(':').slice(1).join(':').trim();
    const accepted = judgementRaw.includes('共鸣深化')
      || judgementRaw.includes('升阶')
      || judgementRaw.includes('突破')
      || judgementRaw.includes('确认')
      || /resonance|advance|awaken/i.test(judgementRaw);
    if (accepted) {
      try {
        const result = applyElementalEchoResult(
          traveler,
          { ...world, 元素回响邀请: world.元素回响邀请 ?? '', 进行中元素回响: elementId },
          elementId,
          ELEMENTAL_ECHO_MASTERY_GAIN,
        );
        traveler = result.traveler;
        world = {
          ...result.world,
          元素回响邀请: result.world.元素回响邀请
            ? result.world.元素回响邀请 as ElementId
            : undefined,
          进行中元素回响: undefined,
        };
      } catch (error) {
        console.warn('[sendWorkflow] 应用元素回响结果失败。', error);
        world = { ...world, 进行中元素回响: undefined };
      }
    } else {
      console.warn('[sendWorkflow] 无法识别元素回响结果。', judgementRaw);
    }
  }

  const weather = 解析天气标签(input.rawResponseText);
  if (weather) {
    if (!验证天气合法性(weather, world.当前地点)) {
      console.info('[天气] 天气与当前地点白名单不匹配，仍接受（地点可能在本回合由变量模型更新）:', weather, '| 旧地点:', world.当前地点);
    }
    world = { ...world, 当前天气: weather };
  }

  return { world, traveler, worldFacts: worldFactCandidates };
}
