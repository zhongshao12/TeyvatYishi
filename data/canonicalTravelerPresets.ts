import type { Talent } from '@/models/teyvat/character';
import { ELEMENT_IDS, type ElementalAttunement, type ElementId } from '@/models/teyvat/elements';

export type CanonicalTravelerChoice = '空' | '荧';

export interface CanonicalTravelerPreset {
  choice: CanonicalTravelerChoice;
  name: CanonicalTravelerChoice;
  gender: '男' | '女';
  appearance: string;
  personality: string;
  background: string;
  primaryElement: ElementId;
  元素共鸣: ElementalAttunement[];
  天赋: Talent[];
}

const CORE_TALENTS: ReadonlyArray<{
  element: ElementId;
  normal: string;
  skill: string;
  burst: string;
  skillDescription: string;
  burstDescription: string;
}> = [
  { element: 'anemo', normal: '异邦铁风', skill: '风涡剑', burst: '风息激荡', skillDescription: '在掌心汇聚真空涡流，持续牵引敌人与物件，结束时击飞目标；可吸收水、火、冰、雷元素。', burstDescription: '唤出持续前进的龙卷风，牵引并持续伤害沿途目标；可发生元素转化。' },
  { element: 'geo', normal: '异邦岩锋', skill: '星陨剑', burst: '岩潮叠嶂', skillDescription: '从大地深处升起荒星，造成岩元素范围伤害；荒星属于岩元素创造物，可阻挡攻击与攀爬。', burstDescription: '引发扩散的震荡波，击退周围敌人并造成岩元素范围伤害，外围形成岩嶂。' },
  { element: 'electro', normal: '异邦惊雷', skill: '雷影剑', burst: '雷轰电转', skillDescription: '斩出三道迅捷雷影，命中后留下可恢复元素能量并提高充能效率的丰穰勾玉。', burstDescription: '唤来雷霆绕身的加护；当前场上角色普攻或重击命中时召唤威光落雷并恢复元素能量。' },
  { element: 'dendro', normal: '异邦草翦', skill: '草缘剑', burst: '偃草若化', skillDescription: '挥动武器散布锋利叶片，在前方造成草元素伤害。', burstDescription: '创造持续攻击领域内敌人的草灯莲；接触水、雷、火元素后会发生不同的莲光幻变。' },
  { element: 'hydro', normal: '异邦激流', skill: '水纹剑', burst: '扬水制流', skillDescription: '释放荡涤大地的激流；长按可瞄准并连续发射露滴，结束时再次喷发激流。', burstDescription: '释放缓慢移动的浮水泡沫，持续对附近敌人造成水元素伤害。' },
  { element: 'pyro', normal: '异邦烈焰', skill: '流火剑', burst: '灼火燎原', skillDescription: '以火元素凝聚炽烈之刃，并借夜魂加持持续造成火元素伤害。', burstDescription: '凝聚烈火之印向前爆发，造成具有夜魂性质的火元素范围伤害。' },
  { element: 'cryo', normal: '异邦寒芒', skill: '冰雾剑', burst: '聚冰成锋', skillDescription: '向前刺击造成冰元素伤害，并凝结跟随前场角色、间歇发射冰晶的栗烈寒星。', burstDescription: '凝聚冰元素投矛掷向敌人，消耗寒辉强化多段冰元素伤害。' },
];

const normalAttackDescription = '进行至多五段的连续剑击；重击消耗体力向前挥出两剑，下落攻击在落地时造成范围伤害。';

export function buildCanonicalElementTalents(element: ElementId): Talent[] {
  return CORE_TALENTS.filter((entry) => entry.element === element).flatMap((entry) => ([
    { id: `traveler_${entry.element}_normal`, 名称: entry.normal, 类别: 'normal_attack' as const, 关联元素: entry.element, 等级: 1, 说明: normalAttackDescription },
    { id: `traveler_${entry.element}_skill`, 名称: entry.skill, 类别: 'elemental_skill' as const, 关联元素: entry.element, 等级: 1, 说明: entry.skillDescription },
    { id: `traveler_${entry.element}_burst`, 名称: entry.burst, 类别: 'elemental_burst' as const, 关联元素: entry.element, 等级: 1, 说明: entry.burstDescription },
  ]));
}

export function buildCanonicalTravelerPreset(choice: CanonicalTravelerChoice): CanonicalTravelerPreset {
  const sibling = choice === '空' ? '妹妹荧' : '哥哥空';
  return {
    choice,
    name: choice,
    gender: choice === '空' ? '男' : '女',
    appearance: choice === '空'
      ? '金色短发与金色眼瞳，身着黑、白、金相间的异国旅行装束，披风与胸前宝石会随共鸣元素改变光色。'
      : '金色长发与金色眼瞳，身着白、蓝、金相间的异国旅行裙装，发间花饰与胸前宝石会随共鸣元素改变光色。',
    personality: '沉稳温和、意志坚定、好奇而善于观察；重视同伴，面对危机时果断可靠，也保留旅行者偶尔直率与幽默的一面。',
    background: `来自世界之外的旅行者，曾与${sibling}穿越诸多世界；在提瓦特遭陌生神明阻拦并失散，此后为寻找血亲与世界真相踏上七国旅程。`,
    primaryElement: 'anemo',
    元素共鸣: ELEMENT_IDS.map((element) => ({
      element,
      source: 'traveler_resonance',
      mastery: 0,
      unlocked: element === 'anemo',
      unlockedAt: element === 'anemo' ? '蒙德七天神像' : '',
      notes: element === 'anemo'
        ? '蒙德开局已与风元素共鸣。'
        : '尚未在对应国家的七天神像处觉醒；觉醒后才会获得该元素天赋。',
    })),
    天赋: buildCanonicalElementTalents('anemo'),
  };
}
