import type { 世界书, 世界书导出数据 } from '@/models/worldbook';
import { normalizeWorldbooks } from '@/utils/worldbook';
import { markContentResourceFailed, markContentResourceLoading, markContentResourceReady } from '@/services/contentResourceStatus';

// 第二波起，「随包预设」改由 data/builtinWorldbookConfig.ts 直接生成内置世界书，
// 不再通过 fetch 拉 public 下的 json。本文件保留 fetch 加载工具函数与类型,
// 以便未来「玩家手动从 URL 导入」复用同一管线。

export interface BundledWorldbookPreset {
  id: string;
  title: string;
  description: string;
  path: string;
}

// 显式置空：当前没有自动拉取的 preset。
export const bundledWorldbookPresets: BundledWorldbookPreset[] = [];

export async function loadBundledWorldbookPreset(
  preset: BundledWorldbookPreset,
): Promise<世界书[]> {
  const resourceId = `worldbook:${preset.id}`;
  markContentResourceLoading(resourceId, 'fetch');
  let response: Response;
  try {
    response = await fetch(preset.path, { cache: 'no-store' });
  } catch {
    throw markContentResourceFailed(resourceId, 'fetch', '请检查本地资源是否完整，然后刷新页面重试。');
  }
  if (!response.ok) {
    throw markContentResourceFailed(resourceId, 'fetch', `资源请求返回 HTTP ${response.status}，请检查安装文件后刷新页面。`);
  }
  markContentResourceLoading(resourceId, 'parse');
  let data: 世界书导出数据;
  try {
    data = (await response.json()) as 世界书导出数据;
  } catch {
    throw markContentResourceFailed(resourceId, 'parse', '资源文件不是有效 JSON，请检查安装文件后刷新页面。');
  }
  if (!data || !Array.isArray(data.books)) {
    throw markContentResourceFailed(resourceId, 'parse', '世界书资源缺少 books 列表，请检查安装文件后刷新页面。');
  }
  markContentResourceLoading(resourceId, 'normalize');
  try {
    const books = normalizeWorldbooks(data.books);
    markContentResourceReady(resourceId);
    return books;
  } catch {
    throw markContentResourceFailed(resourceId, 'normalize', '世界书内容结构异常，请检查安装文件后刷新页面。');
  }
}

export async function loadAllBundledWorldbookPresets(): Promise<世界书[]> {
  if (!bundledWorldbookPresets.length) return [];
  const payloads = await Promise.all(
    bundledWorldbookPresets.map((preset) => loadBundledWorldbookPreset(preset)),
  );
  return payloads.flat();
}

