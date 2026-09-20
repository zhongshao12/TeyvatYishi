import { CLIP_SECTION, insetRing } from '@/styles/clipPaths';
import { memo, useMemo, useState } from 'react';
import type { NPC记录 } from '@/models/npc';
import type { 变量命令批次 } from '@/models/variableCommand';
import { 构建关系图, 提取好感变化事件 } from '@/utils/relationshipGraph';

interface RelationshipGraphPanelProps {
  npcRecords: NPC记录[];
  variableBatches?: 变量命令批次[];
  onSelectNpc: (npcId: string) => void;
  travelerName?: string;
}



export const RelationshipGraphPanel = memo(function RelationshipGraphPanel({ npcRecords, variableBatches, onSelectNpc, travelerName }: RelationshipGraphPanelProps) {
  const { nodes, edges } = useMemo(() => 构建关系图(npcRecords), [npcRecords]);
  const affinityEvents = useMemo(() => 提取好感变化事件(variableBatches ?? []), [variableBatches]);
  const recentEvents = affinityEvents.slice(-8).reverse();
  const radius = 120;
  const centerX = 150;
  const centerY = 130;
  const pageSize = 8;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(nodes.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleNodes = nodes.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const edgeByNode = new Map(edges.map((edge) => [edge.to, edge]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <div className="font-serif text-xs tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),0.9)' }}>主角关系</div>
          <div className="mt-1 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.78)' }}>每条连线标注当前关系与好感度；点击人物可打开档案。</div>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.82)' }}>
            <button type="button" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} className="px-2 py-1 disabled:opacity-35" style={{ boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.5)', clipPath: CLIP_SECTION }}>上一页</button>
            <span>{safePage + 1} / {pageCount}</span>
            <button type="button" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1} className="px-2 py-1 disabled:opacity-35" style={{ boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.5)', clipPath: CLIP_SECTION }}>下一页</button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center px-4 py-3" style={{ background: "rgba(var(--tj-accent-primary),0.04)", boxShadow: insetRing(0.15), clipPath: CLIP_SECTION }}>
        <svg width="300" height="280" viewBox="0 0 300 280" style={{ maxWidth: "100%" }}>
          {visibleNodes.map((node, index) => {
            const angle = (Math.PI * 2 * index) / Math.max(1, visibleNodes.length) - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            const color = node.enemy ? "rgba(var(--tj-danger),0.9)" : node.intimate ? "rgba(var(--tj-accent-secondary),0.95)" : node.affinity >= 50 ? "rgba(var(--tj-ui-success),0.9)" : "rgba(var(--tj-arcane-accent),0.85)";
            const edge = edgeByNode.get(node.id);
            const edgeColor = edge?.kind === 'rival' ? 'rgba(var(--tj-danger),0.62)' : edge?.kind === 'intimate' ? 'rgba(var(--tj-accent-secondary),0.7)' : 'rgba(var(--tj-border),0.52)';
            const labelX = centerX + (x - centerX) * 0.56;
            const labelY = centerY + (y - centerY) * 0.56;
            const relationText = `${node.relationLabel} · ${node.affinity >= 0 ? '+' : ''}${node.affinity}`;
            const labelWidth = Math.min(92, Math.max(48, relationText.length * 8));
            return (
              <g key={node.id} onClick={() => onSelectNpc(node.id)} style={{ cursor: "pointer" }}>
                <line x1={centerX} y1={centerY} x2={x} y2={y} stroke={edgeColor} strokeWidth={edge?.kind === 'intimate' ? 2.2 : 1.4} strokeDasharray={edge?.kind === 'rival' ? '4 3' : undefined} />
                <rect x={labelX - labelWidth / 2} y={labelY - 8} width={labelWidth} height="16" rx="7" fill="rgba(var(--tj-surface-strong),0.96)" stroke={edgeColor} strokeWidth="0.8" />
                <text x={labelX} y={labelY + 0.5} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="600" fill="rgb(var(--tj-text-primary))">{relationText}</text>
                <circle cx={x} cy={y} r="18" fill="rgba(var(--tj-surface-strong),0.95)" stroke={color} strokeWidth="1.5" />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="10" fill={color}>{node.name.slice(0, 2)}</text>
                <text x={x} y={y + 30} textAnchor="middle" fontSize="9" fill="rgba(var(--tj-text-secondary),0.85)">{node.name}</text>
              </g>
            );
          })}
          <circle cx={centerX} cy={centerY} r="26" fill="rgba(var(--tj-surface-strong),0.98)" stroke="rgba(var(--tj-accent-primary),0.9)" strokeWidth="2" />
          <text x={centerX} y={centerY - 3} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="rgb(var(--tj-ui-title))">主角</text>
          <text x={centerX} y={centerY + 12} textAnchor="middle" dominantBaseline="central" fontSize="8" fill="rgba(var(--tj-text-secondary),0.9)">{(travelerName?.trim() || '旅行者').slice(0, 6)}</text>
        </svg>
      </div>
      {nodes.length === 0 && <div className="px-4 py-3 text-center text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.68)' }}>尚未结识人物，关系图会在初次相遇后建立。</div>}
      <div className="px-4 py-3" style={{ boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.5)", clipPath: CLIP_SECTION }}>
        <div className="mb-2 font-serif text-xs tracking-[0.18em]" style={{ color: "rgba(var(--tj-accent-primary),0.85)" }}>最近好感变化</div>
        {recentEvents.length === 0 ? (
          <div className="text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.6)" }}>暂无好感变化记录。</div>
        ) : recentEvents.map((event, index) => (
          <div key={index} className="flex items-center justify-between text-[11px] py-1" style={{ color: "rgba(var(--tj-text-secondary),0.8)", boxShadow: "inset 0 -1px 0 rgba(var(--tj-border),0.25)" }}>
            <span>{event.npcName} · 第 {event.turn} 回合</span>
            <span style={{ color: event.delta >= 0 ? "rgba(var(--tj-ui-success),0.9)" : "rgba(var(--tj-danger),0.9)" }}>{event.delta >= 0 ? "+" : ""}{event.delta}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
