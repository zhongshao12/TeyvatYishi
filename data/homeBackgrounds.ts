// 六国主题 × 首页封面背景映射。
// 图片位于 public/assets/backgrounds/（由 assets-src/backgroud/ 原图压缩为 WebP）。
// 主题 id 与 styles/themes.ts 保持一致。

export interface HomeBackgroundMeta {
  id: string;
  /** 无障碍描述。 */
  title: string;
  src: string;
}

const HOME_BACKGROUNDS: Record<string, HomeBackgroundMeta> = {
  mondstadt: { id: 'mondstadt', title: '蒙德主题封面背景', src: '/assets/backgrounds/mondstadt.webp' },
  liyue: { id: 'liyue', title: '璃月主题封面背景', src: '/assets/backgrounds/liyue.webp' },
  inazuma: { id: 'inazuma', title: '稻妻主题封面背景', src: '/assets/backgrounds/inazuma.webp' },
  sumeru: { id: 'sumeru', title: '须弥主题封面背景', src: '/assets/backgrounds/sumeru.webp' },
  fontaine: { id: 'fontaine', title: '枫丹主题封面背景', src: '/assets/backgrounds/fontaine.webp' },
  natlan: { id: 'natlan', title: '纳塔主题封面背景', src: '/assets/backgrounds/natlan.webp' },
};

export function getHomeBackground(theme: string | undefined | null): HomeBackgroundMeta | null {
  if (!theme) return null;
  return HOME_BACKGROUNDS[theme] ?? null;
}
