import { useLayoutEffect, useRef, useState } from 'react';
import type { CourierPhotoComposerProps } from './CourierPhotoComposer';
import { resolveCourierPhotoTarget, readCourierPhotoContext, commitCourierPhotoToGame, sameCourierPhotoTarget, sanitizeCourierPhotoText } from '@/services/courierPhoto';
import { applyNovelAIRulePreset } from '@/utils/imagePromptRules';
import { readSourceImageCharacterFacts, formatImageCharacterFacts, imageCharacterSourceKey, type ImageCharacterFactInput } from '@/utils/imageCharacterFacts';
import { compactImagePrompts } from '@/utils/imagePromptCompaction';
import { buildImageCharacterEnglishConfig, prepareEnglishImagePrompts } from '@/services/imageCharacterEnglish';
import { globalImageTaskQueue } from '@/utils/imageTaskQueue';
import { runImageGenerationWithRetry } from '@/utils/imageGenerationRetry';
import { generateImage } from '@/services/ai/imageGeneration';
import { 创建相册图片条目 } from '@/utils/albumActions';
import type { 图片生成任务 } from '@/models/imageGeneration';
import { resolveReferenceImagesForGeneration } from '../GameSystems/album/referenceInjection';
import { generateTargets } from '../GameSystems/album/foundation';

function phoneCharacter(npc: ImageCharacterFactInput) {
  const facts = readSourceImageCharacterFacts(npc);
  const appearanceDetails = Object.fromEntries(Object.entries(facts.appearanceDetails ?? {}).flatMap(([key, fact]) => {
    const value = sanitizeCourierPhotoText(fact.value);
    return value ? [[key, { ...fact, value }]] : [];
  }));
  return { name: facts.name, visualPrompt: '', facts: { ...facts,
    name: sanitizeCourierPhotoText(facts.name), gender: sanitizeCourierPhotoText(facts.gender ?? ''),
    appearance: sanitizeCourierPhotoText(facts.appearance ?? ''), appearanceDetails,
    profileHeight: sanitizeCourierPhotoText(facts.profileHeight ?? ''), outfit: undefined } };
}
function createPreview(props: CourierPhotoComposerProps, description: string) {
  const resolved = resolveCourierPhotoTarget(props.courier, props.npcRecords, props.target.conversationId, props.target.messageId);
  if (!resolved) throw new Error('这条消息或联系人已不可用。');
  return compactImagePrompts({ prompt: `phone photo, ordinary non-explicit, scene location and action: ${sanitizeCourierPhotoText(description)}`,
    negative: 'explicit, nudity, text, UI, watermark', characters: [phoneCharacter(resolved.npc)] });
}

