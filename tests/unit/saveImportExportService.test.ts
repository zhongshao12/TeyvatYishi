import { describe, expect, it } from 'vitest';
import { importSaveJson } from '@/services/storage/saveImportExportService';
import { createEmptyTeyvatGameState } from '@/models/teyvat';

describe('save import/export service boundary', () => {
  it('normalizes a native Teyvat JSON save', () => {
    const source = createEmptyTeyvatGameState();
    const imported = importSaveJson(JSON.stringify(source));
    expect(imported.universe).toBe('teyvat');
    expect(imported.schemaVersion).toBe(2);
  });

  it('rejects unrelated JSON', () => {
    expect(() => importSaveJson('{"hello":"world"}')).toThrow('无效的存档文件');
  });
});
