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
  const sceneIds = new Set<string>();
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

    if (segment.场景节点 !== undefined && !Array.isArray(segment.场景节点)) {
      issues.push(`${label}: 场景节点必须是数组`);
    } else if (Array.isArray(segment.场景节点)) {
      segment.场景节点.forEach((scene, sceneIndex) => {
        const sceneLabel = `${label}/场景 ${sceneIndex + 1}`;
        if (!isRecord(scene)) {
          issues.push(`${sceneLabel}: 场景必须是对象`);
          return;
        }
        if (!hasText(scene.id)) issues.push(`${sceneLabel}: 缺少场景 ID`);
        else {
          if (sceneIds.has(scene.id)) issues.push(`${sceneLabel}: 重复场景 ID ${scene.id}`);
          sceneIds.add(scene.id);
          if (hasText(segment.id) && !scene.id.startsWith(`${segment.id}_scene_`)) {
            issues.push(`${sceneLabel}: 场景 ID 未引用所属分段 ${segment.id}`);
          }
        }
        for (const field of ['标题', '地点', '目标'] as const) {
          if (!hasText(scene[field])) issues.push(`${sceneLabel}: 缺少${field}`);
        }
        for (const field of ['参与角色', '完成证据', '可偏离切口'] as const) {
          if (!hasTextArray(scene[field])) issues.push(`${sceneLabel}: 缺少${field}`);
        }
        for (const field of ['开场事实', '完成后事实'] as const) {
          if (!Array.isArray(scene[field]) || !scene[field].some((fact) => isRecord(fact) && hasText(fact.内容))) {
            issues.push(`${sceneLabel}: 缺少${field}`);
          }
        }
      });
    }
  });
  return issues;
}
