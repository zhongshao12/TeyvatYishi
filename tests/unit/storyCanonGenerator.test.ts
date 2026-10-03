import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('canonical story generator read-only verification', () => {
  it.each(['missing scene', 'changed prose'])('rejects %s without rewriting any input', (change) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-canon-check-'));
    const target = path.join(dir, 'total.json');
    const sources = path.resolve('public/data/story-weaving-canon');
    const system = JSON.parse(fs.readFileSync('data/storyWeavingCanonDecomposed.json', 'utf8'));
    system.系列列表 = system.系列列表.map((series: { id: string }) => JSON.parse(fs.readFileSync(path.join(sources, `${series.id}.json`), 'utf8')));
    const segment = system.系列列表[0].分段列表[0];
    if (change === 'changed prose') segment.原文内容 = '被损坏的正文';
    else segment.场景节点.pop();
    fs.writeFileSync(target, JSON.stringify(system));
    const before = fs.readFileSync(target);
    const sourceBytes = fs.readdirSync(sources).map(name => [name, fs.readFileSync(path.join(sources, name))] as const);
    try {
      const result = spawnSync(process.execPath, ['scripts/generate-story-weaving-canon-total.mjs', '--check', '--target', target], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('剧情资源漂移');
      expect(fs.readFileSync(target)).toEqual(before);
      for (const [name, bytes] of sourceBytes) expect(fs.readFileSync(path.join(sources, name))).toEqual(bytes);
    } finally { fs.rmSync(dir, { recursive: true }); }
  });
});
