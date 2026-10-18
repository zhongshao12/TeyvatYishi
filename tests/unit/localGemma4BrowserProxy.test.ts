import { afterEach, expect, it, vi } from 'vitest';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { LOCAL_GEMMA4_128K_PROFILE } from '@/data/localTextModelPresets';
import { fetchModels } from '@/services/ai/apiTools';

afterEach(() => vi.unstubAllGlobals());
it('uses the same-origin bridge only for local-browser calls to the configured local Ollama', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { urls.push(String(url)); return Response.json({ choices: [{ message: { content: '本地回复' } }] }); });
  const config = { ...LOCAL_GEMMA4_128K_PROFILE, id: 'bridge-test', createdAt: 1, updatedAt: 1 };
  for (const origin of ['http://127.0.0.1:3000', 'http://localhost:53809', 'https://example.invalid', 'http://localhost.attacker.invalid:3000', 'http://tauri.localhost']) {
    vi.stubGlobal('location', { origin });
    expect(await chatCompletionNonStream(config, { messages: [], deepSeekRecovery: 'disabled' })).toBe('本地回复');
  }
  expect(urls).toEqual(['/api/local-ollama/v1/chat/completions', '/api/local-ollama/v1/chat/completions',
    'http://127.0.0.1:11434/v1/chat/completions', 'http://127.0.0.1:11434/v1/chat/completions', 'http://127.0.0.1:11434/v1/chat/completions']);
});
it('fetches the model selector through the same local bridge without generating a reply', async () => {
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:3000' }); const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { urls.push(String(url)); return Response.json({ data: [{ id: 'gemma4-heretic-128k:latest' }] }); });
  expect(await fetchModels({ ...LOCAL_GEMMA4_128K_PROFILE })).toEqual(['gemma4-heretic-128k:latest']);
  expect(urls).toEqual(['/api/local-ollama/v1/models']);
});
it('does not reroute or restrict an existing different model at the same local endpoint', async () => {
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:3000' }); const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { urls.push(String(url)); return Response.json({ choices: [{ message: { content: '原模型回复' } }] }); });
  expect(await chatCompletionNonStream({ ...LOCAL_GEMMA4_128K_PROFILE, id: 'existing-local-model', model: 'ninfer-local:latest', createdAt: 1, updatedAt: 1 }, { messages: [], deepSeekRecovery: 'disabled' })).toBe('原模型回复');
  expect(urls).toEqual(['http://127.0.0.1:11434/v1/chat/completions']);
});
