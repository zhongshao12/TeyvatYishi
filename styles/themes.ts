// 旅行者纪事 · 主题定义（羊皮纸古籍统一色板）
// 全应用统一为米黄羊皮纸 + 暖棕做旧色调：所有面板、抽屉、弹窗与聊天区共用同一套
// 纸面 token（与 .journal-story-page 的翻转值一致），六个主题只在点缀色的色相上
// 保留细微国别差异。元素色 / 稀有度色为语义色，不随主题翻转。

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  variables: Record<string, string>;
}

const JOURNAL_SHARED_TOKENS: Record<string, string> = {
  '--journal-leather': '#4b3428',
  '--journal-leather-deep': '#251a16',
  '--journal-parchment-muted': '#d8c8a6',
  '--journal-ink': '#352e27',
  '--journal-ink-muted': '#6e6151',
  '--journal-antique-gold': '#b68a43',
  '--journal-antique-gold-soft': '#d5b66e',
  '--journal-ribbon-red': '#874f43',
  '--journal-focus-ring': '#f0d58b',
};

/** 羊皮纸古籍底色：与 adventurer-journal.css 的 .journal-story-page 翻转值保持一致。 */
const PARCHMENT_SHARED_TOKENS: Record<string, string> = {
  '--tj-bg-primary': '236, 224, 196',
  '--tj-bg-secondary': '228, 214, 182',
  '--tj-text-primary': '45, 38, 30',
  '--tj-text-secondary': '82, 69, 54',
  '--tj-danger': '168, 62, 48',
  '--tj-on-accent': '248, 242, 226',
  '--tj-surface': '233, 219, 188',
  '--tj-surface-strong': '241, 229, 202',
  '--tj-bubble': '228, 213, 181',
  '--tj-panel-bg-start': '235, 221, 190',
  '--tj-panel-bg-end': '226, 210, 176',
  '--tj-surface-bg-start': '233, 219, 188',
  '--tj-surface-bg-end': '224, 208, 172',
  '--tj-drawer-bg': '232, 217, 185',
  '--tj-overlay-bg': '26, 20, 14',
  '--tj-input-bg-start': '240, 228, 202',
  '--tj-input-bg-end': '231, 216, 184',
  '--tj-input-focus-bg': '244, 233, 208',
  '--tj-option-bg': '232, 217, 185',
  '--tj-btn-primary-start': '190, 150, 84',
  '--tj-btn-primary-end': '122, 84, 38',
  '--tj-btn-primary-text': '248, 242, 226',
  '--tj-chat-bubble': '233, 219, 188',
  '--tj-chat-bubble-alpha': '0.96',
  '--tj-chat-text': '45, 38, 30',
  '--tj-chat-muted': '110, 92, 70',
  '--tj-shadow': '59, 42, 28',
  '--tj-arcane-accent': '138, 106, 62',
  '--tj-arcane-accent-deep': '110, 82, 46',
  '--tj-arcane-blue': '124, 118, 104',
  '--tj-arcane-blue-deep': '98, 92, 82',
  '--tj-paper-deep': '208, 188, 148',
  '--tj-paper-warm': '240, 228, 202',
  '--tj-amber-soft': '190, 150, 84',
  '--tj-amber-deep': '150, 112, 58',
  '--tj-sage-soft': '122, 146, 110',
  '--tj-sage-deep': '92, 116, 84',
  '--tj-arcane-wash': '228, 214, 182',
  '--tj-magic-violet': '128, 98, 142',
  '--tj-parchment': '240, 230, 210',
  '--tj-gold-metal': '212, 175, 55',
  '--tj-ui-title': '45, 38, 30',
  '--tj-ui-body': '66, 56, 44',
  '--tj-ui-muted': '110, 94, 74',
  '--tj-ui-faint': '132, 116, 94',
  '--tj-ui-active-text': '248, 242, 226',
  '--tj-ui-panel': '233, 219, 188',
  '--tj-ui-panel-strong': '241, 229, 202',
  '--tj-ui-nsfw': '158, 76, 96',
  '--tj-ui-success': '74, 112, 68',
};

/** 元素色 / 稀有度色：语义色，主题间共享。 */
const SEMANTIC_SHARED_TOKENS: Record<string, string> = {
  '--tj-el-pyro': '236, 73, 35',
  '--tj-el-hydro': '73, 143, 204',
  '--tj-el-anemo': '53, 150, 151',
  '--tj-el-electro': '105, 87, 194',
  '--tj-el-dendro': '102, 173, 22',
  '--tj-el-cryo': '53, 170, 204',
  '--tj-el-geo': '204, 144, 70',
  '--tj-el-none': '147, 147, 147',
  '--tj-rarity-3': '84, 164, 180',
  '--tj-rarity-4': '145, 116, 169',
  '--tj-rarity-5': '220, 164, 84',
};

