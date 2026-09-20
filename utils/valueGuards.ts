/** Narrows an unknown value to a non-null, non-array object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Reads external input as normalized text without coercing numbers or objects. */
export function readTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
