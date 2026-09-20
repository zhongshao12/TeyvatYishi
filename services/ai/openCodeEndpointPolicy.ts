export function normalizeOpenCodeBaseUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.split('?')[0] ?? base;
  base = base
    .replace(/\/zen\/go\/v1/i, '/zen/v1')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/messages$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/models(?:\/.*)?$/i, '');
  if (/^https:\/\/opencode\.ai$/i.test(base)) return `${base}/zen/v1`;
  if (/^https:\/\/opencode\.ai\/zen$/i.test(base)) return `${base}/v1`;
  return base;
}
