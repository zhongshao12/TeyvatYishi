import type { Plugin, ViteDevServer } from 'vite';
import { Readable } from 'node:stream';
import {
  ANT_LING_PROXY_PREFIX,
  antLingLocalOriginAllowed,
  handleAntLingProxyRequest,
} from '../services/ai/antLingProxyCore';

/**
 * 本机开发/预览用的蚂蚁百灵同源转发。
 *
 * 只处理 `/api/antling` 这一条路径，只接受同源页面；转发目标由 `antLingProxyCore` 固定为
 * https://api.ant-ling.com/v1。用户 Key 只出现在本次请求体里，不写盘、不进日志。
 */
export function antLingProxyPlugin(): Plugin {
  const install = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use((req, res, next) => {
      const pathname = (req.url ?? '').split('?')[0] ?? '';
      if (pathname !== ANT_LING_PROXY_PREFIX) { next(); return; }
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '蚂蚁百灵转发只接受 POST。' }));
        return;
      }
      const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
      const url = new URL(req.url ?? ANT_LING_PROXY_PREFIX, `${protocol}//${req.headers.host ?? '127.0.0.1'}`);
      if (!antLingLocalOriginAllowed(url, new Headers(req.headers as Record<string, string>))) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '蚂蚁百灵转发只接受同源页面请求。' }));
        return;
      }
      const abort = new AbortController();
      const stop = () => { if (!res.writableFinished) abort.abort(new DOMException('蚂蚁百灵请求已取消。', 'AbortError')); };
      req.once('aborted', stop);
      res.once('close', stop);
      void (async () => {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          length += part.length;
          if (length > 2 * 1024 * 1024) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: '蚂蚁百灵请求体超过 2MiB。' }));
            return;
          }
          chunks.push(part);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
        const input = new Request(url, { method: 'POST', headers, body, signal: abort.signal });
        const upstream = await handleAntLingProxyRequest(input);
        if (abort.signal.aborted || res.destroyed) { await upstream.body?.cancel(); return; }
        res.statusCode = upstream.status;
        upstream.headers.forEach((value, key) => res.setHeader(key, value));
        if (!upstream.body) { res.end(); return; }
        const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
        res.once('close', () => stream.destroy());
        stream.once('error', (error: Error) => res.destroy(error));
        stream.pipe(res);
      })().catch((error: unknown) => {
        if (res.destroyed || abort.signal.aborted) return;
        if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return; }
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: `蚂蚁百灵转发失败：${error instanceof Error ? error.message : String(error)}` }));
      });
    });
  };
  return { name: 'teyvat-ant-ling-proxy', configureServer: install, configurePreviewServer: install };
}
