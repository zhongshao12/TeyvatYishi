import { jsonResponse, type PagesContextLike } from './auth/_shared';
import { readTrimmedText as readText } from '@/utils/valueGuards';

// Presence stays disabled until the deployment has both KV and an edge rate-limiter binding.
const PRESENCE_SYSTEM_ENABLED = false;
const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const DEFAULT_KV_PREFIX = 'kaituoyishi/online';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type PresenceSessionRecord = {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  heartbeatCount: number;
};

type PresenceBody = {
  online: number;
  onlineCount: number;
  onlineSessionCount: number;
  totalRecentCount: number;
  ttlSeconds: number;
  updatedAt: string;
  serverTime: string;
  storage: 'kv' | 'disabled';
  disabled?: boolean;
};

type KvNamespaceLike = {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
  put(key: string, value: string, options?: unknown): Promise<unknown>;
};

type RateLimiterLike = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type PresenceHandlerOptions = {
  enabled?: boolean;
  now?: number;
};

function readSessionId(raw: unknown): string {
  const sessionId = readText(raw).toLowerCase();
  return UUID_PATTERN.test(sessionId) ? sessionId : '';
}

function getClientIp(request: Request): string {
  const direct = readText(request.headers.get('CF-Connecting-IP'));
  if (direct) return direct;
  const forwarded = readText(request.headers.get('X-Forwarded-For'));
  if (forwarded) return forwarded.split(',')[0]?.trim() || '';
  return readText(request.headers.get('X-Real-IP'));
}

function getKvNamespace(env: PagesContextLike['env']): KvNamespaceLike | null {
  const candidate = env.ONLINE_SESSIONS_KV;
  if (
    candidate
    && typeof candidate === 'object'
    && typeof (candidate as KvNamespaceLike).get === 'function'
    && typeof (candidate as KvNamespaceLike).list === 'function'
    && typeof (candidate as KvNamespaceLike).put === 'function'
  ) {
    return candidate as KvNamespaceLike;
  }
  return null;
}

function getRateLimiter(env: PagesContextLike['env']): RateLimiterLike | null {
  const candidate = env.PRESENCE_RATE_LIMITER;
  if (candidate && typeof candidate === 'object' && typeof (candidate as RateLimiterLike).limit === 'function') {
    return candidate as RateLimiterLike;
  }
  return null;
}

function getPrefix(env: PagesContextLike['env']): string {
  return (readText(env.ONLINE_SESSIONS_KV_PREFIX) || DEFAULT_KV_PREFIX).replace(/^\/+|\/+$/gu, '') || DEFAULT_KV_PREFIX;
}

function getKvSessionPrefix(env: PagesContextLike['env']): string {
  return `${getPrefix(env)}/session/`;
}

function getKvSessionKey(env: PagesContextLike['env'], sessionId: string): string {
  return `${getKvSessionPrefix(env)}${sessionId}`;
}

function isPresenceSessionRecord(value: unknown): value is PresenceSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PresenceSessionRecord>;
  return Boolean(
    readSessionId(record.id)
    && typeof record.firstSeenAt === 'string'
    && typeof record.lastSeenAt === 'string'
    && Number.isFinite(record.heartbeatCount),
  );
}

function cleanupSessions(sessions: PresenceSessionRecord[], now: number): PresenceSessionRecord[] {
  return sessions
    .filter((session) => {
      const lastSeen = Date.parse(session.lastSeenAt || session.firstSeenAt || '');
      return Number.isFinite(lastSeen) && now - lastSeen <= SESSION_RETENTION_MS;
    })
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .slice(0, MAX_SESSIONS);
}

function countOnlineSessions(sessions: PresenceSessionRecord[], now: number): number {
  return sessions.filter((session) => {
    const lastSeen = Date.parse(session.lastSeenAt);
    return Number.isFinite(lastSeen) && now - lastSeen <= HEARTBEAT_TTL_MS;
  }).length;
}

function buildPresenceBody(sessions: PresenceSessionRecord[], now: number): PresenceBody {
  const cleaned = cleanupSessions(sessions, now);
  const online = countOnlineSessions(cleaned, now);
  const serverTime = new Date(now).toISOString();
  return {
    online,
    onlineCount: online,
    onlineSessionCount: online,
    totalRecentCount: cleaned.length,
    ttlSeconds: Math.floor(HEARTBEAT_TTL_MS / 1000),
    updatedAt: serverTime,
    serverTime,
    storage: 'kv',
  };
}

function buildDisabledPresenceBody(now = Date.now()): PresenceBody {
  const serverTime = new Date(now).toISOString();
  return {
    online: 0,
    onlineCount: 0,
    onlineSessionCount: 0,
    totalRecentCount: 0,
    ttlSeconds: 0,
    updatedAt: serverTime,
    serverTime,
    storage: 'disabled',
    disabled: true,
  };
}

