import { describe, expect, it } from 'vitest';
import { matchCanonical, matchCanonicalIdentity } from '@/data/canonicalCharacters';
import { 归一化NPC记录列表, 创建NPC记录, type NPC记录 } from '@/models/npc';

/**
 * 「留云借风真君给个别名：闲云，把闲云和留云借风真君合成两个人」（2026-10-03 玩家反馈）。
 *
 * 旧行为：原著角色库里没有「留云借风真君」，于是「留云借风真君」与「闲云」拿到两个独立的
 * `name:` 身份键，存档里各占一份档案；而同一套机制对「雷电将军 / Raiden Shogun」是能合并的。
 * 现在两个名字（含 Xianyun / Cloud Retainer / 留云 / 借风留云真君）落在同一个 `canon:` 键上，
 * 归一化时合并为一人，并且**没被选中的那个名字会写进别名**（玩家要的「别名：闲云」）。
 */

const 记录 = (姓名: string, id: string, patch: Partial<NPC记录> = {}) => ([{
  ...创建NPC记录({ 姓名, 阶位: 'companion', 初见回合: 1, 原著角色: true }),
  id,
  ...patch,
}] as unknown as NPC记录[]);

describe('A 闲云 与 留云借风真君 是同一个身份', () => {
  it('原著库把两个名字解析到同一条', () => {
    for (const name of ['留云借风真君', '闲云', 'Xianyun', 'Cloud Retainer', '留云', '借风留云真君']) {
      expect(matchCanonical(name)?.name, name).toBe('留云借风真君');
    }
    expect(matchCanonicalIdentity({ name: '闲云' })?.name).toBe('留云借风真君');
  });

  it('两条记录合并成一人，且未选中的名字成为别名', () => {
    const merged = 归一化NPC记录列表([
      ...记录('留云借风真君', 'npc_liuyun'),
      ...记录('闲云', 'npc_xianyun', { 初见回合: 3 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.姓名).toBe('留云借风真君');
    expect(merged[0]!.别名 ?? '').toContain('闲云');
    expect(merged[0]!.原著角色).toBe(true);
  });

  it('英文名同样合并（反向顺序也一样）', () => {
    const merged = 归一化NPC记录列表([
      ...记录('Xianyun', 'npc_en'),
      ...记录('留云借风真君', 'npc_zh'),
    ]);
    expect(merged).toHaveLength(1);
    expect(['留云借风真君', 'Xianyun']).toContain(merged[0]!.姓名);
  });

  it('对照：雷电将军 / Raiden Shogun 的既有合并契约不变', () => {
    const merged = 归一化NPC记录列表([
      ...记录('雷电将军', 'a'),
      ...记录('Raiden Shogun', 'b'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.姓名).toBe('雷电将军');
  });
});

describe('B 不能因为「闲云」里含「云」就误并玩家或其他角色', () => {
  it('玩家名「宇智波云」与「云」不会被认成留云借风真君', () => {
    expect(matchCanonical('宇智波云')).toBeNull();
    expect(matchCanonical('云')).toBeNull();
  });

  it('玩家记录与闲云记录不会被合并成同一人', () => {
    const merged = 归一化NPC记录列表([
      ...记录('宇智波云', 'npc_player', { 原著角色: false }),
      ...记录('闲云', 'npc_xianyun'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.姓名).sort()).toEqual(['宇智波云', '闲云'].sort());
  });

  it('另一个同名角色（甘雨）不受影响', () => {
    expect(matchCanonical('甘雨')?.name).toBe('甘雨');
    expect(matchCanonical('王小美')?.name).toBe('甘雨');
  });
});
