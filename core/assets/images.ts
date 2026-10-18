import { checksumBytes } from '../sources/sourceIntegrity';

/** The image boundary owns a bounded, non-shared byte copy before any await. */
export function ownCoreImage(input: Uint8Array, mimeType: string): { bytes: Uint8Array; mimeType: string; checksum: string } {
  let bytes: Uint8Array;
  try {
    if (!(input instanceof Uint8Array) || Object.getPrototypeOf(input) !== Uint8Array.prototype) throw Error();
    const intrinsic = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const buffer = Object.getOwnPropertyDescriptor(intrinsic, 'buffer')!.get!.call(input) as unknown;
    const length = Object.getOwnPropertyDescriptor(intrinsic, 'length')!.get!.call(input) as number;
    if (!(buffer instanceof ArrayBuffer) || length < 12 || length > 20 * 1024 * 1024) throw Error();
    bytes = new Uint8Array(length); Uint8Array.prototype.set.call(bytes, input);
  } catch { throw Error('CORE2_IMAGE_BYTES_INVALID'); }
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[index + offset] === value);
  const valid = mimeType === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mimeType === 'image/jpeg' ? starts([255, 216, 255]) && bytes.at(-2) === 255 && bytes.at(-1) === 217
      : mimeType === 'image/webp' && starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8);
  if (!valid) throw Error('CORE2_IMAGE_FORMAT_INVALID');
  return { bytes, mimeType, checksum: checksumBytes(bytes) };
}
