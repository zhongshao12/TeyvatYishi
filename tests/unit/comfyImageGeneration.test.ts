import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { 创建默认文生图API配置 } from '@/models/settings';
import { generateImage, testImageGenerationConnection } from '@/services/ai/imageGeneration';
import { runImageGenerationWithRetry } from '@/utils/imageGenerationRetry';

const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68]);
class TestReader { result = ''; onload?: () => void; readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); }); } }
const config = () => ({ ...创建默认文生图API配置(), enabled: true, backend: 'comfyui' as const, baseUrl: 'http://127.0.0.1:8188', presetPath: 'comfyui_prompt' as const, apiKey: '', model: 'local-anime.safetensors', negativePrompt: '' });
let submissions: Record<string, any>[], urls: string[];
beforeEach(() => {
  submissions = []; urls = []; vi.stubGlobal('FileReader', TestReader);
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    urls.push(input);
    if (input.includes('/object_info/')) return Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['local-anime.safetensors']] } } } });
    if (input.endsWith('/prompt')) { submissions.push(JSON.parse(String(init?.body))); return Response.json({ prompt_id: 'own-prompt-id', number: 1 }); }
    if (input.includes('/history/')) return Response.json({ 'own-prompt-id': { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'image.png', subfolder: '', type: 'output' }] } } } });
    if (input.includes('/view?')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    throw Error(`Unexpected test route: ${input}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('runs a real basic API graph when the default workflow is selected, with prompt, negative, dimensions and seed', async () => {
  const result = await generateImage({ ...config(), seed: 123 }, { prompt: 'Amber, red hair, Japanese fantasy', negativePrompt: 'blur, watermark', size: '768x1024' });
  expect(result.src).toMatch(/^data:image\/png;base64,/);
  expect(submissions).toHaveLength(1);
  const nodes = Object.values(submissions[0]!.prompt) as any[];
  expect(nodes.find(node => node.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name).toBe('local-anime.safetensors');
  expect(nodes.filter(node => node.class_type === 'CLIPTextEncode').map(node => node.inputs.text)).toEqual(['Amber, red hair, Japanese fantasy', 'blur, watermark']);
  expect(nodes.find(node => node.class_type === 'EmptyLatentImage').inputs).toMatchObject({ width: 768, height: 1024 });
  expect(nodes.find(node => node.class_type === 'KSampler').inputs.seed).toBe(123);
});
it('injects prompts into the sampler-linked encoders of an imported API graph without changing unrelated text', async () => {
  const graph = {
    '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'OLD_POSITIVE' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'OLD_NEGATIVE' } },
    '8': { class_type: 'TextPreview', inputs: { text: 'KEEP_THIS_NOTE' } },
  };
  await generateImage({ ...config(), useDefaultComfyWorkflow: false, comfyWorkflowJson: JSON.stringify({ prompt: graph }) }, { prompt: 'Lisa, purple dress', negativePrompt: 'bad anatomy' });
  expect(submissions[0]!.prompt).toMatchObject({ '6': { inputs: { text: 'Lisa, purple dress' } }, '7': { inputs: { text: 'bad anatomy' } }, '8': { inputs: { text: 'KEEP_THIS_NOTE' } } });
});
it('rejects a canvas export before sending anything to the GPU', async () => {
  await expect(generateImage({ ...config(), useDefaultComfyWorkflow: false, comfyWorkflowJson: JSON.stringify({ nodes: [], links: [] }) }, { prompt: 'portrait' })).rejects.toThrow('API');
  expect(submissions).toHaveLength(0);
});
it('reports a Comfy execution error immediately instead of polling to timeout', async () => {
  const original = fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => url.includes('/history/') ? Response.json({ 'own-prompt-id': { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_id: '3', exception_message: 'CUDA out of memory' }]] }, outputs: {} } }) : original(url, init));
  await expect(generateImage(config(), { prompt: 'portrait' })).rejects.toThrow('CUDA out of memory');
  expect(submissions).toHaveLength(1);
});
it('cancels only this wait without interrupting another ComfyUI job or duplicating the prompt', async () => {
  const abort = new AbortController(), original = fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.includes('/history/')) { abort.abort(); return Response.json({}); }
    return original(url, init);
  });
  await expect(generateImage(config(), { prompt: 'portrait', signal: abort.signal })).rejects.toThrow(/取消/);
  expect(submissions).toHaveLength(1); expect(urls.some(url => url.endsWith('/interrupt'))).toBe(false);
});
it('does not require a checkpoint setting for a custom non-checkpoint workflow', async () => {
  const graph = { '1': { class_type: 'CustomLocalSampler', inputs: { prompt: '__PROMPT__', negative: '__NEGATIVE_PROMPT__', unet: 'local-flux.safetensors' } } };
  const result = await generateImage({ ...config(), model: '', useDefaultComfyWorkflow: false, comfyWorkflowJson: JSON.stringify(graph) }, { prompt: 'fantasy town', negativePrompt: 'text' });
  expect(result.src).toMatch(/^data:image\/png/); expect(urls.some(url => url.includes('/object_info/Checkpoint'))).toBe(false);
});
it('preserves custom Anima sampling choices and replaces linked prompt inputs rather than silently using stale text', async () => {
  const graph = {
    '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0], sampler_name: 'euler', scheduler: 'simple', steps: 4, cfg: 1.5, seed: 123 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: ['8', 0] } }, '7': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
    '8': { class_type: 'PrimitiveString', inputs: { value: 'OLD_LINKED_PROMPT' } },
  };
  await generateImage({ ...config(), model: '', useDefaultComfyWorkflow: false, comfyWorkflowJson: JSON.stringify(graph), seed: 42 }, { prompt: 'new landscape', negativePrompt: 'blurry' });
  expect(submissions[0]!.prompt).toMatchObject({ '3': { inputs: { scheduler: 'simple', steps: 4, cfg: 1.5, seed: 42 } }, '6': { inputs: { text: 'new landscape' } } });
});
it('does not let the shared retry loop resubmit an executed but failed Comfy prompt', async () => {
  const original = fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => url.includes('/history/') ? Response.json({ 'own-prompt-id': { status: { status_str: 'error', completed: false }, outputs: {} } }) : original(url, init));
  await expect(runImageGenerationWithRetry(() => generateImage(config(), { prompt: 'portrait' }), { maxRetries: 2 })).rejects.toThrow('ComfyUI');
  expect(submissions).toHaveLength(1);
});
it('does not treat an HTML welcome page as a successful Comfy API connection', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>proxy login</html>', { headers: { 'content-type': 'text/html' } }));
  await expect(testImageGenerationConnection(config())).rejects.toThrow(/JSON|ComfyUI/);
});
it('times out a queued task without automatically submitting another prompt', async () => {
  vi.useFakeTimers(); const original = fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => url.includes('/history/') ? Response.json({}) : original(url, init));
  const work = generateImage({ ...config(), comfyTimeoutSeconds: 30 }, { prompt: 'portrait' });
  const assertion = expect(work).rejects.toThrow('30 秒');
  await vi.advanceTimersByTimeAsync(30_010); await assertion; expect(submissions).toHaveLength(1);
});
