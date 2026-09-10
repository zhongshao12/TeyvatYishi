export type 剧情编织冲突严重度 = 'info' | 'warning' | 'error';
export type 剧情编织冲突规则ID =
  | 'multiple_active_segments'
  | 'canon_event_replay'
  | 'fact_timeline_contradiction'
  | 'diverged_segment_no_rejoin';
export type 剧情编织冲突修复动作 = 'mark_skip' | 'mark_diverged' | 'rejoin' | 'dismiss';

export interface 剧情编织冲突 {
  id: string;
  规则ID: 剧情编织冲突规则ID;
  严重度: 剧情编织冲突严重度;
  系列ID: string;
  分段ID?: string;
  描述: string;
  建议: string;
  建议动作: 剧情编织冲突修复动作;
  自动可修复: boolean;
  createdAt: number;
  dismissedAt?: number;
}

export interface 剧情编织冲突报告 {
  conflicts: 剧情编织冲突[];
  generatedAt: number;
}

export function 创建冲突报告(conflicts: 剧情编织冲突[] = []): 剧情编织冲突报告 {
  return { conflicts, generatedAt: Date.now() };
}

export function 归一化剧情编织冲突(input: unknown): 剧情编织冲突 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<剧情编织冲突>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const RULES: 剧情编织冲突规则ID[] = ['multiple_active_segments', 'canon_event_replay', 'fact_timeline_contradiction', 'diverged_segment_no_rejoin'];
  const ACTIONS: 剧情编织冲突修复动作[] = ['mark_skip', 'mark_diverged', 'rejoin', 'dismiss'];
  if (!RULES.includes(String(raw.规则ID) as 剧情编织冲突规则ID)) return null;
  return {
    id: raw.id,
    规则ID: String(raw.规则ID) as 剧情编织冲突规则ID,
    严重度: raw.严重度 === 'warning' || raw.严重度 === 'error' ? raw.严重度 : 'info',
    系列ID: typeof raw.系列ID === 'string' ? raw.系列ID : '',
    分段ID: typeof raw.分段ID === 'string' ? raw.分段ID : undefined,
    描述: typeof raw.描述 === 'string' ? raw.描述 : '',
    建议: typeof raw.建议 === 'string' ? raw.建议 : '',
    建议动作: ACTIONS.includes(String(raw.建议动作) as 剧情编织冲突修复动作)
      ? String(raw.建议动作) as 剧情编织冲突修复动作
      : 'dismiss',
    自动可修复: raw.自动可修复 === true,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    dismissedAt: Number.isFinite(Number(raw.dismissedAt)) ? Number(raw.dismissedAt) : undefined,
  };
}
