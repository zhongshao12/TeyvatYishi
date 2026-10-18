import type { Plugin, ViteDevServer } from 'vite';
import { Readable } from 'node:stream';
import { handleLocalOllamaProxyRequest, LOCAL_OLLAMA_PROXY_PREFIX, localOllamaOriginAllowed } from '../services/ai/localOllamaProxyCore';

/** Both development and local production-preview servers use the same guarded route. */
export function localOllamaProxyPlugin(): Plugin {
  const install = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use((req, res, next) => {
      if (!(req.url ?? '').startsWith(LOCAL_OLLAMA_PROXY_PREFIX + '/')) { next(); return; }
      const abort = new AbortController();
      const stop = () => { if (!res.writableFinished) abort.abort(new DOMException('本地模型请求已取消。', 'AbortError')); };
      req.once('aborted', stop); res.once('close', stop);
      void (async () => {
        const headers = new Headers();
        for (const key of ['origin', 'content-type', 'sec-fetch-site']) if (typeof req.headers[key] === 'string') headers.set(key, req.headers[key]);
        const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https:' : 'http:';
        const url = new URL(req.url!, `${protocol}//${req.headers.host ?? ''}`), peer = req.socket.remoteAddress ?? '';
        if (!localOllamaOriginAllowed(url, headers, peer)) { res.statusCode = 403; res.end('本地模型转发只接受本机同源请求。'); return; }
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of req) {
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string); length += part.length;
          if (length > 8 * 1024 * 1024) { res.statusCode = 413; res.end('本地模型请求超过8MiB。'); return; }
          chunks.push(part);
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const input = new Request(url, { method: req.method, headers, signal: abort.signal, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body }) });
        const upstream = await handleLocalOllamaProxyRequest(input, { remoteAddress: peer });
        if (abort.signal.aborted || res.destroyed) { await upstream.body?.cancel(); return; }
        res.statusCode = upstream.status; upstream.headers.forEach((value, key) => res.setHeader(key, value));
        if (!upstream.body) { res.end(); return; }
        const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
        res.once('close', () => stream.destroy());
        stream.once('error', error => res.destroy(error)); stream.pipe(res);
      })().catch(error => {
        if (res.destroyed || abort.signal.aborted) return;
        if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return; }
        res.statusCode = 502; res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: '本地模型转发失败，请检查本机模型服务。' }));
      });
    });
  };
  return { name: 'teyvat-local-ollama-proxy', configureServer: install, configurePreviewServer: install };
}
