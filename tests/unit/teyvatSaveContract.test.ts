import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import {
  buildSavePackage,
  buildSaveTreePackage,
  parseSavePackageByUniverse,
} from '@/services/savePackage';
import { resolveRawMigrationBackupText } from '@/services/exportService';
import { buildDeltaOnlyStoredSave, buildSaveNodeDeltaRecord } from '@/utils/saveDeltaStorage';
import {
  createCatalogRecordFromSummary,
  createHiddenDeltaBaseCatalogRecord,
  createUnreadableSaveCatalogRecord,
  normalizeSaveCatalogRecord,
  type SaveListItemSummary,
} from '@/services/storage/saveCatalog';
import type { CloudBackupNodeMeta, CloudBackupPointerV2 } from '@/services/cloudBackupPackage';

const dbSpies = vi.hoisted(() => ({
  stageCloudMergeRecord: vi.fn(),
  getSaveCatalogSnapshot: vi.fn(),
  workerConstructed: vi.fn(),
}));

vi.mock('@/services/dbService', () => ({
  clearCloudMergeStaging: vi.fn(async () => undefined),
  commitCloudMergeStaging: vi.fn(async () => ({ saveIds: [] })),
  deleteCloudMergeStagedRecord: vi.fn(async () => undefined),
  getSaveCatalogSnapshot: dbSpies.getSaveCatalogSnapshot,
  loadCloudMergeStagedRecord: vi.fn(async () => null),
  loadSaveForCloudTransfer: vi.fn(async () => null),
  stageCloudMergeRecord: dbSpies.stageCloudMergeRecord,
}));

vi.mock('@/services/cloudBackupWorkerClient', () => ({
  CloudBackupWorkerClient: class {
    constructor() {
      dbSpies.workerConstructed();
    }

    dispose() {}
  },
}));

const emptyCatalogSnapshot = {
    items: [],
    legacyBackups: [],
    pendingIds: [],
    unreadableIds: [],
    staleCatalogIds: [],
    hiddenBaseCount: 0,
    totalStoredCount: 0,
    catalogComplete: true,
};

dbSpies.getSaveCatalogSnapshot.mockResolvedValue(emptyCatalogSnapshot);

import { mergeDownloadedCloudBackup } from '@/services/cloudBackupMerge';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/saves', name), 'utf8'));
}

async function packageLegacyFixture(raw: unknown, sidecars: Record<string, unknown> = {}): Promise<ArrayBuffer> {
  const manifest = {
    app: 'KaiTuoYiShi',
    kind: 'save-package',
    format: 'ktysave',
    packageVersion: 2,
    universe: 'legacy-hsr',
    schemaVersion: 1,
    files: ['manifest.json', 'save.json', ...Object.keys(sidecars)],
  };
  const encoder = new TextEncoder();
  const parts = Object.entries({ 'manifest.json': manifest, 'save.json': raw, ...sidecars }).map(([name, value]) => {
    const nameBytes = encoder.encode(name);
    const content = encoder.encode(JSON.stringify(value));
    const bytes = new Uint8Array(30 + nameBytes.length + content.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, testCrc32(content), true);
    view.setUint32(18, content.length, true);
    view.setUint32(22, content.length, true);
    view.setUint16(26, nameBytes.length, true);
    bytes.set(nameBytes, 30);
    bytes.set(content, 30 + nameBytes.length);
    return bytes;
  });
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes.buffer;
}

async function withStoredZip<T>(operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream');
  Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, writable: true, value: undefined });
  try {
    return await operation();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'CompressionStream', descriptor);
    else delete (globalThis as { CompressionStream?: unknown }).CompressionStream;
  }
}

function readStoredZipEntry(buffer: ArrayBuffer, expectedName: string): string {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const contentStart = offset + 30 + nameLength + extraLength;
    if (name === expectedName) {
      if (compression !== 0) throw new Error('test expected a stored ZIP entry');
      return new TextDecoder().decode(bytes.subarray(contentStart, contentStart + size));
    }
    offset = contentStart + size;
  }
  throw new Error(`missing ZIP entry: ${expectedName}`);
}

