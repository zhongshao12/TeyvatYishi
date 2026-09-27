import { officialOpeningTemplates, startingScenarios } from './journeyPresets';
import { createBuiltinWorldbooks } from './worldbookPresets';
import { bundledCodexPresets } from './codexPreset';

export type ContentResourceKind = 'opening' | 'scenario' | 'worldbook' | 'worldbook-entry' | 'codex';

export interface ContentResourceDescriptor {
  id: string;
  kind: ContentResourceKind;
  version: number | string;
  source: 'source' | 'bundled-json';
  references?: string[];
  path?: string;
}

/** Metadata only; source definitions remain the single owner of all actual content. */
export function buildBuiltinContentRegistry(): ContentResourceDescriptor[] {
  const books = createBuiltinWorldbooks();
  return [
    ...officialOpeningTemplates.map((template): ContentResourceDescriptor => ({
      id: `opening:${template.id}`, kind: 'opening', version: 1, source: 'source',
      references: template.起始场景 ? [`scenario:${template.起始场景}`] : [],
    })),
    ...startingScenarios.map((scenario): ContentResourceDescriptor => ({
      id: `scenario:${scenario.id}`, kind: 'scenario', version: 1, source: 'source',
      references: scenario.officialPresetId ? [`opening:${scenario.officialPresetId}`] : [],
    })),
    ...books.flatMap((book): ContentResourceDescriptor[] => [
      { id: `worldbook:${book.id}`, kind: 'worldbook', version: 1, source: 'source' },
      ...book.entries.map((entry): ContentResourceDescriptor => ({
        id: `worldbook-entry:${book.id}:${entry.id}`, kind: 'worldbook-entry',
        version: entry.contentVersion ?? 1, source: 'source', references: [`worldbook:${book.id}`],
      })),
    ]),
    ...bundledCodexPresets.map((preset): ContentResourceDescriptor => ({
      id: `codex:${preset.id}`, kind: 'codex', version: preset.updatedAt ?? preset.id,
      source: 'bundled-json', path: preset.path,
    })),
  ];
}

export function validateContentResources(
  resources: readonly ContentResourceDescriptor[],
  fileExists?: (path: string) => boolean,
): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const resource of resources) {
    if (!resource.id.trim() || ids.has(resource.id)) issues.push(`duplicate or empty ID: ${resource.id}`);
    ids.add(resource.id);
    if ((typeof resource.version === 'number' && (!Number.isInteger(resource.version) || resource.version <= 0))
      || (typeof resource.version === 'string' && !resource.version.trim())) issues.push(`invalid version: ${resource.id}`);
    if (resource.source === 'bundled-json' && (!resource.path || !resource.path.startsWith('/') || (fileExists && !fileExists(resource.path)))) {
      issues.push(`missing bundled file: ${resource.id} ${resource.path ?? ''}`);
    }
  }
  for (const resource of resources) {
    for (const reference of resource.references ?? []) {
      if (!ids.has(reference)) issues.push(`missing reference: ${resource.id} -> ${reference}`);
    }
  }
  return issues;
}
