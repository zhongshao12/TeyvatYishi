import { describe, expect, it } from 'vitest';
import { TEYVAT_AVATAR_SETS } from '@/data/teyvatAvatarRegistry.generated';
import { AVATAR_CHARACTER_PROFILES, getAvatarCharacterProfile } from '@/data/avatarCharacterProfiles';
import { 创建NPC记录, 归一化NPC记录列表 } from '@/models/npc';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

describe('avatar character profiles enrichment', () => {
  it('covers every character in the builtin avatar registry with all 5 required fields', () => {
    const avatarNames = TEYVAT_AVATAR_SETS.map((s) => s.canonicalName);
    expect(avatarNames.length).toBeGreaterThan(120);

    for (const name of avatarNames) {
      const profile = getAvatarCharacterProfile(name);
      expect(profile, `Missing profile for avatar character: ${name}`).toBeDefined();
      expect(profile!.发色, `Missing 发色 for ${name}`).toBeTruthy();
      expect(profile!.瞳色, `Missing 瞳色 for ${name}`).toBeTruthy();
      expect(profile!.身高, `Invalid 身高 for ${name}`).toMatch(/^\d{2,3}\s*cm$/);
      expect(profile!.体重, `Invalid 体重 for ${name}`).toMatch(/^\d{2,3}\s*kg$/);
      expect(profile!.常用穿着, `Missing 常用穿着 for ${name}`).toBeTruthy();
      expect(profile!.常用穿着.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('normalizes avatar characters with canon appearance facts and usual clothing', () => {
    const records = 归一化NPC记录列表([
      创建NPC记录({ 姓名: '芙宁娜', 阶位: 'companion', 初见回合: 1 }),
      创建NPC记录({ 姓名: '钟离', 阶位: 'companion', 初见回合: 1 }),
      创建NPC记录({ 姓名: '阿贝多', 阶位: 'companion', 初见回合: 1 }),
      创建NPC记录({ 姓名: '闲云', 阶位: 'companion', 初见回合: 1 }),
    ]);

    const furina = records.find((r) => r.姓名 === '芙宁娜');
    expect(furina).toBeDefined();
    expect(furina?.外貌档案?.发色).toMatchObject({ value: expect.stringContaining('蓝'), source: 'canon' });
    expect(furina?.外貌档案?.瞳色).toMatchObject({ value: expect.stringContaining('异色'), source: 'canon' });
    expect(furina?.外貌档案?.身高).toMatchObject({ value: '162 cm', source: 'canon' });
    expect(furina?.外貌档案?.体重).toMatchObject({ value: '47 kg', source: 'canon' });
    expect(furina?.穿着).toContain('枫丹水蓝');

    const zhongli = records.find((r) => r.姓名 === '钟离');
    expect(zhongli).toBeDefined();
    expect(zhongli?.外貌档案?.发色).toMatchObject({ value: expect.stringContaining('棕黑'), source: 'canon' });
    expect(zhongli?.外貌档案?.瞳色).toMatchObject({ value: expect.stringContaining('金'), source: 'canon' });
    expect(zhongli?.外貌档案?.身高).toMatchObject({ value: '186 cm', source: 'canon' });
    expect(zhongli?.外貌档案?.体重).toMatchObject({ value: '76 kg', source: 'canon' });
    expect(zhongli?.穿着).toContain('长礼服袍');

    const albedo = records.find((r) => r.姓名 === '阿贝多');
    expect(albedo).toBeDefined();
    expect(albedo?.外貌档案?.发色).toMatchObject({ value: '浅金色', source: 'canon' });
    expect(albedo?.外貌档案?.瞳色).toMatchObject({ value: '浅蓝瞳', source: 'canon' });
    expect(albedo?.外貌档案?.身高).toMatchObject({ value: '168 cm', source: 'canon' });
    expect(albedo?.外貌档案?.体重).toMatchObject({ value: '54 kg', source: 'canon' });
    expect(albedo?.穿着).toContain('炼金术士');

    const xianyun = records.find((r) => r.姓名 === '留云借风真君' || r.姓名 === '闲云');
    expect(xianyun).toBeDefined();
    expect(xianyun?.外貌档案?.发色).toMatchObject({ value: expect.stringContaining('墨绿'), source: 'canon' });
    expect(xianyun?.外貌档案?.瞳色).toMatchObject({ value: expect.stringContaining('金碧'), source: 'canon' });
    expect(xianyun?.外貌档案?.身高).toMatchObject({ value: '172 cm', source: 'canon' });
    expect(xianyun?.外貌档案?.体重).toMatchObject({ value: '55 kg', source: 'canon' });
    expect(xianyun?.穿着).toContain('闲云');
  });

  it('enriches avatar characters through enrichNpcArchives without overwriting manual edits', () => {
    const amber = 创建NPC记录({
      姓名: '安柏',
      阶位: 'companion',
      初见回合: 1,
      外貌档案: {
        发色: { value: '黑色', source: 'manual' },
      },
    });

    const enriched = enrichNpcArchives([amber], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]!;
    // Manual hair color is preserved
    expect(enriched.外貌档案?.发色).toEqual({ value: '黑色', source: 'manual' });
    // Other fields are enriched from canon
    expect(enriched.外貌档案?.瞳色).toMatchObject({ value: expect.stringContaining('琥珀'), source: 'canon' });
    expect(enriched.外貌档案?.身高).toMatchObject({ value: '158 cm', source: 'canon' });
    expect(enriched.外貌档案?.体重).toMatchObject({ value: '46 kg', source: 'canon' });
    expect(enriched.穿着).toContain('侦察骑士');
  });

  it('leaves custom original characters without avatar profiles uninvented', () => {
    const custom = 创建NPC记录({
      姓名: '阿明',
      阶位: 'companion',
      初见回合: 1,
    });
    const enriched = enrichNpcArchives([custom], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]!;
    expect(enriched.外貌档案).toBeUndefined();
    expect(enriched.穿着).toBeUndefined();
  });

  // 玩家要求（2026-10-03）：「把坎蒂丝归入女角色中和去掉坎蒂丝的NSFW档案的男性器」
  it('classifies Candace as female and strips male genital / male body profile from her NSFW archive', () => {
    const candaceRecord = 创建NPC记录({
      姓名: '坎蒂丝',
      阶位: 'companion',
      初见回合: 1,
      // 故意模拟错误存档标记为男且附带男性器
      性别: '男' as never,
      NSFW档案: {
        enabled: true,
        年龄确认: 'adult',
        年龄确认来源: 'canonical',
        男性身体档案: {
          男性器: '不该存在于女角色档案中的男性器描述',
          后庭: '后庭细节',
        },
        部位图片: {
          男性器: '/path/to/male/genital.png',
          女性胸部: '/path/to/chest.png',
        },
      },
    });

    const [normalized] = 归一化NPC记录列表([candaceRecord]);
    expect(normalized).toBeDefined();
    // 强制修正为女角色
    expect(normalized?.性别).toBe('女');
    // 去除男性身体档案与男性器部位图
    expect(normalized?.NSFW档案?.男性身体档案).toBeUndefined();
    expect(normalized?.NSFW档案?.部位图片?.男性器).toBeUndefined();
    expect(normalized?.NSFW档案?.部位图片?.女性胸部).toBe('/path/to/chest.png');
    // 补齐女性外貌细项与常用穿着
    expect(normalized?.外貌档案?.发色).toMatchObject({ value: expect.stringContaining('深靛蓝'), source: 'canon' });
    expect(normalized?.外貌档案?.瞳色).toMatchObject({ value: expect.stringContaining('异色双瞳'), source: 'canon' });
    expect(normalized?.外貌档案?.身高).toMatchObject({ value: '170 cm', source: 'canon' });
    expect(normalized?.外貌档案?.体重).toMatchObject({ value: '53 kg', source: 'canon' });
    expect(normalized?.穿着).toContain('阿如村守护者');

    // 经由 enrichNpcArchives 流程同样清理并确保女性身份
    const enriched = enrichNpcArchives([candaceRecord], { nsfwEnabled: true, maleNsfwArchiveEnabled: true }).records[0]!;
    expect(enriched.性别).toBe('女');
    expect(enriched.NSFW档案?.男性身体档案).toBeUndefined();
    expect(enriched.NSFW档案?.部位图片?.男性器).toBeUndefined();
    expect(enriched.NSFW档案?.部位图片?.女性胸部).toBe('/path/to/chest.png');
  });
});
