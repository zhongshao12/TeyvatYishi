import { useLayoutEffect, useRef, useState } from 'react';
import type { API设置, 文生图系统设置 } from '@/models/settings';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import type { 相册系统, 图片生成任务 } from '@/models/imageGeneration';
import { MAX_MOMENT_IMAGES, type CourierMomentImage } from '@/models/teyvat/courier';
import type { TeyvatGameState } from '@/models/teyvat/state';
import type { CourierPhotoComposerProps } from './CourierPhotoComposer';
import { prepareEnglishImagePrompts, buildImageCharacterEnglishConfig } from '@/services/imageCharacterEnglish';
import { readImageCharacterFacts, readSourceImageCharacterFacts, type ImageCharacterFactInput } from '@/utils/imageCharacterFacts';
import { omitNpcAppearanceMeasurements } from '@/utils/npcAppearanceReconciliation';
import type { PromptCharacter } from '@/utils/imagePromptCompaction';
import { applyNovelAIRulePreset } from '@/utils/imagePromptRules';
import { generateImage } from '@/services/ai/imageGeneration';
import { sanitizeCourierPhotoText } from '@/services/courierPhoto';
import { commitMomentDraftImage, resolveMomentImage } from '@/services/courierMomentImages';
import { globalImageTaskQueue } from '@/utils/imageTaskQueue';
import { runImageGenerationWithRetry } from '@/utils/imageGenerationRetry';
import { 创建相册图片条目, fileToDataUrl } from '@/utils/albumActions';
import { hashDataUrl } from '../GameSystems/album/albumContent';

export interface CourierMomentImageTools {
  album: 相册系统;
  imageSettings: 文生图系统设置;
  apiSettings?: API设置;
  traveler?: 角色数据结构;
  npcRecords: NPC记录[];
  getGameSessionId?: () => number;
  onAlbumChange: CourierPhotoComposerProps['onAlbumChange'];
  onCommitPhoto: CourierPhotoComposerProps['onCommitPhoto'];
}
export interface CourierMomentImageEditorProps {
  tools: CourierMomentImageTools;
  images: readonly CourierMomentImage[];
  onChange: (images: CourierMomentImage[]) => void;
  onBusyChange?: (busy: boolean) => void;
  editing?: { id: string; revision: number };
}

function ordinaryCharacter(source: ImageCharacterFactInput): PromptCharacter {
  // Do not feed relationship, memories, private archives or an inferred outfit to the image model.
  const allowed = readSourceImageCharacterFacts({ 姓名: source.姓名, 性别: source.性别, 外貌: source.外貌,
    外貌档案: source.外貌档案, 身高: source.身高 });
  const facts = readImageCharacterFacts(source);
  const appearanceDetails = Object.fromEntries(Object.entries(facts.appearanceDetails ?? {}).filter(([key]) => Object.hasOwn(allowed.appearanceDetails ?? {}, key)));
  return { name: facts.name, visualPrompt: '', facts: { ...facts, outfit: undefined, appearanceDetails,
    appearance: sanitizeCourierPhotoText(allowed.appearanceDetails?.三围 ? facts.appearance ?? '' : omitNpcAppearanceMeasurements(facts.appearance ?? '')) || undefined } };
}

