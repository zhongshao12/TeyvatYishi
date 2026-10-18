import type { CoreRepository, AssetPublication } from '../contracts/storage';
import { ownAssetPublication } from './binaryAssets';

/** The binary boundary owns bytes synchronously; only the selected repository publishes them. */
export async function publishCoreAsset(repo: CoreRepository,input: AssetPublication): Promise<void> {
  const publication=ownAssetPublication(input);
  await repo.publishAsset(publication);
}
