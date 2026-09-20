import { describe, expect, it, vi } from 'vitest';
import { handlePresencePost } from '@/functions/api/presence';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

function request(body: unknown, origin = 'https://game.example.com'): Request {
  return new Request('https://game.example.com/api/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'CF-Connecting-IP': '203.0.113.8' },
    body: JSON.stringify(body),
  });
}

function fakeKv() {
  const records = new Map<string, string>();
  return {
    records,
    get: vi.fn(async <T>(key: string) => {
      const value = records.get(key);
      return value ? JSON.parse(value) as T : null;
    }),
    list: vi.fn(async ({ prefix = '' }: { prefix?: string } = {}) => ({
      keys: [...records.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    })),
    put: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
    }),
  };
}

describe('presence endpoint security before enablement', () => {
  it('rejects cross-origin writes before touching storage', async () => {
    const kv = fakeKv();
    const response = await handlePresencePost({
      request: request({ sessionId: SESSION_ID }, 'https://attacker.example'),
      env: { ONLINE_SESSIONS_KV: kv },
    }, { enabled: true, now: 1_800_000_000_000 });

    expect(response.status).toBe(403);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('requires a UUID session id', async () => {
    const kv = fakeKv();
    const response = await handlePresencePost({
      request: request({ sessionId: 'user-controlled-session' }),
      env: { ONLINE_SESSIONS_KV: kv },
    }, { enabled: true, now: 1_800_000_000_000 });

    expect(response.status).toBe(400);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('honors the edge rate limiter before writing', async () => {
    const kv = fakeKv();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const response = await handlePresencePost({
      request: request({ sessionId: SESSION_ID }),
      env: { ONLINE_SESSIONS_KV: kv, PRESENCE_RATE_LIMITER: limiter },
    }, { enabled: true, now: 1_800_000_000_000 });

    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.8' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('writes one bounded KV record per session and returns aggregates only', async () => {
    const kv = fakeKv();
    const limiter = { limit: vi.fn(async () => ({ success: true })) };
    const response = await handlePresencePost({
      request: request({ sessionId: SESSION_ID, path: '/adventure' }),
      env: {
        ONLINE_SESSIONS_KV: kv,
        ONLINE_SESSIONS_KV_PREFIX: 'test-presence',
        PRESENCE_RATE_LIMITER: limiter,
      },
    }, { enabled: true, now: 1_800_000_000_000 });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put.mock.calls[0]?.[0]).toBe(`test-presence/session/${SESSION_ID}`);
    expect([...kv.records.keys()].some((key) => key.endsWith('sessions.json'))).toBe(false);
    expect(body).toMatchObject({ online: 1, onlineCount: 1, storage: 'kv' });
    expect(JSON.stringify(body)).not.toContain(SESSION_ID);
    expect(JSON.stringify(body)).not.toContain('203.0.113.8');
  });
});