export function useCourierMomentImages(props: CourierMomentImageEditorProps) {
  const [mode, setMode] = useState<'none' | 'album' | 'generate'>('none');
  const [draft, setDraft] = useState({ prompt: '', negative: 'explicit, nudity, text, UI, watermark' });
  const [characterId, setCharacterId] = useState('scene');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const latest = useRef(props);
  const mounted = useRef(false);
  const active = useRef<{ id: string; sessionId: number | null; kind: 'generate' | 'upload' } | null>(null);
  const session = props.tools.getGameSessionId?.() ?? null;
  useLayoutEffect(() => { latest.current = props; });

  function updateTask(id: string, expected: number | null, patch: Partial<图片生成任务>) {
    const current = latest.current.tools;
    if ((current.getGameSessionId?.() ?? null) !== expected) return;
    current.onAlbumChange(previous => (current.getGameSessionId?.() ?? null) !== expected ? previous : {
      ...previous, tasks: previous.tasks.map(task => task.id === id ? { ...task, ...patch } : task),
    });
  }
  function cancel() {
    const operation = active.current; active.current = null;
    if (operation?.kind === 'generate') {
      globalImageTaskQueue.cancel(operation.id);
      updateTask(operation.id, operation.sessionId, { status: 'cancelled', error: '朋友圈配图生成已取消。', finishedAt: Date.now() });
    }
  }
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
    // The panel also keys each edit target by revision and session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, props.editing?.id, props.editing?.revision]);
  function isCurrent(id: string, expected: number | null) {
    return mounted.current && active.current?.id === id && (latest.current.tools.getGameSessionId?.() ?? null) === expected;
  }
  function setWorking(value: boolean) { setBusy(value); latest.current.onBusyChange?.(value); }
  function addReference(reference: CourierMomentImage) {
    const current = latest.current;
    if (current.images.length >= MAX_MOMENT_IMAGES || current.images.some(image => image.assetId === reference.assetId)) return false;
    current.onChange([...current.images, reference]); return true;
  }
  function commitImage(image: Parameters<typeof commitMomentDraftImage>[1], id: string, expected: number | null, publicCaption: string, taskId?: string, rootSourceStillCurrent?: (game: TeyvatGameState) => boolean) {
    if (!isCurrent(id, expected)) return false;
    let reference: CourierMomentImage | undefined;
    const accepted = latest.current.tools.onCommitPhoto(game => {
      if (!isCurrent(id, expected) || rootSourceStillCurrent?.(game) === false) return game;
      const committed = commitMomentDraftImage(game, image, { taskId, caption: publicCaption, editing: latest.current.editing });
      reference = committed.reference;
      return committed.game;
    }, expected);
    if (!accepted || !reference || !isCurrent(id, expected)) throw new Error('存档或动态已变化，图片结果未写入，请重新选择。');
    addReference(reference); return true;
  }
  async function upload(files: FileList | null) {
    if (active.current || !files?.length || props.images.length >= MAX_MOMENT_IMAGES) return;
    const file = files[0];
    if (!file?.type.startsWith('image/')) { setStatus('请上传图片文件。'); return; }
    const id = `moment_upload_${crypto.randomUUID()}`;
    const expected = props.tools.getGameSessionId?.() ?? null;
    active.current = { id, sessionId: expected, kind: 'upload' }; setWorking(true); setStatus('正在读取图片…');
    try {
      const src = await fileToDataUrl(file);
      if (!isCurrent(id, expected)) return;
      const contentHash = await hashDataUrl(src);
      if (!isCurrent(id, expected)) return;
      const image = 创建相册图片条目({ title: file.name, src, source: 'upload', nsfw: false, targetType: 'phone', slot: 'misc',
        mimeType: file.type, contentHash, tags: ['朋友圈'], note: '朋友圈手动上传' });
      if (commitImage(image, id, expected, caption)) setStatus('图片已收入相册并加入草稿；点击发布后朋友才能看到。');
    } catch (error) {
      if (isCurrent(id, expected)) setStatus(`上传失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (active.current?.id === id) { active.current = null; if (mounted.current) setWorking(false); }
    }
  }
  const disabledReason = !props.tools.imageSettings.enabled || !props.tools.imageSettings.普通接口.enabled
    ? '文生图未开启，请先在设置中启用普通图片接口。' : props.images.length >= MAX_MOMENT_IMAGES ? '每条动态最多 9 张配图。' : '';
  async function generate() {
    if (active.current || disabledReason || !draft.prompt.trim()) return;
    const current = latest.current.tools;
    const expected = current.getGameSessionId?.() ?? null;
    const id = `moment_image_${crypto.randomUUID()}`;
    const publicCaption = caption;
    const source = characterId === 'traveler' ? current.traveler : current.npcRecords.find(npc => npc.id === characterId);
    if (characterId !== 'scene' && !source) { setStatus('所选角色已不可用，请重新选择。'); return; }
    const characters = source ? [ordinaryCharacter(source)] : [];
    const sourceId = source?.id;
    const sourceFingerprint = JSON.stringify(characters[0]?.facts ?? null);
    const sourceStillCurrent = () => {
      if (characterId === 'scene') return true;
      const tools = latest.current.tools;
      const liveSource = characterId === 'traveler' ? tools.traveler : tools.npcRecords.find(npc => npc.id === characterId);
      return Boolean(liveSource && liveSource.id === sourceId && JSON.stringify(ordinaryCharacter(liveSource).facts) === sourceFingerprint);
    };
    const rootSourceStillCurrent = (game: TeyvatGameState) => {
      if (characterId === 'scene') return true;
      // The transaction's root can be newer than React props. Compare the same public
      // fact projection against that root immediately before writing the album asset.
      const npc = characterId === 'traveler' ? undefined : game.NPC.find(record => record.id === characterId);
      const liveSource = characterId === 'traveler' ? game.旅行者 : npc ? {
        id: npc.id, 姓名: npc.姓名, 别名: npc.aliases[0], 性别: npc.gender, 外貌: npc.appearance, 外貌档案: npc.appearanceFacts,
        穿着: npc.clothing, 介绍: npc.说明, 备注: npc.notes, 图像档案: { englishFacts: npc.visualArchive.englishFacts },
        NSFW档案: npc.matureArchive ? { 年龄确认: npc.matureArchive.ageConfirmation, 年龄确认来源: npc.matureArchive.ageConfirmationSource } : undefined,
      } : undefined;
      return Boolean(liveSource && liveSource.id === sourceId && JSON.stringify(ordinaryCharacter(liveSource).facts) === sourceFingerprint);
    };
    const assertSourceCurrent = () => {
      if (!sourceStillCurrent()) throw Object.assign(new Error('角色姓名或外貌已变化，旧图片结果未写入。原草稿已保留，请重新确认生成。'), { retryable: false });
    };
    const config = applyNovelAIRulePreset(current.imageSettings.普通接口, current.imageSettings.rules);
    active.current = { id, sessionId: expected, kind: 'generate' }; setWorking(true); setStatus('等待图片生成队列…');
    const task: 图片生成任务 = { id, targetType: 'phone', slot: 'misc', source: 'manual', status: 'queued', backend: config.backend,
      nsfw: false, prompt: draft.prompt, negativePrompt: draft.negative, retryCount: 0, createdAt: Date.now(), dimensions: config.defaultSize };
    current.onAlbumChange(previous => (current.getGameSessionId?.() ?? null) !== expected ? previous : { ...previous, tasks: [task, ...previous.tasks] });
    try {
      const result = await globalImageTaskQueue.createRunner(async (_taskId, signal) => {
        if (!isCurrent(id, expected)) throw new Error('存档已变化，生成已取消。');
        assertSourceCurrent();
        updateTask(id, expected, { status: 'running', startedAt: Date.now() });
        setStatus(characters.length ? '正在准备角色英文外貌资料…' : '正在生成配图…');
        const compacted = await prepareEnglishImagePrompts({ prompt: sanitizeCourierPhotoText(draft.prompt), negative: sanitizeCourierPhotoText(draft.negative), characters }, buildImageCharacterEnglishConfig(current.imageSettings, current.apiSettings), signal);
        if (!isCurrent(id, expected)) throw new Error('存档已变化，生成已取消。');
        assertSourceCurrent();
        // Keep user-editable scene text separate from protected character facts.
        // Reusing a final payload as a draft would leak the previous character into the next selection.
        setStatus('正在生成配图…');
        updateTask(id, expected, { prompt: compacted.prompt, negativePrompt: compacted.negative });
        const image = await runImageGenerationWithRetry(() => {
          if (!isCurrent(id, expected)) throw Object.assign(new Error('存档已变化，生成已取消。'), { retryable: false });
          assertSourceCurrent();
          return generateImage(config, { prompt: compacted.prompt, negativePrompt: compacted.negative, nsfw: false, size: config.defaultSize, signal, protectedCharacters: compacted.characters });
        }, { signal, maxRetries: config.retryCount ?? current.imageSettings.最大重试次数 ?? 2,
          onRetry: attempt => updateTask(id, expected, { retryCount: attempt }) });
        return { image, compacted };
      })(id);
      if (!isCurrent(id, expected)) return;
      assertSourceCurrent();
      if (result.status !== 'success' || !result.value) throw new Error(result.error || '图片生成失败，请重试。');
      const { image: value, compacted } = result.value;
      const image = 创建相册图片条目({ title: '朋友圈配图', src: value.src, originalUrl: value.originalUrl, source: 'generated', nsfw: false,
        targetType: 'phone', slot: 'misc', tags: ['朋友圈'], mimeType: value.mimeType, prompt: compacted.prompt, negativePrompt: compacted.negative,
        finalPrompt: value.finalPrompt, finalNegativePrompt: value.finalNegativePrompt, dimensions: config.defaultSize, model: value.model, backend: value.backend });
      if (commitImage(image, id, expected, publicCaption, id, rootSourceStillCurrent)) { setStatus('配图已收入相册并加入草稿；尚未发布。'); setMode('none'); }
    } catch (error) {
      if (isCurrent(id, expected)) {
        const message = error instanceof Error ? error.message : String(error);
        updateTask(id, expected, { status: 'failed', error: message, finishedAt: Date.now() }); setStatus(`生成失败：${message}`);
      }
    } finally {
      if (active.current?.id === id) { active.current = null; if (mounted.current) setWorking(false); }
    }
  }
  function select(entryId: string) {
    if (busy) return;
    const entry = props.tools.album.entries.find(item => item.id === entryId);
    if (!entry) return;
    const reference = { entryId, assetId: entry.assetId, ...(caption.trim() ? { caption: caption.trim().slice(0, 200) } : {}) };
    if (resolveMomentImage(props.tools.album, reference) && addReference(reference)) setMode('none');
  }
  return { mode, setMode, draft, setDraft, characterId, setCharacterId, caption, setCaption, busy, uploading: busy && active.current?.kind === 'upload', status, disabledReason, select, upload, generate,
    close: () => { cancel(); setWorking(false); setMode('none'); setStatus('操作已取消，未发布动态。'); } };
}
