import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { buildSaveTreePackage, readSavePackageEntries } from '@/services/savePackage';

const SECRET = 'sk-live-provider-secret-9f2b';

type MutableSave = ReturnType<typeof createEmptyTeyvatGameState> & Record<string, unknown>;

function buildSaveWithSecrets(overrides: Record<string, unknown> = {}): MutableSave {
  const save = {
    ...createEmptyTeyvatGameState(),
    id: 1,
    type: 'manual',
    timestamp: 1,
    turnCount: 3,
    apiSettings: { activeConfigId: 'a', configs: [{ id: 'a', apiKey: SECRET, model: 'gpt-image-1' }] },
    gameSettings: { variableApi: { apiKey: SECRET } },
    ...overrides,
  } as MutableSave;
  return save;
}

async function readPackageEntries(blob: Blob): Promise<Map<string, string>> {
  return readSavePackageEntries(await blob.arrayBuffer());
}

describe('save package API key privacy claim', () => {
  it('never writes provider keys into the exported product and reports the real scan result', async () => {
    const blob = await buildSaveTreePackage([buildSaveWithSecrets()]);
    const files = await readPackageEntries(blob);
    const manifest = JSON.parse(files.get('manifest.json') ?? '{}') as { privacy?: { apiKeysRemoved?: boolean } };

    expect(JSON.stringify([...files.values()])).not.toContain(SECRET);
    expect(manifest.privacy?.apiKeysRemoved).toBe(true);
  });

  it('reports apiKeysRemoved=false when a key is still findable in the exported product', async () => {
    const save = buildSaveWithSecrets();
    // 密钥被粘进了叙事数据：白名单不会、也不该改写玩家文本，因此只能如实报告。
    save.旅行者 = { ...save.旅行者, 姓名: SECRET };

    const blob = await buildSaveTreePackage([save]);
    const files = await readPackageEntries(blob);
    const manifest = JSON.parse(files.get('manifest.json') ?? '{}') as { privacy?: { apiKeysRemoved?: boolean } };

    expect(JSON.stringify([...files.values()])).toContain(SECRET);
    expect(manifest.privacy?.apiKeysRemoved).toBe(false);
  });

  it('keeps the exported save usable after the key strip', async () => {
    const save = buildSaveWithSecrets();
    const blob = await buildSaveTreePackage([save]);
    const files = await readPackageEntries(blob);
    const nodes = [...files.entries()].filter(([name]) => name.startsWith('tree/nodes/'));

    expect(nodes).toHaveLength(1);
    const node = JSON.parse(nodes[0]?.[1] ?? '{}') as Record<string, unknown>;
    expect(node.universe).toBe('teyvat');
    expect(node.schemaVersion).toBe(2);
    expect(node.turnCount).toBe(3);
    expect(node).not.toHaveProperty('apiSettings');
    expect(node).not.toHaveProperty('gameSettings');
  });
});
