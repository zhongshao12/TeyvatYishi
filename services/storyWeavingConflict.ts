import type { 剧情编织系列, 剧情编织系统, 剧情编织分段 } from '@/models/storyWeaving';
import type { 剧情编织冲突 } from '@/models/storyWeavingConflict';
import { getTeyvatCanonAnchorIdForSeries, type CanonTrack } from '@/models/teyvat/canon';
import { getBlockedCanonAnchorIds } from '@/services/canonDeviationService';

const 当前状态 = (seg: 剧情编织分段): boolean => seg.运行状态 === '当前';
const 未开始状态 = (seg: 剧情编织分段): boolean => seg.运行状态 === '未开始';
const 已偏离状态 = (seg: 剧情编织分段): boolean => seg.运行状态 === '已偏离';

export function 检测多个当前分段(series: 剧情编织系列): 剧情编织冲突[] {
  const active = (series.分段列表 ?? []).filter(当前状态);
  if (active.length <= 1) return [];
  const earliest = active.reduce((a, b) => (a.组号 <= b.组号 ? a : b));
  return active
    .filter((seg) => seg.id !== earliest.id)
    .map((seg) => ({
      id: `conflict_multiple_active_${seg.id}`,
      规则ID: 'multiple_active_segments' as const,
      严重度: 'error' as const,
      系列ID: series.id,
      分段ID: seg.id,
      描述: `系列「${series.标题}」存在多个「当前」分段：${active.map((s) => s.标题).join('、')}。`,
      建议: '保留组号最小的分段为当前，其余标记为「已跳过」。',
      建议动作: 'mark_skip' as const,
      自动可修复: true,
      createdAt: Date.now(),
    }));
}

export function 检测原著事件重演(system: 剧情编织系统, 已发生事实: string[], canonTrack?: CanonTrack): 剧情编织冲突[] {
  const conflicts: 剧情编织冲突[] = [];
  const blockedAnchors = getBlockedCanonAnchorIds(canonTrack);
  for (const series of system.系列列表 ?? []) {
    if (series.来源类型 !== 'canon') continue;
    const seriesAnchorId = getTeyvatCanonAnchorIdForSeries(series.id);
    const blockedByPlayerFact = Boolean(seriesAnchorId && blockedAnchors.has(seriesAnchorId));
    for (const seg of series.分段列表 ?? []) {
      if (!未开始状态(seg)) continue;
      const facts = Array.isArray(已发生事实) ? 已发生事实 : [];
      const matched = facts.some((fact) => {
        const f = String(fact ?? '').trim();
        if (!f) return false;
        if (seg.标题 && f.includes(seg.标题)) return true;
        return (seg.关键事件 ?? []).some((event) => event.事件名 && f.includes(event.事件名));
      });
      if (matched || blockedByPlayerFact) {
        conflicts.push({
          id: `conflict_canon_replay_${seg.id}`,
          规则ID: 'canon_event_replay' as const,
          严重度: 'warning' as const,
          系列ID: series.id,
          分段ID: seg.id,
          描述: blockedByPlayerFact
            ? `玩家已建立事实明确阻断原著锚点「${seriesAnchorId}」，分段「${seg.标题}」不得因旧关键词命中而重演或推进。`
            : `玩家事实已包含「${seg.标题}」相关事件，但该原著分段仍为「未开始」，存在重演风险。`,
          建议: '按玩家已发生事实将该分段标记为「已经历」或「已跳过」，避免模型重演同一事件。',
          建议动作: 'mark_skip' as const,
          自动可修复: true,
          createdAt: Date.now(),
        });
      }
    }
  }
  return conflicts;
}

