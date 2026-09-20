import { describe, expect, it } from 'vitest';
import {
  attachNpcLedgerUpdateDebug,
  buildNpcLedgerUpdateDebug,
  formatCodexRecallSummary,
  formatIrminsulRecallSummary,
} from '../../hooks/useGame/turnDebugContext';
import type { 聊天消息 } from '../../models/chat';

describe('turnDebugContext', () => {
  it('formats the recalled archive names and removes duplicate memory labels', () => {
    const codexSummary = formatCodexRecallSummary({
      entries: [
        {
          id: 'amber',
          category: '角色',
          name: '安柏',
          description: '',
          unlockedAtTurn: 1,
          tags: [],
          summary: '',
          sourceText: '',
          source: 'builtin',
          keywords: [],
          triggerKeywords: [],
          injection: {},
          runtimeUnlock: { status: 'unlocked', note: '' },
          usage: { narrative: true, courier: true, steambird: true, variables: true },
          relatedEntryIds: [],
          importance: 1,
          linkable: true,
          builtin: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      injection: '侦察骑士安柏',
    });

    expect(codexSummary).toBe('图鉴召回：安柏');
    expect(formatIrminsulRecallSummary('强回忆:风龙废墟|弱回忆：风龙废墟\n璃月港')).toBe(
      '记忆召回：风龙废墟，璃月港',
    );
  });

  it('aggregates successful NPC ledger updates without duplicating the same field', () => {
    const command = { action: 'set' as const, key: 'NPC[id=lisa].最近互动', value: '一起喝下午茶' };
    const update = buildNpcLedgerUpdateDebug({
      facts: [{
        type: 'npc',
        id: 'lisa',
        name: '丽莎',
        memory: '约好明天下午喝茶',
        recentInteraction: '一起喝下午茶',
      }],
      commands: [command],
      results: [{ command, ok: true }],
      warnings: ['已忽略一条无效变量'],
      summaryTriggeredNames: ['丽莎'],
    });

    expect(update).toEqual({
      updatedNames: ['丽莎'],
      memoryAppended: ['丽莎：约好明天下午喝茶'],
      ledgerFieldsUpdated: ['丽莎：最近互动'],
      summaryTriggered: ['丽莎'],
      warnings: ['已忽略一条无效变量'],
    });
  });

  it('attaches ledger diagnostics only to the matching message with an existing debug context', () => {
    const history: 聊天消息[] = [
      { id: 'user', role: 'user', content: '你好', timestamp: 1 },
      {
        id: 'assistant',
        role: 'assistant',
        content: '下午好。',
        timestamp: 2,
        debugContext: { systemPrompt: 'prompt', messages: [] },
      },
    ];
    const update = {
      updatedNames: ['丽莎'],
      memoryAppended: [],
      ledgerFieldsUpdated: ['丽莎：最近互动'],
      summaryTriggered: [],
      warnings: [],
    };

    const next = attachNpcLedgerUpdateDebug(history, 'assistant', update);

    expect(next[0]).toBe(history[0]);
    expect(next[1]?.debugContext?.npcLedgerUpdate).toEqual(update);
    expect(history[1]?.debugContext?.npcLedgerUpdate).toBeUndefined();
  });
});