function replaceStoredZipText(buffer: ArrayBuffer, from: string, to: string): ArrayBuffer {
  if (from.length !== to.length) throw new Error('replacement must preserve ZIP entry length');
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const needle = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const contentStart = offset + 30 + nameLength + extraLength;
    const content = bytes.subarray(contentStart, contentStart + size);
    for (let index = 0; index <= content.length - needle.length; index += 1) {
      if (!needle.every((byte, needleIndex) => content[index + needleIndex] === byte)) continue;
      content.set(replacement, index);
      const checksum = testCrc32(content);
      view.setUint32(offset + 14, checksum, true);
      let centralOffset = contentStart + size;
      while (centralOffset + 46 <= bytes.length) {
        const signature = view.getUint32(centralOffset, true);
        if (signature === 0x06054b50) break;
        if (signature !== 0x02014b50) {
          centralOffset += 1;
          continue;
        }
        const centralNameLength = view.getUint16(centralOffset + 28, true);
        const centralExtraLength = view.getUint16(centralOffset + 30, true);
        const commentLength = view.getUint16(centralOffset + 32, true);
        const centralName = new TextDecoder().decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + centralNameLength));
        if (centralName === name) view.setUint32(centralOffset + 16, checksum, true);
        centralOffset += 46 + centralNameLength + centralExtraLength + commentLength;
      }
      return bytes.buffer;
    }
    offset = contentStart + size;
  }
  throw new Error(`missing ZIP text: ${from}`);
}

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function summary(overrides: Partial<SaveListItemSummary> = {}): SaveListItemSummary {
  return {
    id: 1,
    type: 'manual',
    timestamp: 1,
    travelerName: '荧',
    turnCount: 0,
    worldPeriodName: '',
    currentDate: '',
    currentTime: '',
    currentLocation: '',
    lastSummary: '',
    sizeBytes: 0,
    ...overrides,
  };
}

function cloudNode(overrides: Partial<CloudBackupNodeMeta>): CloudBackupNodeMeta {
  return {
    sourceSaveId: 1,
    type: 'manual',
    timestamp: 1,
    turnCount: 0,
    universe: 'teyvat',
    schemaVersion: 2,
    fingerprint: 'a'.repeat(64),
    entryPath: 'nodes/one.json',
    partIndex: 0,
    ...overrides,
  };
}

