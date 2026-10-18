import type { AssetPublication, CoreAsset } from '../contracts/storage';
import { isCoreJsonData } from '../contracts/validation';
import { checksumBytes } from '../sources/sourceIntegrity';
import { assertId, ownDto, sameScope } from './repositoryValidation';

/** Separate binary boundary: the ordinary JSON validator must NOT accept typed arrays. */
export function dataFields(input: unknown, keys: string[], error: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
    Object.getOwnPropertySymbols(input).length) throw new Error(error);
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key]!, 'value'))) throw new Error(error);
  return Object.fromEntries(keys.map(key => [key, fields[key]!.value]));
}

export function ownAsset(input: CoreAsset): CoreAsset {
  const fields = dataFields(input, ['assetId', 'scope', 'mimeType', 'bytes', 'checksum'], 'CORE2_INVALID_ASSET');
  const { bytes, ...metadata } = fields;
  if (!isCoreJsonData(metadata) || typeof metadata.mimeType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(metadata.mimeType) ||
    typeof metadata.checksum !== 'string' || !/^[0-9a-f]{16}$/.test(metadata.checksum)) throw new Error('CORE2_INVALID_ASSET');
  let copy: Uint8Array;
  try {
    if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) throw new Error();
    // Intrinsic getters/copy avoid executing an overridden iterator, constructor,
    // buffer or length property. Shared buffers cannot produce a frozen source.
    const typedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const buffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer')!.get!.call(bytes) as unknown;
    const length = Object.getOwnPropertyDescriptor(typedArray, 'length')!.get!.call(bytes) as number;
    if (!(buffer instanceof ArrayBuffer) || !length) throw new Error();
    copy = new Uint8Array(length); Uint8Array.prototype.set.call(copy, bytes);
  } catch { throw new Error('CORE2_INVALID_ASSET'); }
  assertId(metadata.assetId as string);
  const scope = ownDto('scope', metadata.scope as CoreAsset['scope']);
  if (checksumBytes(copy) !== metadata.checksum) throw new Error('CORE2_ASSET_CHECKSUM_MISMATCH');
  return { assetId: metadata.assetId as string, scope, mimeType: metadata.mimeType, checksum: metadata.checksum, bytes: copy };
}

export function ownAssetPublication(input: AssetPublication): AssetPublication {
  const fields = dataFields(input, ['scope', 'sessionId', 'asset'], 'CORE2_INVALID_ASSET_PUBLICATION');
  const { asset, ...metadata } = fields;
  if (!isCoreJsonData(metadata)) throw new Error('CORE2_INVALID_ASSET_PUBLICATION');
  const scope = ownDto('scope', metadata.scope as AssetPublication['scope']); assertId(metadata.sessionId as string);
  const owned = ownAsset(asset as CoreAsset);
  if (!sameScope(scope, owned.scope)) throw new Error('CORE2_INVALID_ASSET_PUBLICATION');
  return { scope, sessionId: metadata.sessionId as string, asset: owned };
}

export function sameAsset(a: CoreAsset, b: CoreAsset): boolean {
  return a.assetId === b.assetId && sameScope(a.scope, b.scope) && a.mimeType === b.mimeType && a.checksum === b.checksum &&
    a.bytes.length === b.bytes.length && a.bytes.every((byte, index) => byte === b.bytes[index]);
}
