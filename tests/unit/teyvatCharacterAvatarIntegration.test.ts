import { describe, expect, it } from 'vitest';
import { matchCanonical } from '@/data/canonicalCharacters';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { 创建空角色 } from '@/models/character';
import { resolveTravelerAvatar } from '@/components/features/Chat/MessageRenderers';

describe('Teyvat character avatar integration', () => {
  it('resolves the dedicated Aether, Lumine, and Rosalyne portraits', () => {
    expect(getDefaultBuiltinAvatar('空')).toBe('/assets/teyvat-avatars/characters/%E7%A9%BA.webp');
    expect(getDefaultBuiltinAvatar('荧')).toBe('/assets/teyvat-avatars/characters/%E8%8D%A7.webp');
    expect(getDefaultBuiltinAvatar('罗莎琳')).toBe('/assets/teyvat-avatars/characters/%E7%BD%97%E8%8E%8E%E7%90%B3.webp');
  });

  it('treats Signora names as one canonical character', () => {
    expect(matchCanonical('女士')?.name).toBe('罗莎琳');
    expect(matchCanonical('Rosalyne')?.name).toBe('罗莎琳');
    expect(matchCanonical('La Signora')?.name).toBe('罗莎琳');
    expect(getDefaultBuiltinAvatar('女士')).toBe('/assets/teyvat-avatars/characters/%E7%BD%97%E8%8E%8E%E7%90%B3.webp');
  });

  it('uses the named canonical Traveler portrait before the generic fallback', () => {
    const aether = { ...创建空角色(), 姓名: '空' };
    const lumine = { ...创建空角色(), 姓名: '荧' };

    expect(resolveTravelerAvatar(aether)).toBe('/assets/teyvat-avatars/characters/%E7%A9%BA.webp');
    expect(resolveTravelerAvatar(lumine)).toBe('/assets/teyvat-avatars/characters/%E8%8D%A7.webp');
  });
});
