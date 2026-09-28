// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourierContactTools } from '@/components/features/Courier/CourierContactTools';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('courier contact tools', () => {
  const hosts: HTMLDivElement[] = [];
  afterEach(() => {
    for (const host of hosts) host.remove();
    hosts.length = 0;
    vi.restoreAllMocks();
  });

  it('opens only one private chat when a contact is clicked twice before rerender', async () => {
    const host = document.createElement('div');
    hosts.push(host);
    document.body.append(host);
    const root = createRoot(host);
    let courier: CourierSystem = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', npcId: 'amber', name: '安柏', available: true }],
    };
    let tick = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++tick);
    try {
      await act(async () => root.render(createElement(CourierContactTools, {
        courier,
        eligibleNpcContacts: [],
        onCourierChange: (update) => {
          courier = typeof update === 'function' ? update(courier) : update;
        },
        onOpenConversation: () => undefined,
      })));
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
      const contact = host.querySelector<HTMLButtonElement>('[aria-label="与 安柏 聊天"]')!;
      await act(async () => {
        contact.click();
        contact.click();
      });
      expect(courier.conversations.filter((item) => item.type === 'private' && item.participantIds.includes('amber'))).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('remark_is_visible_and_can_be_cleared', async () => {
    const host = document.createElement('div');
    hosts.push(host);
    document.body.append(host);
    const root = createRoot(host);
    let courier: CourierSystem = {
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', npcId: 'amber', name: '安柏', available: true }],
    };
    const render = async () => act(async () => root.render(createElement(CourierContactTools, {
      courier, eligibleNpcContacts: [],
      onCourierChange: (update) => { courier = typeof update === 'function' ? update(courier) : update; },
      onOpenConversation: () => undefined,
    })));
    try {
      await render();
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑联系人备注 安柏"]')!.click());
      const input = host.querySelector<HTMLInputElement>('[aria-label="联系人备注"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '侦察骑士');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="保存联系人备注"]')!.click());
      await render();
      expect(host.textContent).toContain('侦察骑士');
      expect(courier.contacts[0]).toMatchObject({ name: '安柏', remark: '侦察骑士' });
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑联系人备注 安柏"]')!.click());
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="清除联系人备注"]')!.click());
      await render();
      expect(courier.contacts[0]?.remark).toBeUndefined();
      expect(host.textContent).toContain('安柏');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
