// 进入游戏后右侧菜单的所有系统入口。
// 顺序即菜单显示顺序。新增系统时在此追加。

export type GameSystemId =
  | 'path'
  | 'skill'
  | 'inventory'
  | 'quest'
  | 'companion'
  | 'album'
  | 'steambird'
  | 'timeline'
  | 'plot'
  | 'irminsul'
  | 'worldbook'
  | 'codex'
  | 'memory'
  | 'map';

export interface GameMenuItem {
  id: GameSystemId;
  label: string;
  subtitle: string;
  glyph: string;
}

export const GAME_MENU_ITEMS: GameMenuItem[] = [
  { id: 'path', label: '元素', subtitle: '神之眼与元素共鸣，被尘世七执政注视的证明。', glyph: '✶' },
  { id: 'skill', label: '天赋', subtitle: '元素战技 / 元素爆发', glyph: '✧' },
  { id: 'inventory', label: '背包', subtitle: '圣遗物 · 武器 · 料理', glyph: '◇' },
  { id: 'quest', label: '任务', subtitle: '魔神任务 / 传说任务 / 委托', glyph: '⚑' },
  { id: 'companion', label: '同伴', subtitle: '同行角色与好感', glyph: '✦' },
  { id: 'album', label: '相册', subtitle: '留影机与视觉资产', glyph: '▧' },
  { id: 'steambird', label: '蒸汽鸟报', subtitle: '提瓦特要闻', glyph: '☉' },
  { id: 'timeline', label: '斗地主', subtitle: '邀请两位同伴打牌', glyph: '♠' },
  { id: 'plot', label: '剧情', subtitle: '魔神任务轨道', glyph: '❖' },
  { id: 'memory', label: '记忆', subtitle: '即时 / 短期 / 长期', glyph: '◐' },
  { id: 'map', label: '地图', subtitle: '七国地图与传送锚点', glyph: '⌖' },
  { id: 'irminsul', label: '世界树', subtitle: '地脉记忆库', glyph: '◌' },
  { id: 'codex', label: '北陆图书馆', subtitle: '原神角色与设定档案', glyph: '◈' },
  { id: 'worldbook', label: '提瓦特之书', subtitle: '世界书管理', glyph: '✧' },
];
