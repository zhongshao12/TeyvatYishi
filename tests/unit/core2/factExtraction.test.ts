import { describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import { extractCoreFacts } from '@/core/settlement/factExtraction';
import { parseCoreCandidates } from '@/core/settlement/candidateProtocol';
import { makeSeed, makeSource } from './fixtures';

const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'test-only', model: 'test', createdAt: 0, updatedAt: 0, topP: 0, maxTokens: 4096, retryCount: 1 };
function fixture() {
  const seed = makeSeed();
  const source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'body-1', kind: 'narration', text: '🙂安柏把两枚苹果放入玩家背包。' }] });
  const quote = source.blocks[0]!.text.slice(2);
  const candidate = { kind: 'inventory', actors: ['npc-amber'], targets: [seed.playerId], proposal: { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 2 }, evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 2, end: source.blocks[0]!.text.length, quote }] };
  return { input: { source, snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, config }, candidate, source };
}
const module = (id: string, content: string, deliveryTargets: 提示词模块['deliveryTargets']): 提示词模块 => ({ id, title: id, description: '', content, category: 'custom', enabled: true, builtin: false, order: 1, scope: ['calibration'], deliveryTargets, createdAt: 0, updatedAt: 0 });

describe('core2 typed fact protocol', () => {
  it('requires precise versioned UTF-16 evidence and assigns host-owned identity', () => {
    const { source, candidate } = fixture();
    const [result] = parseCoreCandidates(JSON.stringify({ candidates: [candidate] }), source);
    expect(result).toMatchObject({ scope: source.scope, operationId: source.operationId, status: 'proposed', proposal: candidate.proposal, evidenceRefs: candidate.evidenceRefs });
    expect(result?.candidateId).toMatch(/^[\da-f-]{36}$/);
    expect(parseCoreCandidates(JSON.stringify({ candidates: [{ ...candidate, evidenceRefs: [{ ...candidate.evidenceRefs[0], start: 1 }] }] }), source)).toEqual([]);
    expect(parseCoreCandidates(JSON.stringify({ candidates: [{ ...candidate, evidenceRefs: [{ ...candidate.evidenceRefs[0], ref: { ...source.ref, sourceVersion: 2 } }] }] }), source)).toEqual([]);
  });
  it.each(['candidateId', 'scope', 'operationId', 'eventId', 'status', 'statePatch'])('refuses model authority field %s instead of silently dropping it', key => {
    const { source, candidate } = fixture();
    expect(parseCoreCandidates(JSON.stringify({ candidates: [{ ...candidate, [key]: 'model-owned' }] }), source)).toEqual([]);
  });
  it('rejects arbitrary paths, mismatched kinds and a partially invalid batch', () => {
    const { source, candidate } = fixture();
    expect(parseCoreCandidates('{"updates":[{"path":"npc.affinity","value":999}]}', source)).toEqual([]);
    expect(parseCoreCandidates(JSON.stringify({ candidates: [{ ...candidate, kind: 'weather' }] }), source)).toEqual([]);
    expect(parseCoreCandidates(JSON.stringify({ candidates: [candidate, { ...candidate, evidenceRefs: [] }] }), source)).toEqual([]);
  });
  it('repairs punctuation only; never invents absent evidence', async () => {
    const { input, source, candidate } = fixture();
    const raw = `\uFEFF\`\`\`json\n{"candidates":[${JSON.stringify(candidate)},],}\n\`\`\``;
    expect(parseCoreCandidates(raw, source)).toHaveLength(1);
    const result = await extractCoreFacts(input, { complete: async () => JSON.stringify({ candidates: [{ ...candidate, evidenceRefs: [] }] }) });
    expect(result).toMatchObject({ kind: 'failed', code: 'CORE2_INVALID_FACT_PROTOCOL', attempts: 1 });
  });
});

