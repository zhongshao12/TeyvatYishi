type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTextArray(value: unknown): boolean {
  return Array.isArray(value) && value.some(hasText);
}

export function validateBundledStorySeries(raw: unknown): string[] {
  if (!isRecord(raw)) return ['系列必须是对象'];
  const issues: string[] = [];
  const seriesId = hasText(raw.id) ? raw.id : '未命名系列';
  if (!hasText(raw.id)) issues.push(`${seriesId}: 缺少系列 ID`);
  if (!Array.isArray(raw.分段列表) || raw.分段列表.length === 0) {
    return [...issues, `${seriesId}: 分段列表为空`];
  }

  const segmentIds = new Set<string>();
  raw.分段列表.forEach((segment, segmentIndex) => {
    const label = `${seriesId}/分段 ${segmentIndex + 1}`;
    if (!isRecord(segment)) {
      issues.push(`${label}: 分段必须是对象`);
      return;
    }
    if (!hasText(segment.id)) issues.push(`${label}: 缺少分段 ID`);
    else if (segmentIds.has(segment.id)) issues.push(`${label}: 重复分段 ID ${segment.id}`);
    else segmentIds.add(segment.id);

    if (!Array.isArray(segment.关键事件)) issues.push(`${label}: 关键事件必须是数组`);
    else segment.关键事件.forEach((event, eventIndex) => {
      const eventLabel = `${label}/事件 ${eventIndex + 1}`;
      if (!isRecord(event) || !hasText(event.事件名)) issues.push(`${eventLabel}: 缺少事件名`);
      if (!isRecord(event) || !hasTextArray(event.事件结果)) issues.push(`${eventLabel}: 缺少事件结果`);
    });

    if (!Array.isArray(segment.角色推进)) issues.push(`${label}: 角色推进必须是数组`);
    else segment.角色推进.forEach((progress, roleIndex) => {
      const roleLabel = `${label}/角色推进 ${roleIndex + 1}`;
      if (!isRecord(progress) || !hasText(progress.角色名)) issues.push(`${roleLabel}: 缺少角色名`);
    });
  });
  return issues;
}
