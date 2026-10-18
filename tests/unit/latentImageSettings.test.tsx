// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ImageGenerationSettingsTab } from '@/components/features/Settings/ImageGenerationSettingsTab';
import { 创建默认游戏设置 } from '@/models/settings';
import { saveSetting } from '@/services/storage/indexedSettingsStore';

vi.mock('@/services/storage/indexedSettingsStore', () => ({ saveSetting: vi.fn(async () => undefined), saveSettings: vi.fn(async () => undefined), loadSetting: vi.fn(async () => null) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('offers Latent with its endpoint, bounded settings and unsupported controls disabled', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [settings, setSettings] = useState(创建默认游戏设置());
    return createElement(ImageGenerationSettingsTab, { settings, onChange: setSettings, apiSettings: { activeConfigId: '', configs: [] } });
  }
  const field = (name: string) => [...container.querySelectorAll('label')]
    .find(label => label.firstElementChild?.textContent === name)?.querySelector<HTMLInputElement | HTMLSelectElement>('input,select') ?? undefined;
  try {
    await act(async () => root.render(createElement(Harness)));
    const normal = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('统一接口') && button.textContent?.includes('头像'))!;
    await act(async () => normal.click());
    const backend = field('后端类型') as HTMLSelectElement;
    expect([...backend.options].map(option => option.value)).toContain('latent');
    await act(async () => { backend.value = 'latent'; backend.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(field('Base URL')?.value).toBe('https://latent.moe');
    expect(container.textContent).toContain('https://latent.moe/api/novelai/ai/generate-image');
    expect(field('模型')).toBeUndefined(); expect(field('CFG')).toBeUndefined();
    expect(field('响应格式')).toBeUndefined();
    expect(field('步数')?.getAttribute('min')).toBe('8'); expect(field('步数')?.getAttribute('max')).toBe('12');
    expect(field('失败重试')?.disabled).toBe(true);
    expect(container.textContent).toContain('不支持参考图');
    expect(container.textContent).toContain('不会停止服务器');
    const resume = [...container.querySelectorAll('button')].find(button => button.textContent === '已检查控制台，恢复生成')!;
    await act(async () => resume.click());
    expect(container.textContent).toContain('已解除本地暂停');
    const save = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('保存文生图设置'))!;
    await act(async () => save.click());
    expect(saveSetting).toHaveBeenCalledWith('gameSettings', expect.objectContaining({ 文生图系统: expect.objectContaining({
      普通接口: expect.objectContaining({ backend: 'latent', baseUrl: 'https://latent.moe', apiKey: '', model: '', steps: 8, retryCount: 0 }),
    }) }));
    expect(container.textContent).toContain('文生图设置已保存');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