interface NationAccent {
  accentPrimary: string;
  accentSecondary: string;
  accentPrimaryDeep: string;
  accentMid: string;
  border: string;
}

function buildParchmentTheme(input: {
  id: string;
  name: string;
  description: string;
  parchment: string;
  travelGreen: string;
  accent: NationAccent;
  /** 国别纸色微调：三层差异化（纸色 × 点缀 × 区域背景）的第一层。 */
  paper?: Record<string, string>;
}): ThemeDefinition {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    variables: {
      ...JOURNAL_SHARED_TOKENS,
      '--journal-parchment': input.parchment,
      '--journal-travel-green': input.travelGreen,
      ...PARCHMENT_SHARED_TOKENS,
      ...(input.paper ?? {}),
      ...SEMANTIC_SHARED_TOKENS,
      '--tj-accent-primary': input.accent.accentPrimary,
      '--tj-accent-secondary': input.accent.accentSecondary,
      '--tj-accent-primary-deep': input.accent.accentPrimaryDeep,
      '--tj-accent-mid': input.accent.accentMid,
      '--tj-accent-glow': input.accent.accentMid,
      '--tj-border': input.accent.border,
    },
  };
}

export const themes: [ThemeDefinition, ...ThemeDefinition[]] = [
  buildParchmentTheme({
    id: 'mondstadt',
    name: '蒙德晨风',
    description: '奶白羊皮纸与暖金晨光，古董金的自由之邦',
    parchment: '#efe5c9',
    travelGreen: '#526f5a',
    accent: {
      accentPrimary: '158, 112, 44',
      accentSecondary: '122, 84, 40',
      accentPrimaryDeep: '110, 76, 32',
      accentMid: '196, 156, 96',
      border: '122, 92, 48',
    },
    paper: {
      '--tj-bg-primary': '238, 227, 200',
      '--tj-surface': '235, 222, 192',
    },
  }),
  buildParchmentTheme({
    id: 'liyue',
    name: '璃月金砂',
    description: '米黄卷轴与琥珀铜金，契约之港的暖棕墨迹',
    parchment: '#f0dfba',
    travelGreen: '#74613e',
    accent: {
      accentPrimary: '146, 94, 34',
      accentSecondary: '116, 74, 30',
      accentPrimaryDeep: '104, 66, 26',
      accentMid: '198, 148, 88',
      border: '118, 78, 36',
    },
    paper: {
      '--tj-bg-primary': '236, 222, 186',
      '--tj-surface': '233, 218, 180',
    },
  }),
  buildParchmentTheme({
    id: 'inazuma',
    name: '稻妻紫雷',
    description: '做旧纸面上的古紫藤印记，幕府古书的沉静墨色',
    parchment: '#e8ddcf',
    travelGreen: '#655a75',
    accent: {
      accentPrimary: '132, 90, 118',
      accentSecondary: '104, 72, 96',
      accentPrimaryDeep: '92, 62, 84',
      accentMid: '178, 138, 158',
      border: '112, 80, 100',
    },
    paper: {
      '--tj-bg-primary': '230, 222, 212',
      '--tj-surface': '227, 219, 208',
    },
  }),
  buildParchmentTheme({
    id: 'sumeru',
    name: '须弥翠影',
    description: '枯叶黄纸与橄榄铜金，智慧之城的手抄本草卷',
    parchment: '#e9e2bd',
    travelGreen: '#4f7654',
    accent: {
      accentPrimary: '118, 118, 52',
      accentSecondary: '92, 96, 42',
      accentPrimaryDeep: '82, 84, 36',
      accentMid: '170, 170, 100',
      border: '98, 100, 44',
    },
    paper: {
      '--tj-bg-primary': '232, 226, 196',
      '--tj-surface': '229, 223, 190',
    },
  }),
  buildParchmentTheme({
    id: 'fontaine',
    name: '枫丹水蓝',
    description: '羊皮纸上的青铜蓝灰，旧报纸与蒸汽时代的墨印',
    parchment: '#e6e3d2',
    travelGreen: '#506f72',
    accent: {
      accentPrimary: '96, 116, 128',
      accentSecondary: '76, 92, 104',
      accentPrimaryDeep: '66, 80, 92',
      accentMid: '148, 164, 174',
      border: '80, 96, 106',
    },
    paper: {
      '--tj-bg-primary': '228, 227, 212',
      '--tj-surface': '225, 224, 208',
    },
  }),
  buildParchmentTheme({
    id: 'natlan',
    name: '纳塔赤焰',
    description: '暖褐纸面上的古铜赤金，战争之火的余烬墨色',
    parchment: '#ead7b8',
    travelGreen: '#76543c',
    accent: {
      accentPrimary: '158, 78, 40',
      accentSecondary: '122, 60, 32',
      accentPrimaryDeep: '108, 52, 28',
      accentMid: '198, 118, 72',
      border: '126, 66, 36',
    },
    paper: {
      '--tj-bg-primary': '234, 218, 190',
      '--tj-surface': '231, 214, 184',
    },
  }),
  // 夜间模式：烛光夜读。深色暖调纸面 + 金琥珀字，供暗环境阅读。
  {
    id: 'candlelight',
    name: '烛光夜读',
    description: '深色羊皮纸与琥珀烛光，夜里读手账的暖调墨色',
    variables: {
      ...JOURNAL_SHARED_TOKENS,
      '--journal-leather': '#3a2a20',
      '--journal-leather-deep': '#1c130f',
      '--journal-parchment': '#4a3b2c',
      '--journal-parchment-muted': '#5a4a38',
      '--journal-ink': '#e8d9bd',
      '--journal-ink-muted': '#c0a888',
      '--journal-travel-green': '#6a8a72',
      '--tj-bg-primary': '58, 46, 36',
      '--tj-bg-secondary': '50, 39, 30',
      '--tj-text-primary': '232, 217, 189',
      '--tj-text-secondary': '192, 168, 136',
      '--tj-danger': '228, 118, 96',
      '--tj-on-accent': '40, 28, 20',
      '--tj-surface': '66, 53, 41',
      '--tj-surface-strong': '74, 60, 47',
      '--tj-bubble': '66, 53, 41',
      '--tj-panel-bg-start': '70, 57, 44',
      '--tj-panel-bg-end': '58, 46, 36',
      '--tj-surface-bg-start': '66, 53, 41',
      '--tj-surface-bg-end': '54, 43, 33',
      '--tj-drawer-bg': '62, 50, 39',
      '--tj-overlay-bg': '14, 10, 8',
      '--tj-input-bg-start': '74, 60, 46',
      '--tj-input-bg-end': '64, 51, 39',
      '--tj-input-focus-bg': '80, 66, 51',
      '--tj-option-bg': '66, 53, 41',
      '--tj-btn-primary-start': '214, 168, 96',
      '--tj-btn-primary-end': '158, 112, 52',
      '--tj-btn-primary-text': '40, 28, 20',
      '--tj-chat-bubble': '70, 57, 44',
      '--tj-chat-bubble-alpha': '0.96',
      '--tj-chat-text': '232, 217, 189',
      '--tj-chat-muted': '172, 148, 118',
      '--tj-shadow': '0, 0, 0',
      '--tj-arcane-accent': '214, 168, 96',
      '--tj-arcane-accent-deep': '178, 132, 66',
      '--tj-arcane-blue': '172, 150, 118',
      '--tj-arcane-blue-deep': '140, 118, 92',
      '--tj-paper-deep': '46, 37, 29',
      '--tj-paper-warm': '74, 60, 47',
      '--tj-amber-soft': '214, 168, 96',
      '--tj-amber-deep': '178, 132, 66',
      '--tj-sage-soft': '148, 160, 120',
      '--tj-sage-deep': '116, 128, 92',
      '--tj-arcane-wash': '50, 39, 30',
      '--tj-magic-violet': '178, 140, 190',
      '--tj-parchment': '74, 59, 44',
      '--tj-gold-metal': '212, 175, 55',
      '--tj-ui-title': '232, 217, 189',
      '--tj-ui-body': '210, 192, 162',
      '--tj-ui-muted': '172, 148, 118',
      '--tj-ui-faint': '150, 130, 104',
      '--tj-ui-active-text': '40, 28, 20',
      '--tj-ui-panel': '66, 53, 41',
      '--tj-ui-panel-strong': '74, 60, 47',
      '--tj-ui-nsfw': '238, 158, 178',
      '--tj-ui-success': '148, 200, 150',
      ...SEMANTIC_SHARED_TOKENS,
      '--tj-accent-primary': '214, 168, 96',
      '--tj-accent-secondary': '178, 132, 66',
      '--tj-accent-primary-deep': '158, 112, 52',
      '--tj-accent-mid': '232, 196, 128',
      '--tj-accent-glow': '232, 196, 128',
      '--tj-border': '178, 140, 84',
    },
  },
];

export function applyTheme(themeId: string): void {
  const theme = themes.find((t) => t.id === themeId) ?? themes[0];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-theme', theme.id);
}

export function getThemeById(id: string): ThemeDefinition {
  return themes.find((t) => t.id === id) ?? themes[0];
}

/** 旧主题降级：已删除的主题自动回退到默认主题（蒙德晨风） */
export function normalizeThemeId(id: string): string {
  if (themes.some((t) => t.id === id)) return id;
  return 'mondstadt';
}
