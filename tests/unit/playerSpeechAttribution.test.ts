import { describe, expect, it } from 'vitest';
import { parseBodyLines } from '@/components/features/Chat/MessageRenderers';
import { normalizePlayerSpeechInBody, shouldRenderAsNarrationForPlayerLine } from '@/utils/playerSpeechGuard';
import { 创建空角色 } from '@/models/character';
import type { 角色数据结构 } from '@/models/character';

/**
 * 「明显不是玩家的语言出现在了回复的玩家的话语中」（2026-10-03 用户实测反馈）。
 *
 * 现场：MoM 系预设把 NPC 台词写成正文里的整句引号（没有 【speaker】 标签），
 * 渲染层的兜底规则把**任何**没有标签的整句引号都当成玩家台词，于是砂糖的
 * 「唔……哈啊……！云……」被套进了玩家名牌 + ✦ 标记 + 立绘槽位的对话框里。
 * 契约：玩家只能复述自己本回合输入过的原话；没有证据的引号句按旁白渲染。
 */

const 旅行者: 角色数据结构 = {
  ...创建空角色(),
  姓名: '宇智波云',
  别名: '云',
};

describe('A 渲染层：没有玩家证据的引号句不再冒充玩家台词', () => {
  it('NPC 的呻吟（无标签引号句）渲染为旁白，而不是玩家气泡', () => {
    const lines = parseBodyLines('“唔……哈啊……！云……”', 旅行者, '我推开门走进去');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ kind: 'narration', text: '“唔……哈啊……！云……”' });
  });

  it('玩家确实输入过这句话时，仍然显示为玩家气泡', () => {
    const input = '我说：“唔……哈啊……！云……”';
    const lines = parseBodyLines('“唔……哈啊……！云……”', 旅行者, input);
    expect(lines[0]).toEqual({ kind: 'dialogue', name: '宇智波云', text: '唔……哈啊……！云……' });
  });

  it('带发言者标签的 NPC 台词照常进 NPC 对话框，不受玩家证据影响', () => {
    const lines = parseBodyLines('【砂糖】“云，你终于来了。”', 旅行者, '我推开门走进去');
    expect(lines[0]).toEqual({ kind: 'dialogue', name: '砂糖', text: '“云，你终于来了。”' });
  });

  it('玩家名字被写进标签但没有输入证据时，降级为旁白（不夺舍 NPC、也不冒充玩家）', () => {
    const lines = parseBodyLines('【宇智波云】“你怎么了？”', 旅行者, '我坐下等她开口');
    expect(lines[0]).toEqual({ kind: 'narration', text: '“你怎么了？”' });
  });

  it('玩家输入里出现过的短句仍归属玩家', () => {
    const lines = parseBodyLines('【宇智波云】“你先休息。”', 旅行者, '我说：“你先休息。”');
    expect(lines[0]).toEqual({ kind: 'dialogue', name: '宇智波云', text: '“你先休息。”' });
  });

  it('旁白标签下的整句引号同样先看玩家证据', () => {
    const withoutEvidence = parseBodyLines('【旁白】“别怕，我在。”', 旅行者, '我推开门走进去');
    // 旁白分支的兜底保留原引号（既有行为），关键是**没有**被提升为玩家气泡
    expect(withoutEvidence[0]).toEqual({ kind: 'narration', text: '“别怕，我在。”' });
    const withEvidence = parseBodyLines('【旁白】“别怕，我在。”', 旅行者, '我说：“别怕，我在。”');
    expect(withEvidence[0]).toEqual({ kind: 'dialogue', name: '宇智波云', text: '别怕，我在。' });
  });
});

