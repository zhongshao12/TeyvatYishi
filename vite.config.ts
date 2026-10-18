import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleQianfanProxyRequest } from './services/ai/qianfanProxyCore';
import { handleOpenCodeProxyRequest } from './services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from './services/ai/pioneerProxyCore';
import { handleArkProxyRequest } from './services/ai/arkProxyCore';
import { resolveManualChunk } from './build/manualChunkStrategy';
import { localOllamaProxyPlugin } from './build/localOllamaProxy';
import { antLingProxyPlugin } from './build/antLingProxy';

function readRequestBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function forwardProxyResponse(response: Response, res: ServerResponse): void {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const source = Readable.fromWeb(
    response.body as unknown as import('node:stream/web').ReadableStream,
  );
  const stopSource = () => {
    if (!source.destroyed) source.destroy();
  };
  res.once('close', stopSource);
  source.once('end', () => res.off('close', stopSource));
  source.once('error', (error) => {
    res.off('close', stopSource);
    res.destroy(error);
  });
  source.pipe(res);
}

function createProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathName: string,
  body: string,
): Request {
  const abortController = new AbortController();
  const abort = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  return new Request(`http://localhost${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: abortController.signal,
  });
}

export default defineConfig({
  // Keep the running dev optimizer separate from test/tool caches. Prebundle lazy
  // settings dependencies up front instead of discovering them on the first click.
  cacheDir: 'node_modules/.vite-dev',
  optimizeDeps: { include: ['react', 'react-dom/client', 'lucide-react', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'] },
  plugins: [
    react(),
    localOllamaProxyPlugin(),
    antLingProxyPlugin(),
    {
      name: 'kty-local-qianfan-proxy',
      configureServer(server) {
        server.middlewares.use('/api/qianfan', async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }
          const body = await readRequestBody(req);
          const response = await handleQianfanProxyRequest(createProxyRequest(req, res, '/api/qianfan', body));
          forwardProxyResponse(response, res);
        });
        server.middlewares.use('/api/opencode', async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }
          const body = await readRequestBody(req);
          const response = await handleOpenCodeProxyRequest(createProxyRequest(req, res, '/api/opencode', body));
          forwardProxyResponse(response, res);
        });
        server.middlewares.use('/api/pioneer', async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }
          const body = await readRequestBody(req);
          const response = await handlePioneerProxyRequest(createProxyRequest(req, res, '/api/pioneer', body));
          forwardProxyResponse(response, res);
        });
        server.middlewares.use('/api/ark', async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }
          const body = await readRequestBody(req);
          const response = await handleArkProxyRequest(createProxyRequest(req, res, '/api/ark', body));
          forwardProxyResponse(response, res);
        });
      },
    },
  ],
  define: {
    // 版本单一来源：首页展示版本从 package.json 注入，避免硬编码漂移。
    __APP_VERSION__: JSON.stringify(
      JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version,
    ),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  build: {
    // Tauri WebView2 与现代浏览器均支持 ES2022，减少转译产物体积。
    target: 'es2022',
    // 项目另有更严格的字节级 bundle 门禁；这里仅让 Vite 使用同量级提示阈值。
    chunkSizeWarningLimit: 1150,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          return resolveManualChunk(id);
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Local validation can contain live browser profiles / locked GPU caches.
    // They are not application inputs; watching them can crash Windows dev mode.
    watch: { ignored: ['**/.tmp-core2-validation/**'] },
    proxy: {
      // 本地测试用：z.ai（智谱 GLM）浏览器直连受 CORS 限制，走 dev 代理转发。
      // 前缀刻意不用 /api/ —— 客户端对 /api/ 开头的地址会省略 Authorization 头。
      '/zai-proxy': {
        target: 'https://api.z.ai',
        changeOrigin: true,
        rewrite: (pathName) => pathName.replace(/^\/zai-proxy/, ''),
      },
    },
  },
});
