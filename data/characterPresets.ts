export interface CharacterPreset {
  id: string;
  name: string;
  originTime: string;
  originOccupation: string;
  appearance: string;
  personality: string;
  background: string;
}

// 角色预设已清空，等待提瓦特题材重构（旅行者身份模板）。
export const characterPresets: CharacterPreset[] = [];

export function getCharacterPresetById(id: string): CharacterPreset | undefined {
  return characterPresets.find((p) => p.id === id);
}
