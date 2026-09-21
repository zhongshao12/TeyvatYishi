import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import type { ChatCompletionRequest } from '@/services/ai/chatCompletionClient';

const chatCompletionNonStream = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream }));

// 重试层单独有测试，这里只验证「调用次数 + 参数传递」的接线。
vi.mock('@/services/ai/retry', () => ({
  withRetries: async <T>(task: () => Promise<T>) => task(),
}));

import {
  parseOpeningArchiveWithAI,
  type OpeningArchiveParseInput,
} from '@/services/ai/openingArchive';

/**
 * 契约来源：services/ai/openingArchive.ts
 * 生产调用点：services/ai/openingArchive.ts:87 导出；服务从 services/storyWeaving.ts 侧被消费。
 * 关键行为：模型返回的 JSON 经 parseJsonWithRepair + normalizeOpeningArchive 归一化；
 * 字段缺失/类型非法时必须有安全降级（这才是开局档案不会静默丢失的核心）。
 */
const config = {
  id: 'cfg',
  name: '测试配置',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
} as API配置项;

const baseInput: OpeningArchiveParseInput = {
  regionName: '蒙德',
  chapterName: '序章',
  chapterSummary: '旅行者与派蒙初到蒙德。',
  playerText: '我是流浪剑客，想要寻找失散的妹妹。',
};

const requestOf = (index = 0): ChatCompletionRequest =>
  (chatCompletionNonStream.mock.calls[index]?.[1] ?? {}) as ChatCompletionRequest;

const userPromptOf = (index = 0): string => String(requestOf(index).messages?.[0]?.content ?? '');

