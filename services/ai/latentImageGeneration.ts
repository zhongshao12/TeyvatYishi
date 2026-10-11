import type { 文生图API配置 } from '@/models/settings';
import type { ImageGenerationRequest, ImageGenerationResult } from './imageGeneration';
import { compactImagePrompts } from '@/utils/imagePromptCompaction';

export const LATENT_BASE_URL = 'https://latent.moe';
export const LATENT_IMAGE_PATH = '/api/novelai/ai/generate-image';

// All entry points share this queue: Latent allows only one active render per account.
let pendingRender: Promise<void> = Promise.resolve();
const uncertainAccounts = new Set<string>();

function accountIdentity(config: 文生图API配置): string {
  // In-memory only, never logged or persisted with a job/error record.
  return `${latentEndpoint(config)}\u0000${config.apiKey.trim()}`;
}

/** User-facing acknowledgment after checking the provider control panel. No API call. */
export function acknowledgeLatentJobResolved(config: 文生图API配置): void {
  uncertainAccounts.delete(accountIdentity(config));
}

function joinCaptionParts(parts: Array<string | undefined>): string {
  const output: string[] = [];
  for (const raw of parts) {
    const part = raw?.trim();
    if (!part) continue;
    const contained = output.some(existing => {
      const offset = existing.indexOf(part);
      if (offset < 0) return false;
      const before = existing.slice(0, offset).trimEnd();
      const after = existing.slice(offset + part.length).trimStart();
      return (!before || before.endsWith(',')) && (!after || after.startsWith(','));
    });
    if (!contained) output.push(part);
  }
  // Keep weighted comma-containing phrases intact rather than splitting every tag.
  return output.join(', ');
}

export function latentEndpoint(config: 文生图API配置): string {
  const base = config.baseUrl.trim().replace(/\/+$/, '') || LATENT_BASE_URL;
  const path = config.pathMode === 'custom' && config.customPath.trim()
    ? config.customPath.trim() : LATENT_IMAGE_PATH;
  if (/^https?:\/\//i.test(path)) return path;
  // Accept the root URL and the base URL from Latent's NovelAI-client instructions.
  if (base.endsWith('/api/novelai') && path === LATENT_IMAGE_PATH) return `${base}/ai/generate-image`;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export function latentImageSize(size: string): { width: number; height: number } {
  const match = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  const ratio = match ? Number(match[1]) / Number(match[2]) : 1;
  if (ratio > 1.15) return { width: 1536, height: 920 };
  if (ratio < 1 / 1.15) return { width: 920, height: 1536 };
  return { width: 1024, height: 1024 };
}

function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Latent 本地请求已取消；不会停止服务器已接收的生成任务。', 'AbortError');
}

/** Browser-compatible API, not the native job API (which has no CORS). */
export function generateLatentImage(
  config: 文生图API配置,
  request: ImageGenerationRequest,
  decodeImage: (blob: Blob, contentType: string) => Promise<{ src: string; mimeType: string }>,
): Promise<ImageGenerationResult> {
  const render = pendingRender.then(async () => {
    abortIfRequested(request.signal);
    const account = accountIdentity(config);
    if (uncertainAccounts.has(account)) throw new Error('Latent 上一任务状态未知，后续提交已暂停。请先检查控制台，确认没有运行中的任务，再在文生图设置中点击「已检查控制台，恢复生成」。');
    if (!config.apiKey.trim()) throw new Error('请填写 Latent Designer API Key（lat_sk_…）。');
    if (request.referenceImages?.some(image => image.src.trim())) throw new Error('Latent 不支持参考图，请关闭参考图参与生成。');
    const context = request.storySnapshotContext;
    const characters = context?.characters.filter(character => character.enabled !== false) ?? [];
    // V4 characterPrompts are discarded by Latent; keep all characters in the base caption.
    let positive = joinCaptionParts([request.prompt, context?.scenePrompt, context?.stylePrompt, ...characters.map(character => character.visualPrompt)]);
    let negative = joinCaptionParts([request.negativePrompt, config.negativePrompt, context?.sceneNegativePrompt, context?.styleNegativePrompt,
      ...characters.map(character => character.negativePrompt)]);
    const promptCompacted = positive.length > 2000 || negative.length > 2000;
    if (promptCompacted) {
      const compacted = compactImagePrompts({ prompt: positive, negative, characters, limit: 2000 });
      positive = compacted.prompt;
      negative = compacted.negative;
    }
    if (!positive) throw new Error('精简后没有可绘制的画面描述，请补充角色或场景。');
    const size = latentImageSize(request.size || config.defaultSize);
    const parameters = {
      ...size,
      steps: Math.max(8, Math.min(12, Math.trunc(config.steps) || 8)),
      sampler: config.sampler,
      noise_schedule: config.noiseSchedule,
      uc: negative,
      negative_prompt: negative,
      ...(Number.isSafeInteger(config.seed) && config.seed >= 0 ? { seed: config.seed } : {}),
    };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    let completionKnown = false;
    const timeout = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, 180_000);
    try {
      const response = await fetch(latentEndpoint(config), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey.trim()}` },
        body: JSON.stringify({ input: positive, model: 'latent', parameters }), signal: controller.signal,
      });
      if (!response.ok) {
        // A gateway 5xx can arrive after acceptance. Native API queue_full=503
        // does not establish the same contract for this browser compatibility route.
        completionKnown = response.status >= 400 && response.status < 500;
        // Do not echo provider bodies: they may contain signed URLs or credentials.
        const reasons: Record<number, string> = {
          400: '请求参数或提示词无效', 401: 'API Key 无效或已撤销', 402: '本周生图额度已用尽',
          429: '已有任务运行或队列已满', 504: '等待超时，任务仍可能在服务器完成，请先检查 Latent 控制台',
        };
        throw new Error(`Latent 生图失败（HTTP ${response.status}）：${reasons[response.status] || '服务暂时不可用'}。不会自动重复提交。`);
      }
      const blob = await response.blob();
      completionKnown = true;
      abortIfRequested(controller.signal);
      const image = await decodeImage(blob, response.headers.get('content-type') || '');
      abortIfRequested(controller.signal);
      return { ...image, ...size, backend: 'latent', model: 'Latent 固定模型', finalPrompt: positive, finalNegativePrompt: negative, promptCompacted };
    } catch (error) {
      if (!completionKnown) uncertainAccounts.add(account);
      if (timedOut) throw new Error('Latent 生图等待超过 180 秒；服务器可能仍在生成，请检查控制台，不会自动重复提交。');
      abortIfRequested(request.signal);
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }
  });
  pendingRender = render.then(() => undefined, () => undefined);
  // Cancel the caller immediately even while waiting, but keep the serial tail until
  // the preceding render settles. Its queued body checks aborted before any fetch.
  const callerResult = request.signal ? new Promise<ImageGenerationResult>((resolve, reject) => {
    const signal = request.signal!;
    const onAbort = () => {
      try { abortIfRequested(signal); } catch (error) { reject(error); }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    render.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
  }) : render;
  return callerResult.catch(error => {
    // Network failures can occur after a render was accepted. Never blindly retry them.
    const failure = error instanceof Error ? error : new Error(String(error));
    Object.assign(failure, { retryable: false });
    throw failure;
  });
}
