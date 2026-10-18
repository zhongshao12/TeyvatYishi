import type { MemoryRecord } from '../contracts/memory';
/** Presentation only. Preserve the exact structured record for provenance and model delivery. */
export function displayCoreMemoryText(memory: MemoryRecord): string {
  if (memory.generation.mode !== 'local') return memory.text;
  return memory.text.split('\n').map(line => {
    if (!line.startsWith('- {')) return line;
    try {
      const item: unknown = JSON.parse(line.slice(2));
      if (!item || typeof item !== 'object' || !('kind' in item)) return line;
      if ((item.kind === 'recorded_utterance' || item.kind === 'recorded_narration') && 'text' in item && typeof item.text === 'string')
        return `${item.kind === 'recorded_utterance' ? '原话记录（不代表提议已履行）' : '本回合叙事记录'}：${item.text}`;
      if (item.kind === 'confirmed_event' && 'type' in item && typeof item.type === 'string') {
        const domain = item.type.split('.')[0] ?? '', names: Record<string, string> = { inventory: '物品变化', currency: '摩拉变化', traveler: '旅人状态变化', relationship: '关系变化', commitment: '约定变化', time: '世界时间变化', location: '地点变化', weather: '天气变化', quest: '任务变化', story: '剧情节点变化', npc: '人物状态变化' };
        return `已确认：${names[domain] ?? '游戏事件'}。详细变化保留在对应回合的结算与来源中。`;
      }
    } catch { /* A nonstandard/local user record stays visible verbatim. */ }
    return line;
  }).join('\n');
}