describe('openingArchive: parseOpeningArchiveWithAI', () => {
  beforeEach(() => {
    chatCompletionNonStream.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requests a non-streaming chat completion with the opening-archive system prompt and bounded tokens', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(chatCompletionNonStream).toHaveBeenCalledTimes(1);
    const request = requestOf();
    expect(request.systemPrompt).toContain('开局整理模型');
    expect(request.systemPrompt).toContain('只输出合法 JSON');
    expect(request.maxTokens).toBe(1200);
    expect(request.temperature).toBe(0.35);
  });

  it('embeds every provided context hint into the user prompt', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    await parseOpeningArchiveWithAI(config, {
      ...baseInput,
      sourceLabel: '创意工坊',
      defaultLocationHint: '蒙德城',
      defaultDateHint: '旅行历 1.01.01',
      defaultTimeHint: '黄昏',
      mainlineEnabled: false,
      locationSource: 'custom',
      keyNpcs: ['琴', '丽莎'],
      priorStoryState: '前置剧情已跳过',
    }, 0);

    const prompt = userPromptOf();
    expect(prompt).toContain('来源：创意工坊');
    expect(prompt).toContain('地区：蒙德');
    expect(prompt).toContain('章节锚点：序章');
    expect(prompt).toContain('前置剧情处理：前置剧情已跳过');
    expect(prompt).toContain('主线坐标：关闭，原作主线需在剧情编织中手动启用');
    expect(prompt).toContain('地点来源：自创地点');
    expect(prompt).toContain('初始地点参考：蒙德城');
    expect(prompt).toContain('初始时间参考：旅行历 1.01.01 · 黄昏');
    expect(prompt).toContain('已知关键角色：琴、丽莎');
    expect(prompt).toContain('# 玩家介入原文');
    expect(prompt).toContain('我是流浪剑客');
  });

  it('omits optional hint lines and marks an empty player text instead of leaving a blank block', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    await parseOpeningArchiveWithAI(config, {
      regionName: '蒙德',
      chapterName: '序章',
      chapterSummary: '背景',
      playerText: '   ',
    }, 0);

    const prompt = userPromptOf();
    expect(prompt).not.toContain('前置剧情处理：');
    expect(prompt).not.toContain('初始地点参考：');
    expect(prompt).not.toContain('已知关键角色：');
    expect(prompt).toContain('（空）');
    expect(prompt).toContain('地点来源：已有地点');
  });

  it('normalises a fenced model reply into a complete archive with fallbacks for every missing field', async () => {
    chatCompletionNonStream.mockResolvedValue('```json\n{"当前目标":"找到妹妹"}\n```');

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.起始情境).toBe('玩家自由介入蒙德「序章」背景：我是流浪剑客，想要寻找失散的妹妹。');
    expect(archive.初始地点参考).toBe('蒙德');
    expect(archive.主线参与程度).toBe('启用主线坐标，原作主线进度仅作背景参考。');
    expect(archive.叙事倾向).toEqual(['自由介入', '背景参考优先']);
    expect(archive.特别要求).toEqual([baseInput.playerText]);
    expect(archive.冲突协调).toHaveLength(2);
    expect(archive.已认识角色).toEqual([]);
    expect(archive.自制NPC).toEqual([]);
    expect(archive.世界设定补充).toEqual([]);
    expect(archive.初始时间参考).toBeUndefined();
    expect(archive.初始日期参考).toBeUndefined();
  });

  it('degrades to the fallback archive when the model returns text without parseable JSON', async () => {
    chatCompletionNonStream.mockResolvedValue('模型今天不想说话');

    // 迁移: 旧断言 `rejects.toThrow(SyntaxError)`（现状记录）-> 现在应当降级为兜底档案。
    // 理由: parseOpeningArchiveJson 补了 try/catch（第二轮审计 β 的发现），
    //       structuredOutputRepair.parseJsonWithRepair 抛错不再让整个开局整理失败。
    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive).toBeTruthy();
    expect(archive.已认识角色).toEqual(expect.any(Array));
  });

  it('keeps every model-provided field instead of falling back', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({
      玩家身份: '模型给出的身份',
      当前目标: '模型给出的目标',
      初始地点参考: '模型给出的地点',
      自定义起始地点: '晨风酒馆门口',
      原创组织说明: '模型给出的组织',
    }));

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.玩家身份).toBe('模型给出的身份');
    expect(archive.当前目标).toBe('模型给出的目标');
    expect(archive.初始地点参考).toBe('模型给出的地点');
    expect(archive.自定义起始地点).toBe('晨风酒馆门口');
    expect(archive.原创组织说明).toBe('模型给出的组织');
  });

  it('maps legacy 自定义星球 / 星球简介 keys into the current fields', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({
      自定义星球: '旧版星球名',
      星球简介: '旧版简介',
    }));

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.自定义地点).toBe('旧版星球名');
    expect(archive.地点简介).toBe('旧版简介');
  });

  it('keeps only usable self-made NPCs and rejects groups, over-long names and bad elements', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({
      自制NPC: [
        { 姓名: '阿蕾', 元素持有情况: ['pyro', 'unknown'], 与玩家关系: '旧识' },
        { 姓名: '千岩军', 背景: '群体' },
        { 姓名: '西风骑士团' },
        { 姓名: '' },
        { 姓名: '名字特别特别长超过十二个字符的NPC' },
        '不是对象',
        null,
        { 姓名: '  诺兰  ', 元素持有情况: 'anemo' },
      ],
    }));

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.自制NPC?.map((npc) => npc.姓名)).toEqual(['阿蕾', '诺兰']);
    expect(archive.自制NPC?.[0]?.元素持有情况).toEqual(['pyro']);
    expect(archive.自制NPC?.[1]?.元素持有情况).toBeUndefined();
    expect(archive.已认识角色).toEqual(['阿蕾', '诺兰']);
    expect(archive.初始关系).toEqual(['阿蕾：旧识']);
  });

  it('caps self-made NPCs at 12 entries', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({
      自制NPC: Array.from({ length: 15 }, (_, index) => ({ 姓名: `NPC${index + 1}` })),
    }));

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.自制NPC).toHaveLength(12);
    expect(archive.自制NPC?.at(-1)?.姓名).toBe('NPC12');
  });

  it('deduplicates and trims array fields but keeps a model-provided key-NPC list', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({
      已认识角色: ['  琴 ', '琴', '', '丽莎'],
      关键角色参考: ['  迪卢克  ', '迪卢克'],
      世界设定补充: ['风神像', ' 风神像 '],
      初始关系: ['琴：上司'],
    }));

    const archive = await parseOpeningArchiveWithAI(
      config,
      { ...baseInput, keyNpcs: ['应该被模型结果覆盖'] },
      0,
    );

    expect(archive.已认识角色).toEqual(['琴', '丽莎']);
    expect(archive.关键角色参考).toEqual(['迪卢克']);
    expect(archive.世界设定补充).toEqual(['风神像']);
    expect(archive.初始关系).toEqual(['琴：上司']);
  });

  it('falls back to the injected key NPC list when the model omits it', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    const archive = await parseOpeningArchiveWithAI(
      config,
      { ...baseInput, keyNpcs: ['琴', '丽莎'] },
      0,
    );

    expect(archive.关键角色参考).toEqual(['琴', '丽莎']);
  });

  it('normalises the initial clock through parseGameClock and the legacy period map', async () => {
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({ 初始时间参考: '7:05' }));
    const parsedClock = await parseOpeningArchiveWithAI(config, baseInput, 0);
    expect(parsedClock.初始时间参考).toBe('07:05');

    chatCompletionNonStream.mockResolvedValue(JSON.stringify({ 初始时间参考: '黄昏' }));
    const legacyClock = await parseOpeningArchiveWithAI(config, baseInput, 0);
    expect(legacyClock.初始时间参考).toBe('18:20');

    chatCompletionNonStream.mockResolvedValue(JSON.stringify({ 初始时间参考: '傍晚时分' }));
    const unknownClock = await parseOpeningArchiveWithAI(config, baseInput, 0);
    expect(unknownClock.初始时间参考).toBe('傍晚时分');
  });

  it('leaves a non-padded clock untouched because parseGameClock requires two minute digits', async () => {
    // 现状记录：parseGameClock 的 /(\d{1,2}:\d{2})/ 不匹配 "7:5"，
    // normalizeClock 于是把原文原样返回，界面会显示 "7:5" 而不是 "07:05"。
    chatCompletionNonStream.mockResolvedValue(JSON.stringify({ 初始时间参考: '7:5' }));

    const archive = await parseOpeningArchiveWithAI(config, baseInput, 0);

    expect(archive.初始时间参考).toBe('7:5');
  });

  it('uses the default time hint when the model returns no clock at all', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    const archive = await parseOpeningArchiveWithAI(
      config,
      { ...baseInput, defaultTimeHint: '清晨' },
      0,
    );

    expect(archive.初始时间参考).toBe('06:40');
    expect(archive.初始日期参考).toBeUndefined();
  });

  it('defaults to a mainline-off coordination block when the mainline anchor is disabled', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    const archive = await parseOpeningArchiveWithAI(config, { ...baseInput, mainlineEnabled: false }, 0);

    expect(archive.主线参与程度).toBe('关闭主线坐标，按玩家自建开局工作台推进。');
    expect(archive.冲突协调?.[0]).toContain('主线坐标已关闭');
  });

  it('infers identity / reason / goal from the raw player text when the model leaves them empty', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');

    const archive = await parseOpeningArchiveWithAI(config, {
      ...baseInput,
      playerText: '我是流浪剑客，因委托相关事件来到此地，目标是找到妹妹',
    }, 0);

    expect(archive.玩家身份).toBe('流浪剑客');
    expect(archive.当前目标).toBe('找到妹妹');
    expect(archive.来到此地原因).toBe('因委托相关事件来到蒙德');
  });

  it('passes the abort signal down to chatCompletionNonStream', async () => {
    chatCompletionNonStream.mockResolvedValue('{}');
    const controller = new AbortController();

    await parseOpeningArchiveWithAI(config, baseInput, 0, controller.signal);

    expect(requestOf().signal).toBe(controller.signal);
  });
});