function noStore(init: ResponseInit = {}): ResponseInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'cache-control': 'no-store',
    },
  };
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, noStore({ status }));
}

function isAllowedWriteOrigin(request: Request, env: PagesContextLike['env']): boolean {
  const suppliedOrigin = readText(request.headers.get('Origin'));
  if (!suppliedOrigin) return false;
  const requestOrigin = new URL(request.url).origin;
  const additionalOrigins = readText(env.PRESENCE_ALLOWED_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return suppliedOrigin === requestOrigin || additionalOrigins.includes(suppliedOrigin);
}

async function readKvSessions(env: PagesContextLike['env'], kv: KvNamespaceLike): Promise<PresenceSessionRecord[]> {
  const sessions: PresenceSessionRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: getKvSessionPrefix(env), limit: MAX_SESSIONS, cursor });
    const records = await Promise.all(page.keys.map((key) => kv.get<PresenceSessionRecord>(key.name, 'json').catch(() => null)));
    for (const record of records) {
      if (isPresenceSessionRecord(record)) sessions.push(record);
    }
    cursor = page.list_complete || sessions.length >= MAX_SESSIONS ? undefined : page.cursor;
  } while (cursor);
  return sessions.slice(0, MAX_SESSIONS);
}

async function writeKvSession(env: PagesContextLike['env'], kv: KvNamespaceLike, session: PresenceSessionRecord): Promise<void> {
  await kv.put(getKvSessionKey(env, session.id), JSON.stringify(session), {
    expirationTtl: Math.floor(SESSION_RETENTION_MS / 1000),
  });
}

async function upsertPresenceSession(params: {
  env: PagesContextLike['env'];
  kv: KvNamespaceLike;
  sessionId: string;
  now: number;
}): Promise<PresenceSessionRecord[]> {
  const sessions = cleanupSessions(await readKvSessions(params.env, params.kv), params.now);
  const previous = sessions.find((session) => session.id === params.sessionId);
  const nowIso = new Date(params.now).toISOString();
  const next: PresenceSessionRecord = {
    id: params.sessionId,
    firstSeenAt: previous?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    heartbeatCount: (previous?.heartbeatCount || 0) + 1,
  };
  await writeKvSession(params.env, params.kv, next);
  return cleanupSessions([next, ...sessions.filter((session) => session.id !== next.id)], params.now);
}

export async function handlePresenceGet(
  { env }: PagesContextLike,
  options: PresenceHandlerOptions = {},
): Promise<Response> {
  const enabled = options.enabled ?? PRESENCE_SYSTEM_ENABLED;
  const now = options.now ?? Date.now();
  if (!enabled) return jsonResponse(buildDisabledPresenceBody(now), noStore());
  const kv = getKvNamespace(env);
  if (!kv) return errorResponse('在线状态 KV 尚未配置。', 503);
  const sessions = await readKvSessions(env, kv);
  return jsonResponse(buildPresenceBody(sessions, now), noStore());
}

export async function handlePresencePost(
  { request, env }: PagesContextLike,
  options: PresenceHandlerOptions = {},
): Promise<Response> {
  const enabled = options.enabled ?? PRESENCE_SYSTEM_ENABLED;
  const now = options.now ?? Date.now();
  if (!enabled) return jsonResponse(buildDisabledPresenceBody(now), noStore());
  if (!isAllowedWriteOrigin(request, env)) return errorResponse('拒绝跨来源在线心跳。', 403);

  let sessionId = '';
  try {
    const payload = await request.json() as { sessionId?: unknown };
    sessionId = readSessionId(payload.sessionId);
  } catch {
    sessionId = '';
  }
  if (!sessionId) return errorResponse('在线心跳 sessionId 必须是有效 UUID。', 400);

  const clientIp = getClientIp(request);
  if (!clientIp) return errorResponse('无法识别在线心跳来源。', 400);
  const rateLimiter = getRateLimiter(env);
  if (!rateLimiter) return errorResponse('在线状态限流器尚未配置。', 503);
  const rate = await rateLimiter.limit({ key: clientIp });
  if (!rate.success) return errorResponse('在线心跳请求过于频繁。', 429);

  const kv = getKvNamespace(env);
  if (!kv) return errorResponse('在线状态 KV 尚未配置。', 503);
  const sessions = await upsertPresenceSession({ env, kv, sessionId, now });
  return jsonResponse(buildPresenceBody(sessions, now), noStore());
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, {
  status: 204,
  headers: {
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  },
});

export const onRequestGet = (context: PagesContextLike): Promise<Response> => handlePresenceGet(context);
export const onRequestPost = (context: PagesContextLike): Promise<Response> => handlePresencePost(context);