describe('Teyvat save package contract', () => {
  it('writes delta placeholders and payloads only with formal Teyvat roots', () => {
    const base = {
      ...createEmptyTeyvatGameState(),
      id: 1,
      type: 'auto',
      timestamp: 1,
      saveTree: { rootId: 'root-1', nodeId: 'node-1' },
    } as never;
    const current = {
      ...createEmptyTeyvatGameState(),
      id: 2,
      type: 'auto',
      timestamp: 2,
      saveTree: { rootId: 'root-1', nodeId: 'node-2', parentNodeId: 'node-1' },
    } as never;
    const delta = buildSaveNodeDeltaRecord(current, 2, {
      baseSave: base,
      baseSaveId: 1,
      storageMode: 'delta',
    });
    const placeholder = buildDeltaOnlyStoredSave(current, 1);

    expect(delta?.baseMode).toBe('delta');
    expect(JSON.stringify(delta)).not.toMatch(/"忆庭"|"智库"|"信使"|"新闻"|"旅人"/u);
    expect(placeholder).toMatchObject({ universe: 'teyvat', schemaVersion: 2, 对话: { entries: [] } });
    expect(JSON.stringify(placeholder)).not.toMatch(/"忆庭"|"智库"|"信使"|"新闻"|"旅人"/u);
    expect(() => buildDeltaOnlyStoredSave(readFixture('legacy-hsr-save.json') as never, 1)).toThrow('LEGACY_HSR_SAVE_READ_ONLY');
    expect(buildSaveNodeDeltaRecord(readFixture('legacy-hsr-save.json') as never, 1)).toBeNull();
  });

  it('round-trips a Teyvat save with an exact universe-versioned manifest', async () => {
    const teyvatSave = createEmptyTeyvatGameState();
    const blob = await buildSavePackage(teyvatSave);
    const parsed = await parseSavePackageByUniverse(await blob.arrayBuffer());

    expect(parsed.kind).toBe('teyvat');
    if (parsed.kind !== 'teyvat') return;
    expect(parsed.manifest).toEqual({
      app: 'KaiTuoYiShi',
      kind: 'save-package',
      format: 'ktysave',
      packageVersion: 2,
      universe: 'teyvat',
      schemaVersion: 2,
      files: ['manifest.json', 'save.json'],
    });
    expect(parsed.save).toEqual(teyvatSave);
    expect(JSON.stringify(parsed)).not.toMatch(/"主命途"|"命途列表"|"信使"|"忆庭"/);
  });

  it('returns a real HSR package untouched without Teyvat normalization', async () => {
    const raw = readFixture('legacy-hsr-save.json');
    const parsed = await parseSavePackageByUniverse(await packageLegacyFixture(raw));

    expect(parsed).toEqual({ kind: 'legacy-hsr', raw: expect.objectContaining(raw as object) });
  });

  it('keeps legacy saves read-only and writes a Teyvat/2 tree manifest', async () => {
    const raw = readFixture('legacy-hsr-save.json');
    await expect(buildSavePackage(raw as never)).rejects.toThrow('LEGACY_HSR_SAVE_READ_ONLY');
    await expect(buildSaveTreePackage([raw as never])).rejects.toThrow('LEGACY_HSR_SAVE_READ_ONLY');

    const state = createEmptyTeyvatGameState() as ReturnType<typeof createEmptyTeyvatGameState> & Record<string, unknown>;
    state.id = 1;
    state.type = 'manual';
    state.timestamp = 1;
    state.saveTree = { rootId: 'root-1', nodeId: 'node-1' };
    const tree = await withStoredZip(async () => buildSaveTreePackage([state as never]));
    expect(JSON.parse(readStoredZipEntry(await tree.arrayBuffer(), 'manifest.json'))).toMatchObject({
      universe: 'teyvat',
      schemaVersion: 2,
    });
  });

  it.each(['legacy-hsr-save.json', 'partial-teyvat-save.json'])(
    'rejects an unsupported explicit manifest pair before classifying %s raw data',
    async (fixture) => {
      const raw = readFixture(fixture);
      const buffer = await packageLegacyFixture(raw);
      const invalidBuffer = replaceStoredZipText(
        buffer,
        '"schemaVersion":1',
        '"schemaVersion":2',
      );

      const parsed = await parseSavePackageByUniverse(invalidBuffer);
      expect(parsed.kind).toBe('invalid');
      if (parsed.kind === 'invalid') expect(parsed.errors.join(' ')).toMatch(/universe|schema/i);
    },
  );

  it('returns the migration result for a partial Teyvat package', async () => {
    const raw = readFixture('partial-teyvat-save.json');
    const parsed = await parseSavePackageByUniverse(await packageLegacyFixture(raw));

    expect(parsed.kind).toBe('partial-teyvat');
    if (parsed.kind !== 'partial-teyvat') return;
    expect(parsed.raw).toEqual(expect.objectContaining(raw as object));
    expect(['migrated', 'needs-input']).toContain(parsed.migration.status);
  });

  it('keeps the exact save.json backup object separate from restored legacy sidecars', async () => {
    const raw = readFixture('partial-teyvat-save.json');
    const sidecar = { contacts: [{ id: 'legacy-contact' }] };
    const parsed = await parseSavePackageByUniverse(await packageLegacyFixture(raw, {
      'systems/phone.json': sidecar,
    }));

    expect(parsed.kind).toBe('partial-teyvat');
    if (parsed.kind !== 'partial-teyvat') return;
    expect(parsed.raw).toEqual(expect.objectContaining({ ...(raw as object), 手机: sidecar }));
    expect(parsed.sourceBackupRaw).toEqual(raw);
    expect(JSON.parse(parsed.sourceJsonBytes)).toEqual(raw);
    expect(resolveRawMigrationBackupText(parsed.sourceBackupRaw, parsed.sourceJsonBytes)).toBe(parsed.sourceJsonBytes);
  });
});

