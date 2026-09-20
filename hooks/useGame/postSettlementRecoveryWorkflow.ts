import { applyLegacyGameStateOverrides, toLegacyTurnCheckpoint, type UseGameStateReturn } from '@/hooks/useGameState';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { saveGame } from '@/services/dbService';
import { buildIrminsulArchiveEntry } from '@/services/irminsulArchive';
import { deriveCommittedQuestArchiveFacts } from '@/services/questService';
import type { WorkflowRecoveryJournal } from '@/services/workflowRecovery';
import { archiveCommittedQuestSettlement } from './questWorkflow';
import { buildFallbackCourierSeed } from './courierBackgroundJobs';
import { processScheduledCourierSeeds } from './courierWorkflow';
import { mergeIrminsulMemories } from './postTurnIrminsulTask';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';
import { runSteambirdGenerationStep } from './steambirdWorkflow';

/**
 * Idempotent work after the settlement boundary. This module is lazy-loaded
 * only after an interrupted committed turn needs recovery.
 */
export async function runPostSettlementRecoveryWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
  committedOverride?: TeyvatGameState,
): Promise<void> {
  if (journal.phase !== 'settlement_committed') return;
  const committed = normalizeTeyvatGameState(committedOverride ?? journal.committedState ?? state.game);
  const committedHistory = committed.对话.entries;
  const assistant = journal.assistantMessageId
    ? committedHistory.find((message) => message.id === journal.assistantMessageId && message.role === 'assistant')
    : [...committedHistory].reverse().find((message) => message.role === 'assistant');
  const body = assistant
    ? (assistant.structuredResponse ? narrativeTurnBodyText(assistant.structuredResponse) : assistant.content.trim())
    : '';
  const assistantIndex = assistant ? committedHistory.findIndex((message) => message.id === assistant.id) : -1;
  const userInput = assistantIndex >= 0
    ? [...committedHistory.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')?.content.trim() || journal.input
    : journal.input;
  const turn = committed.turnCount;
  const stableNow = journal.startedAt;

  let steambird = committed.蒸汽鸟报;
  const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
  const interval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
  const sourceBody = `${userInput}\n${body}`.trim();
  const shouldRunSteambird = Boolean(
    body && steambirdSettings?.enabled && steambirdSettings.autoGenerate && (turn === 1 || turn % interval === 0),
  );
  const steambirdAlreadyApplied = steambird.articles.some((article) =>
    article.turn === turn && article.body.trim() === sourceBody);
  if (shouldRunSteambird && !steambirdAlreadyApplied) {
    const result = runSteambirdGenerationStep({
      current: steambird,
      publicFacts: [{ title: `第 ${turn} 回公开见闻`, detail: sourceBody }],
      turnCount: turn,
      now: stableNow,
    });
    if (result?.changed) steambird = result.steambird;
  }

  let irminsul = committed.世界树;
  const archiveExists = irminsul.entries.some((entry) => entry.turn === turn && entry.sourceText.trim() === body.trim());
  if (body && !archiveExists) {
    irminsul = mergeIrminsulMemories(irminsul, { entries: [buildIrminsulArchiveEntry({
      id: `irminsul_recovery_${journal.workflowId}`,
      title: `第 ${turn} 回记忆`,
      summary: assistant?.structuredResponse?.continuation.summary || body.slice(0, 360),
      sourceTurns: [turn],
      keywords: [
        committed.世界.当前地点,
        ...(assistant?.structuredResponse?.factCandidates ?? [])
          .filter((candidate) => candidate.domain === 'world')
          .map((candidate) => candidate.fact),
      ].filter((item): item is string => Boolean(item)).slice(0, 8),
      recordedAt: committed.世界.当前日期 || String(turn),
      archiveType: 'short',
      sourceText: body,
      turn,
    })] });
  }
  const questFacts = deriveCommittedQuestArchiveFacts(
    committed,
    assistant?.structuredResponse?.factCandidates
      .filter((candidate) => candidate.domain === 'quest')
      .map((candidate) => candidate.fact) ?? [],
    turn,
  );
  irminsul = archiveCommittedQuestSettlement(irminsul, committed, questFacts, turn);

  const legacy = toLegacyTurnCheckpoint({
    turnCount: committed.turnCount,
    pendingOpeningTrigger: null,
    traveler: committed.旅行者,
    npc: committed.NPC,
    album: committed.相册,
  });
  const traveler = legacy.旅人 as UseGameStateReturn['旅人'];
  const npcs = legacy.NPC as UseGameStateReturn['NPC'];
  const committedAlbum = legacy.相册 as UseGameStateReturn['相册'];
  let courier = processScheduledCourierSeeds(committed.手机, turn, stableNow).next;
  if (state.gameSettings.手机系统.enabled && state.gameSettings.手机系统.autoGenerateSeeds) {
    const fallbackSeed = buildFallbackCourierSeed({
      courier,
      npcs,
      turn,
      userInput,
      body,
      maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
      contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
    });
    if (fallbackSeed) {
      courier = {
        ...courier,
        deliverySeeds: [...courier.deliverySeeds, fallbackSeed],
        unreadTotal: courier.unreadTotal + 1,
      };
    }
  }

  let backgroundState = normalizeTeyvatGameState({
    ...committed,
    蒸汽鸟报: steambird,
    世界树: irminsul,
    手机: courier,
  });
  let conversation = committedHistory;
  let album = committedAlbum;
  const narrativeSettings = state.gameSettings.文生图系统?.正文生图;
  const alreadyHasImage = Boolean(assistant?.narrativeImages?.some((image) => image.status === 'done'));
  if (assistant && body && narrativeSettings?.enabled && narrativeSettings.mode === 'auto' && !alreadyHasImage) {
    const activeConfig = state.apiSettings.configs.find((config) => config.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0]
      ?? null;
    const imageWorkflow = await import('./narrativeImageWorkflow');
    const imageApiConfig = imageWorkflow.resolveNarrativeImageGenerationApi(state);
    if (imageApiConfig) {
      const generatedImages = await imageWorkflow.generateNarrativeImagesForMessage({
        state,
        messageId: assistant.id,
        body,
        tokenizerConfig: imageWorkflow.resolveNarrativeImageTokenizerConfig(state, activeConfig),
        imageApiConfig,
        turn,
        domainContext: {
          旅人: traveler,
          NPC: npcs,
          相册: album,
          onAlbumChange: (next) => { album = next; },
        },
        writeDomainState: false,
      });
      if (generatedImages?.length) {
        conversation = conversation.map((message) => message.id === assistant.id
          ? { ...message, narrativeImages: [...(message.narrativeImages ?? []), ...generatedImages] }
          : message);
      }
    }
  }
  backgroundState = applyLegacyGameStateOverrides({
    ...backgroundState,
    对话: { entries: conversation },
  }, { 相册: album });
  state.replaceGameState(backgroundState);

  const saveData = buildSavePayload(state, 'auto', undefined, backgroundState);
  await saveGame(saveData);
  commitActiveSaveTreeMeta(saveData);
  state.setHasSave(true);
}
