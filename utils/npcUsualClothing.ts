/** `clothing` / `穿着` is the long-term usual outfit, never today's transient attire. */
export function shouldReplaceUsualClothing(
  current: string | undefined,
  next: string,
  evidence: string,
  manual = false,
): boolean {
  const candidate = next.trim();
  if (!candidate || candidate === current?.trim()) return false;
  if (manual || !current?.trim()) return true;
  const proof = evidence.trim();
  return /从此|今后|往后|以后都|长期|常穿|常用(?:穿着|服装|装束)|日常固定|正式改穿|不再换回/u.test(proof)
    && !/临时(?:改穿|换穿|穿上)|仅(?:今天|今晚|这次)|只(?:今天|今晚|这次)/u.test(proof);
}