export function 检测事实与时间线矛盾(system: 剧情编织系统, 已发生事实: string[]): 剧情编织冲突[] {
  const conflicts: 剧情编织冲突[] = [];
  const facts = Array.isArray(已发生事实) ? 已发生事实.map((fact) => String(fact ?? '').trim()).filter(Boolean) : [];
  if (facts.length === 0) return conflicts;
  for (const series of system.系列列表 ?? []) {
    const segments = series.分段列表 ?? [];
    const eventOwner = new Map<string, 剧情编织分段>();
    for (const seg of segments) {
      for (const ev of seg.关键事件 ?? []) {
        if (ev.事件名 && !eventOwner.has(ev.事件名)) eventOwner.set(ev.事件名, seg);
      }
    }
    for (const fact of facts) {
      for (const [eventName, seg] of eventOwner) {
        if (!fact.includes(eventName)) continue;
        const earlierMissing = segments.find(
          (candidate) => candidate.组号 < seg.组号 && 未开始状态(candidate),
        );
        if (earlierMissing) {
          conflicts.push({
            id: `conflict_timeline_${seg.id}_${earlierMissing.id}`,
            规则ID: 'fact_timeline_contradiction' as const,
            严重度: 'warning' as const,
            系列ID: series.id,
            分段ID: earlierMissing.id,
            描述: `玩家事实已包含「${eventName}」（第 ${seg.组号} 段），但较早的第 ${earlierMissing.组号} 段「${earlierMissing.标题}」仍为未开始。`,
            建议: '将玩家实际已推进的中段按事实标记为「已经历」或「已跳过」，避免时间线倒挂。',
            建议动作: 'mark_skip' as const,
            自动可修复: true,
            createdAt: Date.now(),
          });
          break;
        }
      }
    }
  }
  return conflicts;
}

export function 检测偏离段缺失回归路径(system: 剧情编织系统): 剧情编织冲突[] {
  const conflicts: 剧情编织冲突[] = [];
  for (const series of system.系列列表 ?? []) {
    for (const seg of (series.分段列表 ?? []).filter(已偏离状态)) {
      const hasLaterRoute = (series.分段列表 ?? []).some(
        (candidate) => candidate.组号 > seg.组号 && (未开始状态(candidate) || 当前状态(candidate)),
      );
      if (hasLaterRoute) continue;
      conflicts.push({
        id: `conflict_no_rejoin_${seg.id}`,
        规则ID: 'diverged_segment_no_rejoin' as const,
        严重度: 'info' as const,
        系列ID: series.id,
        分段ID: seg.id,
        描述: `已偏离分段「${seg.标题}」之后没有可回归的后续分段。`,
        建议: '如 IF 线已成立，保持已偏离并手动建立后续分段；如需回归，把最近的未开始分段设为当前。',
        建议动作: 'dismiss' as const,
        自动可修复: false,
        createdAt: Date.now(),
      });
    }
  }
  return conflicts;
}

export function 生成冲突报告(system: 剧情编织系统, 已发生事实: string[], canonTrack?: CanonTrack): 剧情编织冲突[] {
  const canonConflicts = 检测原著事件重演(system, 已发生事实, canonTrack);
  return (system.系列列表 ?? []).flatMap((series, index) => [
    ...检测多个当前分段(series),
    ...(index === 0 ? canonConflicts : []),
    ...检测事实与时间线矛盾(system, 已发生事实),
    ...检测偏离段缺失回归路径(system),
  ]);
}

export function 应用冲突修复(system: 剧情编织系统, conflict: 剧情编织冲突): 剧情编织系统 {
  if (conflict.建议动作 === 'dismiss') return system;
  if (!conflict.分段ID) return system;
  return {
    ...system,
    系列列表: (system.系列列表 ?? []).map((series) => {
      if (series.id !== conflict.系列ID) return series;
      const 分段列表 = (series.分段列表 ?? []).map((seg) => {
        if (seg.id !== conflict.分段ID) return seg;
        if (conflict.建议动作 === 'mark_skip') return { ...seg, 运行状态: '已跳过' as const, updatedAt: Date.now() };
        if (conflict.建议动作 === 'mark_diverged') return { ...seg, 运行状态: '已偏离' as const, updatedAt: Date.now() };
        if (conflict.建议动作 === 'rejoin') return { ...seg, 运行状态: '当前' as const, updatedAt: Date.now() };
        return seg;
      });
      // rejoin 时把同系列其他「当前」段降级为已经历，保持单当前段不变量。
      const 应用后分段列表 = conflict.建议动作 === 'rejoin'
        ? 分段列表.map((seg) => seg.id !== conflict.分段ID && 当前状态(seg)
            ? { ...seg, 运行状态: '已经历' as const, updatedAt: Date.now() }
            : seg)
        : 分段列表;
      return { ...series, 分段列表: 应用后分段列表, updatedAt: Date.now() };
    }),
  };
}
