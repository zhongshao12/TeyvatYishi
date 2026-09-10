import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { handleQianfanProxyRequest } from './services/ai/qianfanProxyCore';
import { handleOpenCodeProxyRequest } from './services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from './services/ai/pioneerProxyCore';
import { handleArkProxyRequest } from './services/ai/arkProxyCore';

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

export default defineConfig({
  plugins: [
    react(),
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
          const response = await handleQianfanProxyRequest(new Request('http://localhost/api/qianfan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
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
          const response = await handleOpenCodeProxyRequest(new Request('http://localhost/api/opencode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
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
          const response = await handlePioneerProxyRequest(new Request('http://localhost/api/pioneer', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
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
          const response = await handleArkProxyRequest(new Request('http://localhost/api/ark', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await response.arrayBuffer()));
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
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) {
            if (id.includes('/services/') || id.includes('/hooks/') || id.includes('/models/')) return 'chunk-app';
            return undefined;
          }
          // 按包名精确匹配，避免路径子串误判（如 lucide-react 被含 "react" 的通用规则截走）。
          // 兼容 pnpm 的 .pnpm/<pkg>@<ver>/node_modules/<pkg> 嵌套布局。
          const marker = id.lastIndexOf('node_modules/');
          const rest = id.slice(marker + 'node_modules/'.length);
          const pkg = rest.startsWith('@') ? rest.split('/').slice(0, 2).join('/') : rest.split('/')[0];
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
          if (pkg === 'lucide-react') return 'vendor-icons';
          if (pkg.startsWith('@dnd-kit')) return 'vendor-dnd';
          return 'vendor-other';
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
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
