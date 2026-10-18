import type { AssetPublication, CoreAsset, CoreRepository, PreparedImport, ExportRecords } from '../contracts/storage';
import { ownAsset, ownAssetPublication } from './binaryAssets';
import { isCoreJsonData } from '../contracts/validation';
import { ownPreparedImport, validateImportGraph } from './preparedImports';

export interface WireAsset extends Omit<CoreAsset, 'bytes'> { bytesBase64: string }
export interface WireAssetPublication extends Omit<AssetPublication, 'asset'> { asset: WireAsset }
export interface WirePreparedImport extends Omit<PreparedImport, 'assets'> { assets: WireAsset[] }
export interface WireExportRecords extends Omit<ExportRecords, 'assets'> { assets: WireAsset[] }
export type CoreDesktopAction = keyof CoreRepository;
type WireArguments<A extends CoreDesktopAction> = A extends 'publishAsset' ? [WireAssetPublication] : A extends 'importPrepared' ? [WirePreparedImport] : Parameters<CoreRepository[A]>;
export type CoreStoreRequest = { [A in CoreDesktopAction]: { action: A; args: WireArguments<A> } }[CoreDesktopAction];
export interface CoreDesktopTransport { send(request: CoreStoreRequest): Promise<unknown> }
export function encodePreparedImport(input: PreparedImport): WirePreparedImport {
  const owned = ownPreparedImport(input); validateImportGraph(owned);
  return { ...owned, assets: owned.assets.map(encodeAsset) };
}

export function encodeAsset(input: CoreAsset): WireAsset {
  const { bytes, ...metadata } = ownAsset(input);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { ...metadata, bytesBase64: btoa(binary) };
}
export function encodeAssetPublication(input: AssetPublication): WireAssetPublication {
  const publication = ownAssetPublication(input);
  return { ...publication, asset: encodeAsset(publication.asset) };
}
export function decodeAsset(input: unknown): CoreAsset | null {
  if (input === null) return null;
  if (!isCoreJsonData(input) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
  const { bytesBase64, ...metadata } = input as Record<string, unknown>;
  if (typeof bytesBase64 !== 'string') throw new Error('CORE2_INVALID_NATIVE_RESPONSE');
  let decoded: string;
  try { decoded = atob(bytesBase64); } catch { throw new Error('CORE2_INVALID_NATIVE_RESPONSE'); }
  return ownAsset({ ...metadata, bytes: Uint8Array.from(decoded, char => char.charCodeAt(0)) } as unknown as CoreAsset);
}
