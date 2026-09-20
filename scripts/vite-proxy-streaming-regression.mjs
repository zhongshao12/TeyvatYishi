import fs from 'node:fs';

const source = fs.readFileSync('vite.config.ts', 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(`[vite-proxy-streaming] ${message}`);
};

assert(!source.includes('response.arrayBuffer()'), 'dev API proxies must not buffer complete upstream responses');
assert(source.includes("from 'node:stream'"), 'dev proxy must bridge Web streams through Node Readable');
assert(source.includes('Readable.fromWeb('), 'dev proxy must pipe upstream response bodies incrementally');
assert(
  (source.match(/forwardProxyResponse\(response, res\)/g) ?? []).length === 4,
  'all four local API proxy routes must use the shared streaming response bridge',
);
assert(
  (source.match(/createProxyRequest\(req, res,/g) ?? []).length === 4,
  'all four local proxy requests must bind browser disconnects to an AbortSignal',
);
assert(
  source.includes("req.once('aborted', abort)") && source.includes("res.once('close', abort)"),
  'local proxy cancellation must observe both request abort and response disconnect',
);

console.log('vite proxy streaming regression ok');
