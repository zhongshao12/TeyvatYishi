import {
  applyElementToField,
  detectAppliedElements,
  detectTravelerAppliedElements,
  MAX_ELEMENT_EVENTS,
  type ElementalFieldState,
  type ElementalReactionEvent,
} from '@/models/teyvat/elementalGauge';
import {
  applyTravelerSkillMastery,
  type ElementalTravelerState,
} from '@/services/elementalAttunementService';
import type { ElementId } from '@/models/teyvat/elements';

const DEFAULT_MASTERY_GAIN_PER_TURN = 2;

export interface PostTurnElementalStageInput<TTraveler extends ElementalTravelerState> {
  body: string;
  traveler: TTraveler;
  travelerNames: readonly string[];
  field: ElementalFieldState;
  events: readonly ElementalReactionEvent[];
  turn: number;
  masteryGainPerTurn?: number;
}

export interface PostTurnElementalStageResult<TTraveler extends ElementalTravelerState> {
  traveler: TTraveler;
  masteryGains: ElementId[];
  masteryGainPerTurn: number;
  field: ElementalFieldState;
  events: ElementalReactionEvent[];
  fieldChanged: boolean;
}

/**
 * 结算正文中出现的元素应用与旅行者熟练度。
 *
 * 多个元素必须依次作用于前一个元素留下的场面，而不是每次都从回合开始时的
 * 场面重新计算，否则同回合反应会被后一次更新覆盖。
 */
export function settlePostTurnElements<TTraveler extends ElementalTravelerState>(
  input: PostTurnElementalStageInput<TTraveler>,
): PostTurnElementalStageResult<TTraveler> {
  const masteryGainPerTurn = input.masteryGainPerTurn ?? DEFAULT_MASTERY_GAIN_PER_TURN;
  const travelerElements = detectTravelerAppliedElements(input.body, input.travelerNames);
  const mastery = applyTravelerSkillMastery(input.traveler, travelerElements, masteryGainPerTurn);

  let field = input.field;
  let events = [...input.events];
  let fieldChanged = false;

  for (const element of detectAppliedElements(input.body)) {
    const outcome = applyElementToField(field, element, input.turn);
    if (outcome.field !== field) {
      field = outcome.field;
      fieldChanged = true;
    }
    if (outcome.events.length > 0) {
      events = [...events, ...outcome.events].slice(-MAX_ELEMENT_EVENTS);
    }
  }

  return {
    traveler: mastery.traveler,
    masteryGains: mastery.gains,
    masteryGainPerTurn,
    field,
    events,
    fieldChanged,
  };
}
