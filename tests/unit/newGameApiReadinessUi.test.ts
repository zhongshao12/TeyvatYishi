// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewGameWizard } from '@/components/features/NewGame/NewGameWizard';
import { 创建默认游戏设置, type API配置项, type API设置 } from '@/models/settings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find((element) => element.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return match;
}

async function advanceToSummary(): Promise<void> {
  const name = host.querySelector<HTMLInputElement>('label:has(span:first-child) input');
  if (!name) throw new Error('找不到姓名输入框');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(name, '风旅人');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (let step = 0; step < 3; step += 1) {
    await act(async () => button('下一步 →').click());
  }
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it('warns about missing API, opens settings without losing draft, and never tests connection automatically', async () => {
  const settings = 创建默认游戏设置();
  const onOpenApiSettings = vi.fn();
  const onGenerateTravelerTemplate = vi.fn();
  const onStart = vi.fn(async () => {});
  const empty: API设置 = { activeConfigId: null, configs: [] };
  const render = (apiSettings: API设置) => createElement(NewGameWizard, {
    onStart, onBack: vi.fn(), currentTheme: 'mondstadt' as const, gameSettings: settings,
    apiSettings, onOpenApiSettings, onGenerateTravelerTemplate,
  });

  await act(async () => root.render(render(empty)));
  await advanceToSummary();
  expect(host.textContent).toContain('主模型未就绪');
  expect(host.textContent).toContain('变量处理');
  expect(button('✦ 开始旅程').disabled).toBe(false);

  await act(async () => button('打开 API 设置').click());
  expect(onOpenApiSettings).toHaveBeenCalledTimes(1);
  expect(onGenerateTravelerTemplate).not.toHaveBeenCalled();

  const configured: API配置项 = {
    id: 'main', name: '主模型', provider: 'openai_compatible',
    baseUrl: 'http://localhost:1234/v1', apiKey: 'PRIVATE_KEY', model: 'model-a',
    createdAt: 1, updatedAt: 1,
  };
  await act(async () => root.render(render({ activeConfigId: 'main', configs: [configured] })));
  expect(host.textContent).toContain('风旅人');
  expect(host.textContent).toContain('主模型已配置（尚未测试连接）');
  expect(host.textContent).not.toContain('PRIVATE_KEY');
  expect(onGenerateTravelerTemplate).not.toHaveBeenCalled();
});
