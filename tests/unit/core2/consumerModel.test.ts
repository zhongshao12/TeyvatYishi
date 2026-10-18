import { expect, it, vi } from 'vitest';
import { createCore2PhoneModel, createCore2PhonePort } from '@/services/ai/core2ConsumerModel';
import { 创建默认手机系统设置 } from '@/models/settings';
import type { API配置项 } from '@/models/settings';
import type { ConsumerContextBundle } from '@/core/retrieval/consumerContext';
const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'not-a-real-key', model: 'test', createdAt: 0, updatedAt: 0 };
const context: ConsumerContextBundle = { prompt: '记得蒲公英的约定，安柏向你问候。', bundle: { bundleId: 'actual-bundle', mandatoryText: '', optionalText: '', selectedLeafIds: ['actual-event'], estimatedTokens: 1, budgetOverflow: false, diagnostics: [] } };

it('delivers each phone bundle to the existing model client and returns actual delivery metadata', async () => {
  const complete = vi.fn().mockResolvedValue('云，今晚要一起去看风起地吗？'), controller = new AbortController();
  const result = await createCore2PhoneModel(complete)({ config, context, npcName: '安柏', target: 'private', signal: controller.signal });
  expect(complete).toHaveBeenCalledTimes(1); expect(complete.mock.calls[0]![1]).toMatchObject({ purpose: 'courier', signal: controller.signal });
  expect(JSON.stringify(complete.mock.calls[0]![1])).toContain(context.prompt);
  expect(result).toMatchObject({ text: '云，今晚要一起去看风起地吗？', delivery: { bundleId: 'actual-bundle', selectedLeafIds: ['actual-event'] } });
});

it('rejects all-technical or truncated output rather than substituting a canned lazy reply', async () => {
  const complete = vi.fn().mockResolvedValue('<char_seven>好感 100</char_seven>');
  await expect(createCore2PhoneModel(complete)({ config, context, npcName: '安柏', target: 'private' })).rejects.toThrow('CORE2_PHONE_REPLY_INVALID');
  complete.mockResolvedValue('哼哼，守护蒙德本来就是侦察骑士');
  await expect(createCore2PhoneModel(complete)({ config, context, npcName: '安柏', target: 'moment' })).rejects.toThrow('MOMENT_COMMENT_INVALID');
});

it('wires the phone override to the shared client, freezes settings and excludes credentials from job identity', async () => {
  const complete = vi.fn().mockResolvedValue('云，晚饭后在风起地见！');
  const phone = 创建默认手机系统设置(); phone.enabled = true;
  phone.api = { ...phone.api, baseUrl: 'https://phone.invalid/v1?api_key=query-secret', model: 'phone-model', apiKey: 'phone-secret' };
  const port = createCore2PhonePort({ mainConfig: config, settings: phone, promptModules: [] }, complete);
  const identity = port.getModelIdentity(); expect(identity).not.toMatch(/secret|invalid|api_key/u);
  phone.api.model = 'changed-after-capture';
  await port.generate({ context, npcName: '安柏', target: 'private', signal: new AbortController().signal });
  expect(complete.mock.calls[0]![0]).toMatchObject({ model: 'phone-model', apiKey: 'phone-secret' });
  const keyOnly = 创建默认手机系统设置(); keyOnly.enabled = true;
  keyOnly.api = { ...phone.api, model: 'phone-model', baseUrl: 'https://phone.invalid/v1?api_key=another-secret', apiKey: 'rotated-secret' };
  expect(createCore2PhonePort({ mainConfig: config, settings: keyOnly, promptModules: [] }, complete).getModelIdentity()).toBe(identity);
  expect(createCore2PhonePort({ mainConfig: config, settings: phone, promptModules: [] }, complete).getModelIdentity()).not.toBe(identity);
});

it('does not silently call the main model when the phone is disabled or unconfigured', async () => {
  const complete = vi.fn(), settings = 创建默认手机系统设置(); settings.enabled = false;
  const input = { context, npcName: '安柏', target: 'private' as const, signal: new AbortController().signal };
  await expect(createCore2PhonePort({ mainConfig: config, settings, promptModules: [] }, complete).generate(input)).rejects.toThrow('手机系统已关闭');
  settings.enabled = true;
  await expect(createCore2PhonePort({ mainConfig: null, settings, promptModules: [] }, complete).generate(input)).rejects.toThrow('API 未配置');
  expect(complete).not.toHaveBeenCalled();
});
