import type { StorySnapshotRenderContext } from '@/models/imageGeneration';
import { splitImagePromptFragments } from '@/utils/imagePromptCompaction';

export const IMAGE_PROMPT_CATEGORIES = ['画风', '质量', '构图', '国家与地区', '自定义'] as const;
export type ImagePromptCategory = typeof IMAGE_PROMPT_CATEGORIES[number];
export interface ImagePromptSnippet {
  id: string;
  name: string;
  category: ImagePromptCategory;
  positive: string;
  negative: string;
}
export interface ImagePromptSelection { positive?: string; negative?: string }
export interface ImagePromptDraft { prompt: string; negative: string; context?: StorySnapshotRenderContext | null }

const builtin = (id: string, name: string, category: ImagePromptCategory, positive: string, negative: string): ImagePromptSnippet =>
  ({ id: `builtin-${id}`, name, category, positive, negative });
/** Short, drawable fragments. No character/relationship replacement or model instruction. */
export const BUILTIN_IMAGE_PROMPT_LIBRARY: readonly ImagePromptSnippet[] = [
  builtin('fantasy', '日式西幻', '画风', 'anime illustration, Japanese fantasy art, delicate lineart, painterly fantasy background, harmonious colors', 'photorealistic, live action, plastic skin, harsh outlines'),
  builtin('journal', '温暖冒险手账', '画风', 'warm fantasy illustration, soft watercolor shading, gentle sunlight, cozy atmosphere, delicate paper texture', 'muddy colors, heavy grain, illegible text, harsh shadows'),
  builtin('quality', '清晰高质量', '质量', 'best quality, high detail, clean lineart, sharp focus, balanced lighting', 'worst quality, low quality, lowres, blurry, jpeg artifacts, watermark, text, logo'),
  builtin('anatomy', '人物细节修正', '质量', 'natural pose, detailed eyes, coherent anatomy, detailed hands', 'bad anatomy, bad hands, extra fingers, missing fingers, fused limbs, asymmetrical eyes'),
  builtin('portrait', '聊天头像构图', '构图', 'head and shoulders portrait, centered composition, unobstructed face, simple background', 'cropped face, hidden eyes, tiny face, distant view, multiple views'),
  builtin('photo', '自然生活照片', '构图', 'candid photo composition, relaxed pose, natural light, eye level, clear subject', 'stiff pose, extreme angle, cluttered foreground, obscured subject'),
  builtin('scene', '宽幅场景', '构图', 'wide establishing shot, layered depth, scenic panorama, atmospheric perspective', 'flat perspective, cluttered layout, duplicated buildings, tilted horizon'),
  builtin('mondstadt', '蒙德', '国家与地区', 'Mondstadt, European fantasy town, gothic cathedral, windmills, cobblestone streets, dandelions, bright blue sky', 'industrial skyline, neon signs, desert, heavy smog'),
  builtin('liyue', '璃月', '国家与地区', 'Liyue harbor, Chinese fantasy architecture, carved wooden balconies, warm lanterns, jade mountains, golden evening light', 'modern skyscrapers, gothic cathedral, neon billboards, bleak palette'),
  builtin('inazuma', '稻妻', '国家与地区', 'Inazuma, Japanese fantasy shrine, torii gates, sakura petals, tiled roofs, violet twilight, island coastline', 'modern power lines, neon city, desert, western cathedral'),
  builtin('sumeru', '须弥', '国家与地区', 'Sumeru, lush rainforest, tree city, ornate sandstone architecture, hanging gardens, emerald foliage, warm filtered light', 'snowfield, industrial city, barren forest, neon signage'),
  builtin('desert', '须弥沙漠', '国家与地区', 'Sumeru desert, monumental sandstone ruins, golden dunes, ancient geometric carvings, oasis, clear dry light', 'dense rainforest, snow, modern buildings, muddy atmosphere'),
  builtin('fontaine', '枫丹', '国家与地区', 'Fontaine, elegant European fantasy city, fountains, ornate stone bridges, blue waterways, refined mechanical details', 'dusty desert, ruined shantytown, neon billboards, muddy water'),
  builtin('natlan', '纳塔', '国家与地区', 'Natlan, volcanic cliffs, colorful tribal fantasy motifs, rugged canyons, vibrant textiles, warm sunset', 'snowstorm, grey industrial skyline, gothic cathedral, washed out colors'),
  builtin('snezhnaya', '至冬', '国家与地区', 'Snezhnaya, snowy fantasy city, frosted palace, ornate winter architecture, ice crystals, warm windows, aurora sky', 'tropical palms, desert dunes, summer foliage, muddy snow'),
  builtin('dragonspine', '龙脊雪山', '国家与地区', 'Dragonspine, snow covered peaks, ancient frozen ruins, blue ice, drifting snow, cold moonlight', 'tropical plants, city billboards, warm desert, flat terrain'),
  builtin('chasm', '层岩巨渊', '国家与地区', 'The Chasm, vast rocky cavern, layered stone, glowing mineral veins, old mining platforms, deep atmospheric light', 'sunny city streets, tropical beach, flat lighting, featureless rock'),
];

/** Keep existing prose/weights byte-for-byte; de-duplicate only the additions. */
export function appendImagePromptFragments(existing: string, addition: string): string {
  const key = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set(splitImagePromptFragments(existing).map(key));
  const fresh = splitImagePromptFragments(addition).filter(value => {
    if (seen.has(key(value))) return false;
    seen.add(key(value)); return true;
  });
  if (!fresh.length) return existing;
  return existing + (existing.trim() ? /[,，;；\n]\s*$/.test(existing) ? ' ' : ', ' : '') + fresh.join(', ');
}

export function applyImagePromptSelection<T extends ImagePromptDraft>(draft: T, selection: ImagePromptSelection): T {
  return { ...draft,
    prompt: appendImagePromptFragments(draft.prompt, selection.positive ?? ''),
    negative: appendImagePromptFragments(draft.negative, selection.negative ?? ''),
    ...(draft.context ? { context: { ...draft.context,
      scenePrompt: appendImagePromptFragments(draft.context.scenePrompt, selection.positive ?? ''),
      sceneNegativePrompt: appendImagePromptFragments(draft.context.sceneNegativePrompt, selection.negative ?? ''),
    } } : {}),
  };
}

export function normalizeCustomImagePromptLibrary(value: unknown): ImagePromptSnippet[] {
  if (value === null || value === undefined) return [];
  const data = value as { version?: unknown; items?: unknown };
  if (data.version !== 1 || !Array.isArray(data.items)) throw new Error('提示词库格式无法识别，未覆盖原数据。');
  const seen = new Set<string>();
  return data.items.map(raw => {
    const item = raw as Partial<ImagePromptSnippet> | null;
    if (!item || typeof item.id !== 'string' || !item.id.startsWith('custom-') || seen.has(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 80
      || !IMAGE_PROMPT_CATEGORIES.includes(item.category as ImagePromptCategory)
      || typeof item.positive !== 'string' || typeof item.negative !== 'string'
      || !(item.positive.trim() || item.negative.trim())) throw new Error('自定义词组数据不完整，未覆盖原数据。');
    seen.add(item.id);
    return { id: item.id, name: item.name.trim(), category: item.category!, positive: item.positive.trim(), negative: item.negative.trim() };
  });
}
