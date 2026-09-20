import type { 聊天消息 } from '@/models/chat';
import type { 角色数据结构 } from '@/models/character';
import type { 世界书 } from '@/models/worldbook';
import type { 相册系统 } from '@/models/imageGeneration';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';

function 回合文本(message: 聊天消息): string {
  const role = message.role === "assistant" ? "AI" : message.role === "user" ? "玩家" : "系统";
  const turn = message.gameTime ? `（第 ${message.gameTime} 回合）` : "";
  const body = message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content?.trim() || "";
  return `### ${role}${turn}${message.bookmark ? " · 书签" : ""}` + "\n\n" + body + "\n";
}

export function 导出剧情Markdown(messages: 聊天消息[]): string {
  const lines: string[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = 回合文本(message);
    if (text.trim()) lines.push(text);
  }
  return `# 旅行者纪事 剧情导出\n\n${lines.join("\n---\n")}`;
}

export function 导出剧情JSON(messages: 聊天消息[]): string {
  return JSON.stringify(Array.isArray(messages) ? messages : [], null, 2);
}

export function 导出角色档案(旅人: 角色数据结构): string {
  return JSON.stringify(旅人, null, 2);
}

export function 导出世界书(worldbooks: 世界书[]): string {
  return JSON.stringify(Array.isArray(worldbooks) ? worldbooks : [], null, 2);
}

export function 导出相册(album: 相册系统): string {
  return JSON.stringify(album, null, 2);
}

export function 下载文本文件(filename: string, content: string, mime = "application/json"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Exports exactly the parsed JSON content supplied by an imported archive. */
export async function exportRawSave(raw: unknown, sourceFileName = 'legacy-save'): Promise<void> {
  const serialized = stableJsonStringify(raw);
  downloadRawJson(safeRawSaveFilename(sourceFileName), serialized);
}

/**
 * Creates the mandatory, downloadable source backup before a user can write a migrated state.
 * The id is a content hash when Web Crypto is available; the fallback is explicitly non-hash.
 */
export async function createRawMigrationBackup(
  raw: unknown,
  sourceFileName = 'migration-source',
  sourceJsonBytes?: string,
): Promise<{ backupId: string }> {
  const serialized = resolveRawMigrationBackupText(raw, sourceJsonBytes);
  const backupId = await createRawBackupId(serialized);
  downloadRawJson(safeRawSaveFilename(`${sourceFileName}-${backupId}`), serialized);
  return { backupId };
}

/** Downloads the exact selected import file before Storage Manager writes any records. */
export async function createImportSourceFileBackup(
  file: Pick<File, 'name' | 'type' | 'arrayBuffer'>,
): Promise<{ backupId: string; fileName: string; byteLength: number }> {
  const bytes = await file.arrayBuffer();
  const backupId = await createBackupId(new Uint8Array(bytes));
  const fileName = safeImportSourceBackupFilename(file.name, backupId);
  const blob = new Blob([bytes], { type: file.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { backupId, fileName, byteLength: bytes.byteLength };
}

/** Keeps the imported JSON text byte-for-byte when it represents the parsed source object. */
export function resolveRawMigrationBackupText(raw: unknown, sourceJsonBytes?: string): string {
  if (sourceJsonBytes === undefined) return stableJsonStringify(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceJsonBytes);
  } catch {
    throw new Error('原档 JSON 字节已损坏，无法创建迁移前备份。');
  }
  if (stableJsonStringify(parsed) !== stableJsonStringify(raw)) {
    throw new Error('原档 JSON 字节与迁移预览不一致，已拒绝写入。');
  }
  return sourceJsonBytes;
}

function downloadRawJson(filename: string, serialized: string): void {
  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const WINDOWS_RESERVED_DEVICE_STEMS = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeRawSaveFilename(value: string): string {
  const raw = String(value || 'legacy-save').trim();
  const deviceStem = raw.split('.', 1)[0] ?? '';
  const stem = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72) || 'legacy-save';
  const safeStem = WINDOWS_RESERVED_DEVICE_STEMS.test(deviceStem) || WINDOWS_RESERVED_DEVICE_STEMS.test(stem)
    ? 'legacy-save'
    : stem;
  return `${safeStem}.json`;
}

async function createRawBackupId(serialized: string): Promise<string> {
  return createBackupId(new TextEncoder().encode(serialized));
}

async function createBackupId(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `sha256-${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
  }
  return `random-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeImportSourceBackupFilename(sourceName: string, backupId: string): string {
  const normalized = String(sourceName || 'import-source').trim();
  const extensionMatch = normalized.match(/\.(json|ktysave|zip)$/i);
  const extension = extensionMatch ? `.${(extensionMatch[1] ?? 'bin').toLowerCase()}` : '.bin';
  const rawStem = extensionMatch ? normalized.slice(0, -extensionMatch[0].length) : normalized;
  const stem = rawStem
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 72) || 'import-source';
  const safeStem = WINDOWS_RESERVED_DEVICE_STEMS.test(stem) ? 'import-source' : stem;
  return `${safeStem}-source-backup-${backupId}${extension}`;
}

function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('原档包含无法安全导出的非有限数值。');
      return current;
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (typeof current === 'object') {
      if (seen.has(current)) throw new Error('原档包含循环引用，无法安全导出。');
      seen.add(current);
      const normalized = Object.fromEntries(Object.keys(current as Record<string, unknown>).sort().map((key) => [key, normalize((current as Record<string, unknown>)[key])]));
      seen.delete(current);
      return normalized;
    }
    throw new Error('原档包含非 JSON 内容，无法安全导出。');
  };
  return JSON.stringify(normalize(value), null, 2);
}

/** 把导出的剧情 Markdown 解析回合列表（复用文本内容，供导入新局使用）。 */
export function 解析Markdown剧情(markdown: string): 聊天消息[] {
  const messages: 聊天消息[] = [];
  const blocks = (markdown || "").split(/^### /m);
  let counter = 0;
  for (const block of blocks) {
    if (!block.trim()) continue;
    const header = (block.split(/\r?\n/, 1)[0] ?? '').trim();
    const content = block.slice(header.length).trim();
    if (!content) continue;
    const role = header.startsWith("AI") ? "assistant" : header.startsWith("玩家") ? "user" : "assistant";
    counter += 1;
    messages.push({ id: `export_msg_${counter}`, role, content, timestamp: Date.now() + counter });
  }
  return messages;
}