describe('catalog and cloud universe isolation', () => {
  it('persists universe and schemaVersion on every catalog record', () => {
    expect(createCatalogRecordFromSummary(summary({ universe: 'teyvat', schemaVersion: 2 }))).toMatchObject({
      universe: 'teyvat',
      schemaVersion: 2,
    });
  });

  it('confines missing metadata defaults to historical catalog normalization', () => {
    expect(() => createCatalogRecordFromSummary(summary())).toThrow(/universe|schema/i);
    expect(() => createHiddenDeltaBaseCatalogRecord({ id: 2 })).toThrow(/universe|schema/i);
    expect(() => createUnreadableSaveCatalogRecord({ id: 3, error: new Error('broken') })).toThrow(/universe|schema/i);

    expect(normalizeSaveCatalogRecord({
      ...summary(),
      catalogVersion: 2,
      visibility: 'visible',
    })).toMatchObject({ universe: 'legacy-hsr', schemaVersion: 1 });
    expect(normalizeSaveCatalogRecord({
      id: 4,
      catalogVersion: 3,
      visibility: 'unreadable',
      universe: 'teyvat',
      schemaVersion: 3,
      lastErrorCode: 'broken',
      failedAt: 1,
      retryCount: 1,
    })).toBeNull();
  });

  it.each([
    ['cross-universe', cloudNode({ universe: 'legacy-hsr', schemaVersion: 1, entryPath: 'nodes/two.json' })],
    ['incompatible-schema', cloudNode({ schemaVersion: 3, entryPath: 'nodes/two.json' })],
  ])('rejects %s cloud nodes before staging any write', async (_label, incompatibleNode) => {
    dbSpies.stageCloudMergeRecord.mockClear();
    dbSpies.workerConstructed.mockClear();
    dbSpies.getSaveCatalogSnapshot.mockResolvedValue(emptyCatalogSnapshot);
    const pointer: CloudBackupPointerV2 = {
      app: 'KaiTuoYiShi',
      kind: 'github-cloud-backup',
      version: 2,
      snapshotId: 'snapshot-test',
      createdAt: new Date(0).toISOString(),
      nodeCount: 2,
      treeCount: 0,
      legacyBackupCount: 0,
      assetCount: 0,
      totalBytes: 0,
      parts: [],
      nodes: [cloudNode({}), incompatibleNode],
      assets: [],
    };

    await expect(mergeDownloadedCloudBackup('download-test', pointer)).rejects.toThrow(/宇宙|schema/i);
    expect(dbSpies.stageCloudMergeRecord).not.toHaveBeenCalled();
    expect(dbSpies.workerConstructed).not.toHaveBeenCalled();
  });

  it('rejects an incompatible local catalog before constructing a cloud worker', async () => {
    dbSpies.stageCloudMergeRecord.mockClear();
    dbSpies.workerConstructed.mockClear();
    dbSpies.getSaveCatalogSnapshot.mockResolvedValue({
      ...emptyCatalogSnapshot,
      items: [summary({ universe: 'legacy-hsr', schemaVersion: 1 })],
      totalStoredCount: 1,
    });
    const pointer: CloudBackupPointerV2 = {
      app: 'KaiTuoYiShi',
      kind: 'github-cloud-backup',
      version: 2,
      snapshotId: 'snapshot-local-mismatch',
      createdAt: new Date(0).toISOString(),
      nodeCount: 1,
      treeCount: 0,
      legacyBackupCount: 0,
      assetCount: 0,
      totalBytes: 0,
      parts: [],
      nodes: [cloudNode({})],
      assets: [],
    };

    await expect(mergeDownloadedCloudBackup('download-local-mismatch', pointer)).rejects.toThrow(/宇宙|schema|LEGACY_HSR_SAVE_READ_ONLY/i);
    expect(dbSpies.workerConstructed).not.toHaveBeenCalled();
    expect(dbSpies.stageCloudMergeRecord).not.toHaveBeenCalled();
  });
});
