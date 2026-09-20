import { describe, expect, it } from 'vitest';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { normalizeIrminsulMemory } from '@/models/teyvat/irminsul';
import { retrieveCodexEntries } from '@/services/codexRetrieval';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';

function codexEntry(id: string, name: string, keywords: string[], tags: string[] = []) {
  return {
    id,
    category: 'lore',
    name,
    description: `${name}的公开资料`,
    summary: `${name}摘要`,
    sourceText: `${name}正文`,
    keywords,
    tags,
    triggerKeywords: keywords,
    runtimeUnlock: { status: 'unlocked', note: '测试' },
    injection: { publicText: `${name}注入` },
    usage: { narrative: true },
    relatedEntryIds: [],
  };
}

describe('Chinese retrieval behavior', () => {
  it('does not inject arbitrary Codex entries for an empty query', () => {
    const codex = normalizeArchiveCodex({
      entries: [codexEntry('mondstadt', '蒙德城', ['蒙德'])],
      unlockedEntryIds: ['mondstadt'],
    });

    expect(retrieveCodexEntries(codex, '   \n ', 5)).toEqual({ entries: [], injection: '' });
  });

  it('recalls a Codex entry from the labeled natural-language query used by the turn workflow', () => {
    const codex = normalizeArchiveCodex({
      entries: [
        codexEntry('knights', '西风骑士团', ['骑士团', '琴'], ['蒙德']),
        codexEntry('liyue', '璃月港', ['总务司'], ['璃月']),
      ],
      unlockedEntryIds: ['knights', 'liyue'],
    });
    const query = [
      '玩家当前输入：我想去骑士团找琴问问龙灾的事。',
      '当前地点：蒙德城',
      '当前相关人物：安柏',
    ].join('\n');

    expect(retrieveCodexEntries(codex, query, 5).entries.map((entry) => entry.id)).toEqual(['knights']);
  });

  it('ranks entries with more matching evidence before weaker matches', () => {
    const codex = normalizeArchiveCodex({
      entries: [
        codexEntry('mondstadt', '蒙德城', ['蒙德'], ['蒙德']),
        codexEntry('knights', '西风骑士团', ['骑士团', '安柏'], ['蒙德']),
      ],
      unlockedEntryIds: ['mondstadt', 'knights'],
    });

    expect(retrieveCodexEntries(codex, '蒙德的骑士团里有安柏吗？', 5).entries.map((entry) => entry.id))
      .toEqual(['knights', 'mondstadt']);
  });

  it('recalls Irminsul memories from labeled Chinese narrative queries', () => {
    const memory = normalizeIrminsulMemory({
      entries: [
        {
          id: 'amber-arrival',
          title: '初到蒙德',
          summary: '安柏带旅行者进入蒙德城。',
          sourceText: '侦察骑士安柏一路护送旅行者。',
          keywords: ['安柏', '蒙德'],
          sourceTurns: [3],
        },
        {
          id: 'liyue-meal',
          title: '璃月晚餐',
          summary: '在万民堂吃饭。',
          sourceText: '香菱准备了晚餐。',
          keywords: ['璃月', '香菱'],
          sourceTurns: [8],
        },
      ],
    });
    const query = [
      '玩家当前输入：我想问安柏第一次带我进入蒙德城时发生了什么。',
      '当前地点：蒙德城',
    ].join('\n');

    expect(retrieveIrminsulEntries(memory, query, 5).map((entry) => entry.id)).toEqual(['amber-arrival']);
  });
});
