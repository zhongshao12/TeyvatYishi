type Node = { class_type: string; inputs: Record<string, unknown>; _meta?: unknown };
export type ComfyApiWorkflow = Record<string, Node>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function defaultComfyWorkflowJson(): string {
  return JSON.stringify({
    '3': { class_type: 'KSampler', inputs: { seed: '__SEED__', steps: '__STEPS__', cfg: '__CFG__', sampler_name: '__SAMPLER__', scheduler: '__SCHEDULER__', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '__MODEL__' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: '__WIDTH__', height: '__HEIGHT__', batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '__PROMPT__', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '__NEGATIVE_PROMPT__', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'TeyvatYishi', images: ['8', 0] } },
  });
}
export function ownComfyApiWorkflow(payload: unknown): ComfyApiWorkflow {
  if (!record(payload) || Array.isArray(payload.nodes) || Array.isArray(payload.links)) throw Error('请导出 ComfyUI 的 API 格式 JSON，不是画布工作流 JSON。');
  const graph = record(payload.prompt) ? payload.prompt : payload;
  const nodes = Object.entries(graph);
  if (!nodes.length || nodes.length > 2000 || nodes.some(([id, node]) => ['__proto__', 'prototype', 'constructor'].includes(id) || !record(node) || typeof node.class_type !== 'string' || !node.class_type.trim() || !record(node.inputs))) throw Error('ComfyUI API 工作流应为带有 class_type 和 inputs 的节点集合。');
  return structuredClone(graph) as ComfyApiWorkflow;
}
/** Follow actual conditioning links; leave notes and unrelated text nodes alone. */
export function bindComfyPromptInputs(graph: ComfyApiWorkflow, positive: string, negative: string): { positive: number; negative: number } {
  const ids = { positive: new Set<string>(), negative: new Set<string>() };
  const visit = (value: unknown, target: Set<string>, seen: Set<string>) => {
    if (!Array.isArray(value) || typeof value[0] !== 'string' || !Number.isInteger(value[1])) return;
    const id = value[0]; if (seen.has(id)) return; seen.add(id);
    const node = graph[id]; if (!node) return;
    if (/^CLIPTextEncode/u.test(node.class_type)) { target.add(id); return; }
    for (const input of Object.values(node.inputs)) visit(input, target, seen);
  };
  for (const node of Object.values(graph)) for (const kind of ['positive', 'negative'] as const) visit(node.inputs[kind], ids[kind], new Set());
  if ([...ids.positive].some(id => ids.negative.has(id))) throw Error('ComfyUI 正负提示词共用了同一个文本节点，请拆成两个编码节点后再导入。');
  for (const kind of ['positive', 'negative'] as const) for (const id of ids[kind]) {
    for (const field of ['text', 'text_g', 'text_l', 'clip_l', 't5xxl']) if (typeof graph[id]!.inputs[field] === 'string' || Array.isArray(graph[id]!.inputs[field])) graph[id]!.inputs[field] = kind === 'positive' ? positive : negative;
  }
  return { positive: ids.positive.size, negative: ids.negative.size };
}
