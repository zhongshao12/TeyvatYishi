import type { ElementId } from '@/models/teyvat/elements';

/**
 * 七元素命名与视觉色单一真源。
 *
 * 颜色取值与 styles/root-theme.css 的 `--tj-el-*` 系列保持一致：
 * 调色必须同时修改这里与 root-theme.css（后续可改为由本文件生成 CSS）。
 * 组件不要再各自硬编码元素色或元素中文名，一律 import 本模块。
 */
export const ELEMENT_NAMES: Record<ElementId, string> = {
  anemo: '风', geo: '岩', electro: '雷', dendro: '草', hydro: '水', pyro: '火', cryo: '冰',
};

/** 十六进制主题色。 */
export const ELEMENT_COLORS: Record<ElementId, string> = {
  pyro: '#ec4923',
  hydro: '#498fcc',
  anemo: '#359697',
  electro: '#6957c2',
  dendro: '#66ad16',
  cryo: '#35aacc',
  geo: '#cc9046',
};

/** rgb 三元组字符串，便于 `rgba(${ELEMENT_COLORS_RGB[el]}, 0.2)` 这类透明度组合。 */
export const ELEMENT_COLORS_RGB: Record<ElementId, string> = {
  pyro: '236, 73, 35',
  hydro: '73, 143, 204',
  anemo: '53, 150, 151',
  electro: '105, 87, 194',
  dendro: '102, 173, 22',
  cryo: '53, 170, 204',
  geo: '204, 144, 70',
};

/** 元素徽记符号（面板、标签装饰用）。 */
export const ELEMENT_EMBLEMS: Record<ElementId, string> = {
  anemo: '✦', geo: '◆', electro: '⚡', dendro: '✿', hydro: '◉', pyro: '◇', cryo: '❉',
};