describe('core2 extraction orchestration', () => {
  it('distinguishes valid no-change from empty, malformed and unconfigured responses', async () => {
    const { input } = fixture();
    expect(await extractCoreFacts(input, { complete: async () => '{"candidates":[]}' })).toMatchObject({ kind: 'extracted', candidates: [], attempts: 1 });
    expect(await extractCoreFacts(input, { complete: async () => '' })).toMatchObject({ kind: 'failed', code: 'CORE2_EMPTY_FACT_RESPONSE' });
    expect(await extractCoreFacts(input, { complete: async () => '{}' })).toMatchObject({ kind: 'failed', code: 'CORE2_INVALID_FACT_PROTOCOL' });
    const complete = vi.fn();
    expect(await extractCoreFacts({ ...input, config: undefined }, { complete })).toMatchObject({ kind: 'failed', code: 'CORE2_FACT_MODEL_UNCONFIGURED', attempts: 0 });
    expect(complete).not.toHaveBeenCalled();
  });
  it('preserves selected variable preset rules, provider parameters, cancellation and retry metadata', async () => {
    const { input, candidate } = fixture();
    const signal = new AbortController().signal;
    const complete = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(JSON.stringify({ candidates: [candidate] }));
    const result = await extractCoreFacts({ ...input, signal, promptModules: [module('v', '保留这个变量预设规则', ['variable']), module('m', '主剧情专属不要泄入', ['main'])] }, { complete, retryDelayMs: 0 });
    expect(result).toMatchObject({ kind: 'extracted', attempts: 2 });
    const [sentConfig, request] = complete.mock.calls[0]!;
    expect(sentConfig).toEqual(config);
    expect(request).toMatchObject({ purpose: 'variable', signal, topP: 0, maxTokens: 4096 }); // shared client owns normalization
    expect(request.systemPrompt).toContain('保留这个变量预设规则');
    expect(request.systemPrompt).not.toContain('主剧情专属不要泄入');
    expect(request.messages[0].content).toContain(input.source.ref.sourceId);
    expect(request.messages[0].content).not.toContain('test-only');
  });
  it('owns source and state before awaiting and cannot write the caller state', async () => {
    const { input, candidate } = fixture();
    const before = structuredClone(input.snapshot);
    let release!: (raw: string) => void;
    const complete = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const promise = extractCoreFacts(input, { complete });
    input.source.blocks[0]!.text = 'later edit';
    release(JSON.stringify({ candidates: [candidate] }));
    expect(await promise).toMatchObject({ kind: 'extracted' });
    expect(input.snapshot).toEqual(before);
  });
  it('rejects mismatched scope before sending and rechecks cancellation after response', async () => {
    const { input, candidate } = fixture();
    const complete = vi.fn(async () => JSON.stringify({ candidates: [candidate] }));
    expect(await extractCoreFacts({ ...input, source: { ...input.source, scope: { ...input.source.scope, branchId: 'other' } } }, { complete })).toMatchObject({ kind: 'failed', code: 'CORE2_FACT_INPUT_INVALID', attempts: 0 });
    expect(complete).not.toHaveBeenCalled();
    const controller = new AbortController();
    expect(await extractCoreFacts({ ...input, signal: controller.signal }, { complete: async () => { controller.abort(); return JSON.stringify({ candidates: [candidate] }); } })).toMatchObject({ kind: 'failed', code: 'CORE2_FACT_CANCELLED', attempts: 1 });
  });
  it('does not retry explicit non-retryable errors or already cancelled requests', async () => {
    const { input } = fixture();
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('configuration'), { nonRetryable: true }));
    expect(await extractCoreFacts(input, { complete, retryDelayMs: 0 })).toMatchObject({ kind: 'failed', code: 'CORE2_FACT_MODEL_FAILED', attempts: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    expect(await extractCoreFacts({ ...input, signal: controller.signal }, { complete })).toMatchObject({ kind: 'failed', code: 'CORE2_FACT_CANCELLED', attempts: 0 });
  });
});
