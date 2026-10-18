/** FNV-1a, UTF-8 bytes, unsigned 64-bit hex. Integrity marker, NOT an authentication hash.
 * Reference algorithm and vectors: https://www.rfc-editor.org/rfc/rfc9923.html
 */
export function checksumBytes(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
export function checksumUtf8(text: string): string { return checksumBytes(new TextEncoder().encode(text)); }