describe('A2 叫玩家名字的无标签引号句归给邻近 NPC（而不是玩家，也不是干巴巴的旁白）', () => {
  it('紧跟在 NPC 台词之后的呻吟归给该 NPC', () => {
    const lines = parseBodyLines('【砂糖】“你来了……”\n“唔……哈啊……！云……”', 旅行者, '我推开门走进去');
    expect(lines[1]).toEqual({ kind: 'dialogue', name: '砂糖', text: '唔……哈啊……！云……' });
  });

  it('NPC 台词在后时同样能归位（向后就近取说话人）', () => {
    const lines = parseBodyLines('“唔……哈啊……！云……”\n【砂糖】“别、别看人家……”', 旅行者, '我推开门走进去');
    expect(lines[0]).toEqual({ kind: 'dialogue', name: '砂糖', text: '唔……哈啊……！云……' });
  });

  it('附近没有任何 NPC 发言者时退回旁白（不冒充玩家）', () => {
    const lines = parseBodyLines('“唔……哈啊……！云……”', 旅行者, '我推开门走进去');
    expect(lines[0]).toEqual({ kind: 'narration', text: '“唔……哈啊……！云……”' });
  });

  it('没有叫玩家名字的引号句绝不归给 NPC（防止把玩家的话塞进 NPC 嘴里）', () => {
    const lines = parseBodyLines('【砂糖】“你来了……”\n“我这就来。”', 旅行者, '我推开门走进去');
    expect(lines[1]).toEqual({ kind: 'narration', text: '“我这就来。”' });
  });

  it('单字别名只在独立成词时才算叫玩家（「云彩」不算）', () => {
    const lines = parseBodyLines('【砂糖】“今天云彩很好看。”\n“云彩？嗯。”', 旅行者, '我看向窗外');
    expect(lines[1]).toEqual({ kind: 'narration', text: '“云彩？嗯。”' });
  });

  it('标签错写成玩家、句子却在叫玩家名字时，改挂邻近 NPC', () => {
    const lines = parseBodyLines('【砂糖】“你来了……”\n【宇智波云】“唔……哈啊……！云……”', 旅行者, '我推开门走进去');
    expect(lines[1]).toEqual({ kind: 'dialogue', name: '砂糖', text: '唔……哈啊……！云……' });
  });

  it('标签错写成玩家但没有叫玩家名字时，只降级为旁白（不塞进 NPC 嘴里）', () => {
    const lines = parseBodyLines('【砂糖】“你来了……”\n【宇智波云】“我这就来。”', 旅行者, '我推开门走进去');
    expect(lines[1]).toEqual({ kind: 'narration', text: '“我这就来。”' });
  });
});

describe('B 落库清洗：无归属引号句标记为旁白', () => {
  it('没有玩家证据的整句引号被标成旁白，保留原文', () => {
    expect(normalizePlayerSpeechInBody({
      body: '“唔……哈啊……！云……”',
      playerName: '宇智波云',
      userInput: '我推开门走进去',
    })).toBe('【旁白】“唔……哈啊……！云……”');
  });

  it('有玩家证据的整句引号原样保留（渲染层会提升为玩家气泡）', () => {
    const body = '“唔……哈啊……！云……”';
    expect(normalizePlayerSpeechInBody({
      body,
      playerName: '宇智波云',
      userInput: '我说：“唔……哈啊……！云……”',
    })).toBe(body);
  });

  it('既有契约不回归：带标签的玩家拟声词仍降级为旁白', () => {
    expect(normalizePlayerSpeechInBody({
      body: '【宇智波云】轰隆——！！！',
      playerName: '宇智波云',
      userInput: '我看向前方',
    })).toBe('【旁白】轰隆——！！！');
  });

  it('既有契约不回归：带标签且有证据的玩家台词保留气泡', () => {
    const body = '【宇智波云】你先休息。';
    expect(normalizePlayerSpeechInBody({
      body,
      playerName: '宇智波云',
      userInput: '我说：“你先休息。”',
    })).toBe(body);
  });

  it('守卫判据同源：无证据的呻吟必须判为旁白', () => {
    expect(shouldRenderAsNarrationForPlayerLine('唔……哈啊……！云……', '我推开门走进去')).toBe(true);
  });
});
