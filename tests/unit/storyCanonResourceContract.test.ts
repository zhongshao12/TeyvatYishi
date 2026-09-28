import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { 归一化剧情编织系列 } from '@/models/storyWeaving';
import { validateBundledStorySeries } from '@/data/storyCanonValidation';
import { bundledStoryWeavingPresets, loadBundledStoryWeavingPreset } from '@/data/storyWeavingPreset';

const resourceDirectory = join(process.cwd(), 'public', 'data', 'story-weaving-canon');
const allBundledFiles = readdirSync(resourceDirectory).filter((name) => name.endsWith('.json'));
const mainlineFiles = readdirSync(resourceDirectory)
  .filter((name) => name.startsWith('story_canon_teyvat_') && name.endsWith('.json') && !name.includes('nodkrai'));

describe('bundled six-nation story resource contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every bundled series loadable through the shared validator', () => {
    for (const fileName of allBundledFiles) {
      const raw = JSON.parse(readFileSync(join(resourceDirectory, fileName), 'utf8'));
      expect(validateBundledStorySeries(raw), fileName).toEqual([]);
    }
  });

  it('retains named events and role progression after runtime normalization', () => {
    expect(mainlineFiles).toHaveLength(15);
    for (const fileName of mainlineFiles) {
      const raw = JSON.parse(readFileSync(join(resourceDirectory, fileName), 'utf8'));
      expect(validateBundledStorySeries(raw), fileName).toEqual([]);
      const series = 归一化剧情编织系列(raw);
      expect(series.分段列表.flatMap((segment) => segment.关键事件), fileName).not.toHaveLength(0);
      expect(series.分段列表.flatMap((segment) => segment.角色推进), fileName).not.toHaveLength(0);
    }
  });

  it('rejects malformed events, role names and duplicate segment IDs', () => {
    const raw = JSON.parse(readFileSync(join(resourceDirectory, mainlineFiles[0]!), 'utf8'));
    raw.分段列表[0].关键事件 = [{ 事件名: '', 事件结果: [] }];
    raw.分段列表[0].角色推进 = [{ 角色名: '', 本段变化: ['变化'] }];
    raw.分段列表.push({ ...raw.分段列表[0] });
    const issues = validateBundledStorySeries(raw);
    expect(issues.some((issue) => issue.includes('事件名'))).toBe(true);
    expect(issues.some((issue) => issue.includes('事件结果'))).toBe(true);
    expect(issues.some((issue) => issue.includes('角色名'))).toBe(true);
    expect(issues.some((issue) => issue.includes('重复分段 ID'))).toBe(true);
  });

  it('does not silently load a bundled series whose event name was lost', async () => {
    const raw = JSON.parse(readFileSync(join(resourceDirectory, mainlineFiles[0]!), 'utf8'));
    raw.分段列表[0].关键事件[0].事件名 = '';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(raw), { status: 200 }));
    const preset = bundledStoryWeavingPresets.find((item) => item.id === raw.id)!;
    await expect(loadBundledStoryWeavingPreset(preset))
      .rejects.toThrow(/事件名/u);
  });

  it('rejects duplicate or incomplete canonical scene nodes', () => {
    const raw = JSON.parse(readFileSync(join(resourceDirectory, mainlineFiles[0]!), 'utf8'));
    raw.分段列表[0].场景节点 = [
      { id: 'same-scene', 标题: '开场', 地点: '蒙德', 参与角色: ['安柏'], 目标: '', 完成证据: [], 可偏离切口: [], 开场事实: [], 完成后事实: [] },
      { id: 'same-scene', 标题: '重号', 地点: '蒙德', 参与角色: ['安柏'], 目标: '继续', 完成证据: ['完成'], 可偏离切口: ['折返'], 开场事实: [], 完成后事实: [] },
    ];
    const issues = validateBundledStorySeries(raw);
    expect(issues.some((issue) => issue.includes('重复场景 ID'))).toBe(true);
    expect(issues.some((issue) => issue.includes('目标'))).toBe(true);
    expect(issues.some((issue) => issue.includes('完成证据'))).toBe(true);
  });
});