export function useCourierPhotoGeneration(props: CourierPhotoComposerProps) {
  const [openedTarget] = useState(props.target);
  const [name] = useState(() => props.npcRecords.find(npc => npc.id === openedTarget.npcId)?.姓名 ?? '角色');
  const [description, setDescription] = useState(() => readCourierPhotoContext(props.courier, props.target));
  const [draftRequirement, setDraftRequirement] = useState(() => sanitizeCourierPhotoText(readCourierPhotoContext(props.courier, props.target)));
  const [draftSourceKey, setDraftSourceKey] = useState(() => {
    const npc = props.npcRecords.find(item => item.id === props.target.npcId);
    return npc ? imageCharacterSourceKey(npc) : '';
  });
  const [draft, setDraft] = useState(() => {
    try { return { ...createPreview(props, readCourierPhotoContext(props.courier, props.target)), error: '' }; }
    catch (error) { return { prompt: '', negative: '', compacted: false, error: String(error instanceof Error ? error.message : error) }; }
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const latest = useRef(props);
  const mounted = useRef(false);
  const active = useRef<{ id: string; sessionId: number | null } | null>(null);
  const sessionId = props.getGameSessionId?.() ?? null;
  useLayoutEffect(() => { latest.current = props; });

  function updateTask(id: string, expectedSession: number | null, patch: Partial<图片生成任务>) {
    const current = latest.current;
    if ((current.getGameSessionId?.() ?? null) !== expectedSession) return;
    current.onAlbumChange(previous => (current.getGameSessionId?.() ?? null) === expectedSession
      ? { ...previous, tasks: previous.tasks.map(task => task.id === id ? { ...task, ...patch } : task) } : previous);
  }
  function cancel() {
    const task = active.current;
    active.current = null;
    if (task) {
      globalImageTaskQueue.cancel(task.id);
      updateTask(task.id, task.sessionId, { status: 'cancelled', error: '手机照片生成已取消。', finishedAt: Date.now() });
    }
  }
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
    // The modal keys the composer by conversation, message and session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, props.target.conversationId, props.target.messageId]);

  function isCurrent(id: string, expectedSession: number | null) {
    const current = latest.current;
    if (!mounted.current || active.current?.id !== id || (current.getGameSessionId?.() ?? null) !== expectedSession) return false;
    const resolved = resolveCourierPhotoTarget(current.courier, current.npcRecords, props.target.conversationId, props.target.messageId);
    return Boolean(resolved && sameCourierPhotoTarget(resolved.target, openedTarget));
  }
  const currentTarget = resolveCourierPhotoTarget(props.courier, props.npcRecords, openedTarget.conversationId, openedTarget.messageId)?.target;
  const targetValid = Boolean(currentTarget && sameCourierPhotoTarget(currentTarget, openedTarget) && sameCourierPhotoTarget(props.target, openedTarget));
  const currentRequirement = sanitizeCourierPhotoText(description);
  const currentNpc = props.npcRecords.find(item => item.id === openedTarget.npcId);
  const profileChanged = Boolean(currentNpc && imageCharacterSourceKey(currentNpc) !== draftSourceKey);
  const disabledReason = !targetValid ? '照片目标已变化，预览失效，请重新选择消息。' : profileChanged ? '角色资料已变化，请先更新提示词；原草稿仍保留。' : !props.imageSettings.enabled || !props.imageSettings.普通接口.enabled ? '文生图未开启，请先在设置中启用普通图片接口。' : !currentRequirement ? '请填写本次照片需求，再更新提示词。' : currentRequirement !== draftRequirement ? '照片需求已修改，请先更新提示词后再确认生成。' : '';

  function rebuild() {
    if (!targetValid) return;
    try { setDraft({ ...createPreview(latest.current, description), error: '' }); setDraftRequirement(currentRequirement);
      if (currentNpc) setDraftSourceKey(imageCharacterSourceKey(currentNpc)); setStatus(''); }
    catch (error) { setDraft(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) })); }
  }
  async function generate() {
    if (active.current || disabledReason || !draft.prompt.trim()) return;
    const current = latest.current;
    const resolved = resolveCourierPhotoTarget(current.courier, current.npcRecords, props.target.conversationId, props.target.messageId);
    if (!resolved) { setStatus('消息或联系人已移除，请重新选择。'); return; }
    const expectedSession = current.getGameSessionId?.() ?? null;
    const id = `phone_photo_${crypto.randomUUID()}`;
    const config = applyNovelAIRulePreset(current.imageSettings.普通接口, current.imageSettings.rules);
    try {
      // Re-protect real character facts after manual edits; use the exact previewed caption.
      const character = phoneCharacter(resolved.npc);
      let englishCharacters = [character];
      const caption = formatImageCharacterFacts(character.facts);
      let compacted = compactImagePrompts({ prompt: sanitizeCourierPhotoText(draft.prompt.replaceAll(caption, '')), negative: sanitizeCourierPhotoText(draft.negative), characters: [character] });
      const sourceFacts = JSON.stringify(character.facts);
      const sourceStillCurrent = () => {
        const liveNpc = latest.current.npcRecords.find(item => item.id === resolved.npc.id);
        return Boolean(liveNpc && JSON.stringify(phoneCharacter(liveNpc).facts) === sourceFacts);
      };
      setDraft({ ...compacted, error: '' });
      active.current = { id, sessionId: expectedSession }; setBusy(true); setStatus('等待图片生成队列…');
      const task: 图片生成任务 = { id, targetType: 'npc', targetId: resolved.npc.id, slot: 'misc', source: 'manual', status: 'queued', backend: config.backend,
        nsfw: false, prompt: compacted.prompt, negativePrompt: compacted.negative, sourcePrompt: description, retryCount: 0, createdAt: Date.now(), dimensions: config.defaultSize };
      current.onAlbumChange(previous => (current.getGameSessionId?.() ?? null) === expectedSession ? { ...previous, tasks: [task, ...previous.tasks] } : previous);
      const result = await globalImageTaskQueue.createRunner(async (_taskId, signal) => {
        if (!isCurrent(id, expectedSession)) throw new Error('会话或存档已变化，生成已取消。');
        updateTask(id, expectedSession, { status: 'running', startedAt: Date.now() });
        if (mounted.current) setStatus('正在准备角色英文生图资料…');
        const prepared = await prepareEnglishImagePrompts({ ...compacted, characters: [character] }, buildImageCharacterEnglishConfig(current.imageSettings, current.apiSettings), signal);
        compacted = prepared;
        englishCharacters = prepared.characters as typeof englishCharacters;
        if (!isCurrent(id, expectedSession) || !sourceStillCurrent()) throw new Error('角色资料或存档已变化，请重新打开照片预览。');
        updateTask(id, expectedSession, { prompt: compacted.prompt, negativePrompt: compacted.negative });
        if (mounted.current) setDraft({ ...compacted, error: '' });
        if (mounted.current) setStatus('正在生成照片…');
        // Ordinary photos may not consume private image reference assets.
        const safeAlbum = { ...latest.current.album, entries: latest.current.album.entries.filter(entry => !entry.nsfw), assets: latest.current.album.assets.filter(asset => !asset.nsfw) };
        const references = resolveReferenceImagesForGeneration({ target: generateTargets.find(target => target.id === 'npc_portrait')!, targetId: resolved.npc.id,
          api: config, settings: current.imageSettings.参考图, album: safeAlbum, assetMap: new Map(safeAlbum.assets.map(asset => [asset.id, asset])) });
        return runImageGenerationWithRetry(() => {
          if (!isCurrent(id, expectedSession) || !sourceStillCurrent()) throw Object.assign(new Error('角色资料、会话或存档已变化。'), { retryable: false });
          return generateImage(config, { prompt: compacted.prompt, negativePrompt: compacted.negative, nsfw: false, size: config.defaultSize,
            referenceImages: references.images, referenceStrength: current.imageSettings.参考图.sdWebuiDenoisingStrength, signal, protectedCharacters: englishCharacters });
        }, { signal, maxRetries: config.retryCount ?? current.imageSettings.最大重试次数 ?? 2,
          onRetry: attempt => updateTask(id, expectedSession, { retryCount: attempt }) });
      })(id);
      if (!isCurrent(id, expectedSession) || !sourceStillCurrent()) {
        updateTask(id, expectedSession, { status: 'cancelled', error: '目标已变化，照片结果未写入。', finishedAt: Date.now() });
        if (mounted.current) setStatus('目标已变化，照片结果未写入，请关闭预览后重新选择。');
        return;
      }
      if (result.status !== 'success' || !result.value) throw new Error(result.error || '图片生成失败，请重试。');
      const value = result.value;
      const image = 创建相册图片条目({ title: `${resolved.npc.姓名} · 手机照片`, src: value.src, originalUrl: value.originalUrl, source: 'generated', nsfw: false,
        targetType: 'npc', targetId: resolved.npc.id, slot: 'misc', tags: ['手机照片'], mimeType: value.mimeType, prompt: compacted.prompt, negativePrompt: compacted.negative,
        finalPrompt: value.finalPrompt, finalNegativePrompt: value.finalNegativePrompt, dimensions: config.defaultSize, model: value.model, backend: value.backend,
        note: `会话 ${props.target.conversationId} · 回合 ${props.target.turn}` });
      // A synchronous root CAS acknowledgement prevents a rejected commit from looking successful.
      active.current = null;
      const accepted = current.onCommitPhoto(game => {
        const npc = game.NPC.find(item => item.id === resolved.npc.id);
        if (!npc) return game;
        const source = phoneCharacter({ 姓名: npc.姓名, 别名: npc.aliases[0], 性别: npc.gender,
          外貌: npc.appearance, 外貌档案: npc.appearanceFacts, 穿着: npc.clothing, 介绍: npc.说明, 备注: npc.notes,
          NSFW档案: npc.matureArchive ? { 年龄确认: npc.matureArchive.ageConfirmation, 年龄确认来源: npc.matureArchive.ageConfirmationSource } as ImageCharacterFactInput['NSFW档案'] : undefined });
        return JSON.stringify(source.facts) === sourceFacts ? commitCourierPhotoToGame(game, openedTarget, image, id) : game;
      }, expectedSession);
      if (!accepted) {
        updateTask(id, expectedSession, { status: 'cancelled', error: '目标已变化，照片结果未写入。', finishedAt: Date.now() });
        if (mounted.current) setStatus('目标已变化，照片结果未写入，请重新选择。');
        return;
      }
      current.onClose();
    } catch (error) {
      if ((!active.current || active.current.id === id) && mounted.current) {
        const message = error instanceof Error ? error.message : String(error);
        if (active.current) updateTask(id, expectedSession, { status: 'failed', error: message, finishedAt: Date.now() });
        setStatus(`生成失败：${message}`);
      }
    } finally {
      if (active.current?.id === id) active.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return { name, description, setDescription, draft, setDraft, busy, status, disabledReason, rebuild, generate,
    close: () => { cancel(); props.onClose(); } };
}
