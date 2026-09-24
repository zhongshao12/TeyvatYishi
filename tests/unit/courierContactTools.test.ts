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
});
