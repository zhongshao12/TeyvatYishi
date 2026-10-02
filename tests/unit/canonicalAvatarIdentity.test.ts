import { describe, expect, it } from 'vitest';
import { TEYVAT_AVATAR_SETS } from '@/data/teyvatAvatarRegistry.generated';
import { getBuiltinAvatarSet } from '@/data/builtinAvatars';
import { matchCanonical } from '@/data/canonicalCharacters';
import { hasBuiltinAvatarIdentity, isCanonicalIdentity } from '@/data/canonicalIdentity';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { 归一化NPC记录列表 } from '@/models/npc';

/**
 * 用户第 9 项：「把有头像的角色设置为原著角色」。
 *
 * 现状缺口（实测）：官方头像注册表 `data/teyvatAvatarRegistry.generated.ts` 有 127 个角色，
 * 而手维护的精简原著名单 `data/canonicalCharacters.ts` 只有 58 个 —— 相差 71 个
 * （阿贝多、莫娜、优菈、迪奥娜、砂糖、五郎、云堇、重云、七七、早柚、瑶瑶…）。
 * 这些角色**有头像却不是原著角色**：`canonical: false` + `roleTier: 'extra'`，
 * 于是不显示「原著角色」标签、长期性格不受保护、不强制 companion 阶位。
 *
 * 判定收口到 `data/canonicalIdentity.ts`：原著身份 = 精简名单 ∪ 官方头像注册表。
 */
describe('有头像即原著角色（2026-09-29）', () => {
  it('头像注册表里的每个名字都必须是原著身份（防两处名单漂移）', () => {
    const avatarNames = TEYVAT_AVATAR_SETS.map((set) => set.canonicalName);
    expect(avatarNames.length).toBeGreaterThan(100);
    const missing = avatarNames.filter((name) => !isCanonicalIdentity(name));
    expect(missing).toEqual([]);
  });

  it('确认这几个角色不再掉队（它们在头像表里、却不在精简原著名单里）', () => {
    for (const name of ['阿贝多', '莫娜', '优菈', '迪奥娜', '砂糖']) {
      expect(getBuiltinAvatarSet(name), name).toBeDefined();
      expect(matchCanonical(name), name).toBeNull();
      expect(isCanonicalIdentity(name), name).toBe(true);
    }
  });

  it('没有头像的原创角色仍然不是原著角色', () => {
    expect(hasBuiltinAvatarIdentity('阿岚')).toBe(false);
    expect(isCanonicalIdentity('阿岚')).toBe(false);
    expect(isCanonicalIdentity('', ['某个原创名字'])).toBe(false);
  });

  it('别名命中头像也算原著身份', () => {
    expect(isCanonicalIdentity('某个称号', ['莫娜'])).toBe(true);
  });

  it('Teyvat 记录：有头像的角色获得 canonical 标记与 companion 阶位', () => {
    const [record] = normalizeTeyvatNpcRecords([{ id: 'npc_albedo', 姓名: '阿贝多', gender: '男' }]);
    expect(record?.canonical).toBe(true);
    expect(record?.roleTier).toBe('companion');
  });

  it('legacy 记录：有头像的角色标成原著角色与 companion 阶位', () => {
    const [record] = 归一化NPC记录列表([{ id: 'npc_mona', 姓名: '莫娜' }]);
    expect(record?.原著角色).toBe(true);
    expect(record?.阶位).toBe('companion');
  });

  it('原创角色在两条链路上都不被误判', () => {
    const [teyvatRecord] = normalizeTeyvatNpcRecords([{ id: 'npc_alan', 姓名: '阿岚' }]);
    expect(teyvatRecord?.canonical).toBe(false);
    const [legacyRecord] = 归一化NPC记录列表([{ id: 'npc_alan', 姓名: '阿岚' }]);
    // legacy 归一化对「非原著」不写该字段（省略而非 false），语义等价于「不是原著角色」。
    expect(legacyRecord?.原著角色).not.toBe(true);
    expect(legacyRecord?.阶位).not.toBe('companion');
  });
});
