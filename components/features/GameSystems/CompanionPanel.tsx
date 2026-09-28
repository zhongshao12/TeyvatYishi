import { CLIP_ITEM, CLIP_SECTION, gradientAccent, insetRing } from '@/styles/clipPaths';
﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { memo } from 'react';
import type { NPC记录, NPC阶位, NPC_NSFW年龄确认, NPC_NSFW档案 } from '@/models/npc';
import { buildNpcMemoryLedgerView, 获取NPC兼容关系, 格式化NPC关系, 提取NPC同行记忆文本列表, 限制NPC好感度, 读取NPC头像 } from '@/models/npc';
import { matchCanonical } from '@/data/canonicalCharacters';
import type { 相册系统 } from '@/models/imageGeneration';
import type { ArchiveCodex } from '@/models/teyvat/codex';
import type { API设置 } from '@/models/settings';
import { buildNpcRelationshipPlanning, type NPC关系规划条目 } from '@/services/npcRelationshipPlanning';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { 解析相册资源引用 } from '@/utils/albumActions';
import type { CourierSystem } from '@/models/teyvat/courier';
import { addNpcToCourierContacts } from '@/services/ai/courierService';
import { displayFirstPartner } from '@/utils/npcFirstPartner';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveEnrichment';
import { archiveNpc, restoreNpc } from '@/services/npcArchiving';
import { canRevealNpcRecordMeasurements, NPC_APPEARANCE_KEYS, npcAppearanceSourceLabel } from '@/services/npcAppearanceFacts';
import type { NpcAppearanceKey } from '@/services/npcAppearanceFacts';
import { applyNpcAppearanceEstimate, generateNpcAppearanceEstimate, setNpcAppearanceFact } from '@/services/ai/npcAppearanceEstimate';
import { resolveActiveApiConfig } from '@/services/ai/activeApiConfig';
import {
  AffinityMeter,
  CompanionAvatar as Avatar,
  CompanionRosterSidebar,
  getAffinityTone,
} from './companion/CompanionRosterSidebar';

interface CompanionPanelProps {
  npcRecords: NPC记录[];
  onNpcRecordsChange: React.Dispatch<React.SetStateAction<NPC记录[]>>;
  onProfileSaved?: () => void;
  album?: 相册系统;
  turnCount: number;
  nsfwEnabled: boolean;
  maleNsfwArchiveEnabled?: boolean;
  codex?: ArchiveCodex;
  devMode?: boolean;
  focusNpcId?: string;
  focusNpcRequest?: number;
  courier?: CourierSystem;
  onCourierChange?: React.Dispatch<React.SetStateAction<CourierSystem>>;
  travelerName?: string;
  apiSettings?: API设置;
  enableClaudeMode?: boolean;
}

type DetailTab = 'archive' | 'planning' | 'memory' | 'nsfw';

type NpcProfileDraft = {
  姓名: string;
  别名: string;
  介绍: string;
  外貌: string;
  穿着: string;
  性格: string;
  说话方式: string;
  对玩家称呼: string;
  装备摘要: string;
  好感度: string;
};

function makeNpcProfileDraft(npc: NPC记录): NpcProfileDraft {
  return {
    姓名: npc.姓名, 别名: npc.别名 ?? '', 介绍: npc.介绍 ?? '', 外貌: npc.外貌 ?? '',
    穿着: npc.穿着 ?? '', 性格: npc.性格 ?? '', 说话方式: npc.说话方式 ?? '',
    对玩家称呼: npc.对玩家称呼 ?? '', 装备摘要: npc.装备摘要 ?? '', 好感度: String(npc.好感度),
  };
}




const panelStyle: CSSProperties = {
  background: 'radial-gradient(circle at 12% 0%, rgba(var(--tj-arcane-accent), 0.12), transparent 34%), linear-gradient(180deg, rgba(var(--tj-surface), 0.74), rgba(var(--tj-bg-primary), 0.92))',
  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.72), inset 3px 0 0 rgba(var(--tj-arcane-accent-deep, var(--tj-accent-primary)), 0.36)',
  clipPath: CLIP_SECTION,
};
const titleColor = 'rgb(var(--tj-ui-title))';
const bodyColor = 'rgba(var(--tj-ui-body), 0.95)';
const mutedColor = 'rgba(var(--tj-ui-muted), 0.82)';
const faintColor = 'rgba(var(--tj-ui-faint), 0.74)';
const accentColor = 'rgb(var(--tj-accent-primary))';
const activeTextColor = 'rgb(var(--tj-ui-active-text))';
const nsfwColor = 'rgb(var(--tj-ui-nsfw))';
const activeSurface = 'linear-gradient(90deg, rgba(var(--tj-btn-primary-start), 0.16), rgba(var(--tj-arcane-accent), 0.055))';
const quietSurface = 'linear-gradient(135deg, rgba(var(--tj-ui-panel), 0.62), rgba(var(--tj-ui-panel-strong), 0.72))';
const ROSTER_PAGE_SIZE = 60;

export function CompanionPanel({ npcRecords, onNpcRecordsChange, onProfileSaved, album, turnCount, nsfwEnabled, maleNsfwArchiveEnabled = false, codex, devMode = false, focusNpcId, focusNpcRequest = 0, courier, onCourierChange, travelerName, apiSettings, enableClaudeMode = false }: CompanionPanelProps) {
  const [tab, setTab] = useState<NPC阶位 | 'archived'>('companion');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState('');
  const [partyHint, setPartyHint] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleNpcCount, setVisibleNpcCount] = useState(ROSTER_PAGE_SIZE);
  const handledFocusRequest = useRef<string | null>(null);
  const enrichedRecords = useMemo(() => {
    // The canonical runtime already normalized this roster at the state
    // boundary. Re-running legacy identity merging here was quadratic and
    // made opening a 100+ character roster visibly stall.
    return enrichNpcArchives(npcRecords, {
      nsfwEnabled,
      maleNsfwArchiveEnabled,
      codex,
    });
  }, [npcRecords, nsfwEnabled, maleNsfwArchiveEnabled, codex]);
  const normalizedRecords = enrichedRecords.records;

  useEffect(() => {
    if (enrichedRecords.changed) onNpcRecordsChange(enrichedRecords.records);
  }, [enrichedRecords, onNpcRecordsChange]);

  const companions = useMemo(
    () => sortNpcRecords(normalizedRecords.filter((n) => !n.已归档 && n.阶位 === 'companion')),
    [normalizedRecords],
  );
  const extras = useMemo(
    () => sortNpcRecords(normalizedRecords.filter((n) => !n.已归档 && n.阶位 === 'extra' && n.关系 !== 'enemy')),
    [normalizedRecords],
  );
  const archived = useMemo(() => sortNpcRecords(normalizedRecords.filter((n) => n.已归档)), [normalizedRecords]);
  const filteredRoster = useMemo(
    () => filterNpcRoster(tab === 'companion' ? companions : tab === 'extra' ? extras : archived, searchQuery),
    [companions, extras, archived, searchQuery, tab],
  );
  const visible = useMemo(
    () => filteredRoster.slice(0, visibleNpcCount),
    [filteredRoster, visibleNpcCount],
  );
  const hiddenNpcCount = Math.max(0, filteredRoster.length - visible.length);

  useEffect(() => {
    const roster = tab === 'companion' ? companions : tab === 'extra' ? extras : archived;
    const focusedIndex = !searchQuery && focusNpcId ? roster.findIndex((npc) => npc.id === focusNpcId) : -1;
    setVisibleNpcCount(focusedIndex < 0
      ? ROSTER_PAGE_SIZE
      : Math.max(ROSTER_PAGE_SIZE, Math.ceil((focusedIndex + 1) / ROSTER_PAGE_SIZE) * ROSTER_PAGE_SIZE));
  }, [searchQuery, tab, focusNpcId, companions, extras, archived]);

  const travelingCount = companions.filter((n) => n.同行).length;
  const friendCount = companions.filter((n) => ['friend', 'close'].includes(n.关系)).length;

  useEffect(() => {
    if (selectedId && visible.some((n) => n.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [selectedId, visible]);

  useEffect(() => {
    if (!focusNpcId) return;
    const requestKey = `${focusNpcRequest}:${focusNpcId}`;
    if (handledFocusRequest.current === requestKey) return;
    const record = normalizedRecords.find((npc) => npc.id === focusNpcId);
    if (!record) return;
    handledFocusRequest.current = requestKey;
    const targetTab: NPC阶位 | 'archived' = record.已归档 ? 'archived' : record.阶位 === 'extra' ? 'extra' : 'companion';
    const roster = targetTab === 'archived' ? archived : targetTab === 'extra' ? extras : companions;
    const index = roster.findIndex((npc) => npc.id === focusNpcId);
    setSearchQuery('');
    setTab(targetTab);
    setVisibleNpcCount(Math.max(ROSTER_PAGE_SIZE, Math.ceil((index + 1) / ROSTER_PAGE_SIZE) * ROSTER_PAGE_SIZE));
    setSelectedId(focusNpcId);
  }, [focusNpcId, focusNpcRequest, normalizedRecords, companions, extras, archived]);

  const selected = visible.find((n) => n.id === selectedId) ?? null;
  const relationshipPlanning = useMemo(
    () => buildNpcRelationshipPlanning(normalizedRecords.filter((npc) => !npc.已归档), Math.max(1, turnCount)),
    [normalizedRecords, turnCount],
  );
  const selectedPlanning = selected ? relationshipPlanning.条目.find((item) => item.npcId === selected.id) : undefined;
  const activeApiConfig = useMemo(() => apiSettings ? resolveActiveApiConfig(apiSettings, enableClaudeMode) : null, [apiSettings, enableClaudeMode]);

  const updateRecord = useCallback((id: string, patch: Partial<NPC记录>) => {
    onNpcRecordsChange((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, [onNpcRecordsChange]);

  const promoteToCompanion = useCallback((id: string) => updateRecord(id, { 阶位: 'companion' }), [updateRecord]);
  const demoteToExtra = useCallback((id: string) => updateRecord(id, { 阶位: 'extra', 同行: false }), [updateRecord]);
  const handleInviteToggle = useCallback((npc: NPC记录) => {
    if (!npc.同行 && companions.filter((item) => item.同行).length >= 4) {
      setPartyHint('队伍已满（最多 4 名同伴）。请先请离一名同伴，再发出邀请。');
      return;
    }
    setPartyHint('');
    updateRecord(npc.id, { 同行: !npc.同行 });
  }, [companions, updateRecord]);
  const handleAddPhoneContact = useCallback((npc: NPC记录) => {
    if (!courier || !onCourierChange) return;
    onCourierChange(addNpcToCourierContacts(courier, npc));
  }, [courier, onCourierChange]);
  const handlePrivateArchiveCorrection = useCallback((npcId: string, archive: NPC_NSFW档案) => {
    const record = normalizedRecords.find((npc) => npc.id === npcId);
    updateRecord(npcId, { NSFW档案: record && canRevealNpcRecordMeasurements(record) ? archive : { ...archive, 常用内衣: undefined } });
    onProfileSaved?.();
  }, [normalizedRecords, updateRecord, onProfileSaved]);
  const handleSetAppearanceFact = useCallback((npc: NPC记录, key: NpcAppearanceKey, value: string): string | null => {
    try {
      setNpcAppearanceFact(npc, key, value);
      onNpcRecordsChange((previous) => previous.map((entry) => {
        if (entry.id !== npc.id) return entry;
        try { return setNpcAppearanceFact(entry, key, value); } catch { return entry; }
      }));
      onProfileSaved?.();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '外貌字段保存失败。';
    }
  }, [onNpcRecordsChange, onProfileSaved]);
  const handleGenerateAppearance = useCallback(async (npc: NPC记录, signal: AbortSignal) => {
    if (!activeApiConfig) throw new Error('请先配置可用的文字模型 API。');
    const estimate = await generateNpcAppearanceEstimate(activeApiConfig, npc, signal);
    if (signal.aborted) return;
    onNpcRecordsChange((previous) => previous.map((entry) => entry.id === npc.id && !entry.已归档
      ? applyNpcAppearanceEstimate(entry, estimate) : entry));
    onProfileSaved?.();
  }, [activeApiConfig, onNpcRecordsChange, onProfileSaved]);
  const handleSelectNpc = useCallback((id: string) => setSelectedId(id), []);
  const handleShowMoreNpcs = useCallback(() => {
    setVisibleNpcCount((count) => count + ROSTER_PAGE_SIZE);
  }, []);
  const handleArchiveNpc = useCallback((id: string) => {
    onNpcRecordsChange((previous) => previous.map((npc) => npc.id === id ? archiveNpc(npc) : npc));
    setTab('archived');
    setSelectedId(id);
    onProfileSaved?.();
  }, [onNpcRecordsChange, onProfileSaved]);
  const handleRestoreNpc = useCallback((record: NPC记录) => {
    onNpcRecordsChange((previous) => previous.map((npc) => npc.id === record.id ? restoreNpc(npc) : npc));
    setTab(record.归档前阶位 ?? 'extra');
    setSelectedId(record.id);
    onProfileSaved?.();
  }, [onNpcRecordsChange, onProfileSaved]);
  const handleSaveProfile = useCallback((npc: NPC记录, draft: NpcProfileDraft): string | null => {
    const name = npc.原著角色 ? npc.姓名 : draft.姓名.trim();
    const alias = draft.别名.trim();
    if (!name) return '姓名不能为空';
    if (normalizedRecords.some((other) => other.id !== npc.id && other.姓名.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return '姓名已被其他角色使用';
    }
    if (!npc.原著角色 && matchCanonical(name)) return '原著角色姓名已保留，请换一个路人姓名';
    const aliasCanon = alias ? matchCanonical(alias) : null;
    if (aliasCanon && aliasCanon.name !== matchCanonical(name)?.name) return '别名不能指向另一位原著角色';
    if (!draft.好感度.trim() || !Number.isFinite(Number(draft.好感度))) return '请输入有效的好感度数值';

    const affinity = 限制NPC好感度(draft.好感度);
    updateRecord(npc.id, {
      姓名: name, 别名: alias, 介绍: draft.介绍.trim(), 外貌: draft.外貌.trim(),
      穿着: draft.穿着.trim(), 性格: draft.性格.trim(), 说话方式: draft.说话方式.trim(),
      对玩家称呼: draft.对玩家称呼.trim(), 装备摘要: draft.装备摘要.trim(),
      好感度: affinity, 关系: 获取NPC兼容关系(affinity),
    });
    if (name !== npc.姓名 && courier?.contacts.some((contact) => contact.npcId === npc.id) && onCourierChange) {
      onCourierChange((current) => {
        const contacts = current.contacts.map((contact) => contact.npcId === npc.id ? { ...contact, name } : contact);
        return contacts.some((contact, index) => contact !== current.contacts[index]) ? { ...current, contacts } : current;
      });
    }
    onProfileSaved?.();
    return null;
  }, [normalizedRecords, updateRecord, courier, onCourierChange, onProfileSaved]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden md:flex-row md:gap-4 md:overflow-hidden">
      <CompanionRosterSidebar
        tab={tab}
        onTabChange={setTab}
        companions={companions}
        extras={extras}
        archived={archived}
        visible={visible}
        hiddenNpcCount={hiddenNpcCount}
        nextPageCount={Math.min(ROSTER_PAGE_SIZE, hiddenNpcCount)}
        onShowMore={handleShowMoreNpcs}
        selectedId={selectedId}
        onSelectNpc={handleSelectNpc}
        album={album}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        travelingCount={travelingCount}
        friendCount={friendCount}
        totalCount={normalizedRecords.length}
        relationshipOverview={relationshipPlanning.总览}
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-y-visible md:overflow-y-auto md:pr-1">
        {selected && !selected.已归档 && (
          <div className="mb-2 flex gap-2 px-1">
            <input
              value={correctionDraft}
              onChange={(event) => setCorrectionDraft(event.target.value)}
              placeholder="追加玩家纠正（防止 OOC）…"
              className="teyvat-input min-w-0 flex-1 px-3 py-2 text-xs"
              style={{ clipPath: CLIP_ITEM }}
            />
            <button type="button" onClick={() => {
              const text = correctionDraft.trim();
              if (!text) return;
              updateRecord(selected.id, { 玩家纠正记录: [...(selected.玩家纠正记录 ?? []), text].slice(-10) });
              setCorrectionDraft('');
            }} className="shrink-0 px-3 py-2 text-xs" style={{ color: 'rgb(var(--tj-text-primary))', background: 'rgba(var(--tj-accent-primary),0.12)', boxShadow: insetRing(0.4), clipPath: CLIP_ITEM }}>记录</button>
          </div>
        )}
        {selected?.已归档 ? (
          <section className="space-y-3 px-4 py-4" style={panelStyle} aria-label="已归档角色资料">
            <h2 className="font-serif text-lg" style={{ color: titleColor }}>{selected.姓名}</h2>
            <p className="text-xs" style={{ color: bodyColor }}>这位角色已从活跃同伴与主剧情自动提示中移出。人物记忆、好感度和手机联系人均保留。</p>
            <p className="text-xs" style={{ color: mutedColor }}>好感度 {selected.好感度} · 同行记忆 {selected.同行记忆?.length ?? 0} 条</p>
            <button type="button" onClick={() => handleRestoreNpc(selected)} className="teyvat-btn px-4 py-2 text-sm">恢复角色</button>
          </section>
        ) : selected ? (
          <>
          <div className="mb-2 flex justify-end px-1">
            <button type="button" onClick={() => handleArchiveNpc(selected.id)} className="teyvat-btn px-3 py-2 text-xs">归档角色</button>
          </div>
          {partyHint && (
            <p className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--tj-danger)' }}>{partyHint}</p>
          )}
          <NpcDetail
            key={selected.id}
            npc={selected}
            album={album}
            nsfwEnabled={nsfwEnabled}
            onPromote={promoteToCompanion}
            onDemote={demoteToExtra}
            onInviteToggle={handleInviteToggle}
            planning={selectedPlanning}
            devMode={devMode}
            isPhoneContact={Boolean(courier?.contacts.some((contact) => contact.npcId === selected.id || contact.name === selected.姓名))}
            onAddPhoneContact={courier && onCourierChange ? handleAddPhoneContact : undefined}
            onSaveProfile={handleSaveProfile}
            travelerName={travelerName ?? ''}
            onPrivateArchiveCorrection={handlePrivateArchiveCorrection}
            onSetAppearanceFact={handleSetAppearanceFact}
            onGenerateAppearance={activeApiConfig ? handleGenerateAppearance : undefined}
          />
          </>
        ) : (
          <NoSelection tab={tab} />
        )}
      </main>
    </div>
  );
}

export function filterNpcRoster(records: NPC记录[], query: string): NPC记录[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return records;
  return records.filter((npc) => [
    npc.姓名, npc.别名, npc.介绍, npc.性格, npc.说话方式, npc.外貌, npc.穿着,
    ...(npc.备注 ?? []), ...(npc.玩家纠正记录 ?? []),
  ].some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle)));
}

function sortNpcRecords(records: NPC记录[]) {
  return [...records].sort((a, b) => {
    const weight = (n: NPC记录) => (n.同行 ? 0 : n.原著角色 ? 1 : 2);
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    return (b.好感度 ?? 0) - (a.好感度 ?? 0);
  });
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 flex-1 whitespace-nowrap px-2.5 py-2 font-serif text-[12px] tracking-[0.18em] transition-all"
      style={{
        color: active ? titleColor : faintColor,
        background: active ? activeSurface : 'rgba(var(--tj-btn-primary-start), 0.035)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.56), 0 8px 18px rgba(var(--tj-shadow), 0.08)'
          : 'inset 0 0 0 1px rgba(var(--tj-border), 0.46)',
        clipPath: CLIP_ITEM,
      }}
    >
      {children}
    </button>
  );
}

const NpcDetail = memo(function NpcDetail({
  npc,
  album,
  onPromote,
  onDemote,
  onInviteToggle,
  nsfwEnabled,
  planning,
  devMode,
  isPhoneContact,
  onAddPhoneContact,
  onSaveProfile,
  travelerName,
  onPrivateArchiveCorrection,
  onSetAppearanceFact,
  onGenerateAppearance,
}: {
  npc: NPC记录;
  album?: 相册系统;
  onPromote: (npcId: string) => void;
  onDemote: (npcId: string) => void;
  onInviteToggle: (npc: NPC记录) => void;
  nsfwEnabled: boolean;
  planning?: NPC关系规划条目;
  devMode: boolean;
  isPhoneContact: boolean;
  onAddPhoneContact?: (npc: NPC记录) => void;
  onSaveProfile: (npc: NPC记录, draft: NpcProfileDraft) => string | null;
  travelerName: string;
  onPrivateArchiveCorrection: (npcId: string, archive: NPC_NSFW档案) => void;
  onSetAppearanceFact: (npc: NPC记录, key: NpcAppearanceKey, value: string) => string | null;
  onGenerateAppearance?: (npc: NPC记录, signal: AbortSignal) => Promise<void>;
}) {
  const isCompanion = npc.阶位 === 'companion';
  const [detailTab, setDetailTab] = useState<DetailTab>('archive');
  const [isEditing, setIsEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<NpcProfileDraft>(() => makeNpcProfileDraft(npc));
  const [profileError, setProfileError] = useState('');
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false);
  const [appearanceDraft, setAppearanceDraft] = useState<Partial<Record<NpcAppearanceKey, string>>>(() => Object.fromEntries(
    NPC_APPEARANCE_KEYS.map((key) => [key, npc.外貌档案?.[key]?.value ?? '']),
  ));
  const [appearanceMessage, setAppearanceMessage] = useState('');
  const [appearanceGenerating, setAppearanceGenerating] = useState(false);
  const appearanceAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setAppearanceDraft(Object.fromEntries(NPC_APPEARANCE_KEYS.map((key) => [key, npc.外貌档案?.[key]?.value ?? ''])));
  }, [npc.外貌档案]);
  useEffect(() => () => appearanceAbortRef.current?.abort(), []);
  const generateAppearance = async () => {
    if (!onGenerateAppearance || appearanceGenerating) return;
    const controller = new AbortController();
    appearanceAbortRef.current = controller;
    setAppearanceGenerating(true);
    setAppearanceMessage('正在补全空白外貌资料……');
    try {
      await onGenerateAppearance(npc, controller.signal);
      if (!controller.signal.aborted) setAppearanceMessage('补全完成；推测值已标注来源，可手动校正。');
    } catch (error) {
      if (!controller.signal.aborted) setAppearanceMessage(`补全失败：${error instanceof Error ? error.message : '请检查 API 配置。'}`);
    } finally {
      if (!controller.signal.aborted) setAppearanceGenerating(false);
      if (appearanceAbortRef.current === controller) appearanceAbortRef.current = null;
    }
  };
  const updateProfileDraft = (field: keyof NpcProfileDraft, value: string) => {
    setProfileDraft((draft) => ({ ...draft, [field]: value }));
    setProfileError('');
  };
  const saveProfile = () => {
    const error = onSaveProfile(npc, profileDraft);
    if (error) {
      setProfileError(error);
      return;
    }
    setProfileError('');
    setIsEditing(false);
  };

  useEffect(() => {
    if (!nsfwEnabled && detailTab === 'nsfw') setDetailTab('archive');
    if (!planning && detailTab === 'planning') setDetailTab('archive');
  }, [detailTab, nsfwEnabled, planning]);

  return (
    <div className="flex min-h-full flex-col gap-4">
      <section className="px-5 py-4" style={panelStyle}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="relative shrink-0">
            <Avatar npc={npc} album={album} size={88} selected />
            {npc.同行 && (
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 font-serif text-[11px] tracking-[0.18em]"
                style={{
                  color: 'rgba(var(--tj-ui-success),0.96)',
                  background: 'rgba(var(--tj-panel-bg-start),0.92)',
                  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-ui-success),0.48)',
                  clipPath: CLIP_ITEM,
                }}
              >
                队伍中
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="truncate font-serif text-[24px] font-semibold tracking-[0.18em]"
                style={{
                  background: 'linear-gradient(135deg, rgb(var(--tj-ui-title)) 0%, rgb(var(--tj-accent-primary)) 58%, rgb(var(--tj-accent-secondary)) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {npc.姓名}
              </h3>
              {npc.别名 && <span className="font-serif text-[13px] italic text-[rgb(var(--tj-text-secondary))]">({npc.别名})</span>}
              {npc.原著角色 && <Chip tone="gold">原著角色</Chip>}
              {npc.图像档案?.状态 && <Chip tone="silver">{npc.图像档案.状态 === 'pending' ? '图像生成中' : '图像档案'}</Chip>}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
              <InfoPill label="性别" value={npc.性别 || '未知'} />
              <InfoPill label="关系" value={格式化NPC关系(npc.好感度, Boolean(npc.亲密关系))} />
              <InfoPill label="最近" value={`第 ${npc.最近回合} 回合`} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <ActionChip active={isEditing} onClick={() => {
                setProfileDraft(makeNpcProfileDraft(npc));
                setProfileError('');
                setIsEditing(true);
              }}>
                编辑资料
              </ActionChip>
              <ActionChip active={isPhoneContact} onClick={() => onAddPhoneContact?.(npc)}>
                {isPhoneContact ? '已在手机联系人' : '添加到手机联系人'}
              </ActionChip>
              {isCompanion ? (
                <ActionChip active={npc.同行} onClick={() => onInviteToggle(npc)}>
                  {npc.同行 ? '请离队伍' : '邀请入队'}
                </ActionChip>
              ) : (
                <ActionChip active={false} onClick={() => {
                  onPromote(npc.id);
                  onInviteToggle(npc);
                }}>
                  邀请入队
                </ActionChip>
              )}
              {isCompanion ? (
                npc.原著角色 ? (
                  <Chip tone="gold">常驻伙伴</Chip>
                ) : (
                  <ActionChip active onClick={() => onDemote(npc.id)}>
                    移出伙伴
                  </ActionChip>
                )
              ) : (
                <ActionChip active={false} onClick={() => onPromote(npc.id)}>
                  标为伙伴
                </ActionChip>
              )}
              <span
                className="font-serif text-[12px] tracking-[0.12em] px-2 py-1"
                style={{ color: faintColor }}
              >
                初见第 {npc.初见回合} 回合
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 xl:w-[360px] xl:items-stretch">
            <div className="flex justify-end">
              <AffinityBadge value={npc.好感度} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-4">
              <TabButton active={detailTab === 'archive'} onClick={() => setDetailTab('archive')}>
                伙伴档案
              </TabButton>
              {planning && (
                <TabButton active={detailTab === 'planning'} onClick={() => setDetailTab('planning')}>
                  关系规划
                </TabButton>
              )}
              <TabButton active={detailTab === 'memory'} onClick={() => setDetailTab('memory')}>
                {devMode ? '记忆账本' : '同行记忆'}
              </TabButton>
              {nsfwEnabled && (
                <TabButton active={detailTab === 'nsfw'} onClick={() => setDetailTab('nsfw')}>
                  NSFW档案
                </TabButton>
              )}
            </div>
          </div>
        </div>
      </section>

      {isEditing && (
        <section className="px-4 py-3" style={panelStyle} aria-label="编辑同伴资料">
          <div className="mb-3 font-serif text-sm tracking-[0.18em]" style={{ color: titleColor }}>编辑伙伴档案</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['姓名', '别名', '对玩家称呼', '好感度'] as const).map((field) => (
              <label key={field} className="flex min-w-0 flex-col gap-1 text-xs" style={{ color: bodyColor }}>
                {field}
                <input
                  aria-label={field}
                  type={field === '好感度' ? 'number' : 'text'}
                  min={field === '好感度' ? -50 : undefined}
                  max={field === '好感度' ? 150 : undefined}
                  disabled={field === '姓名' && npc.原著角色}
                  className="teyvat-input min-w-0 px-3 py-2 disabled:opacity-60"
                  value={profileDraft[field]}
                  onChange={(event) => updateProfileDraft(field, event.target.value)}
                />
              </label>
            ))}
            {(['介绍', '外貌', '穿着', '性格', '说话方式', '装备摘要'] as const).map((field) => (
              <label key={field} className="flex min-w-0 flex-col gap-1 text-xs" style={{ color: bodyColor }}>
                {field === '穿着' ? '常用穿着' : field}
                <textarea
                  aria-label={field}
                  rows={field === '介绍' ? 3 : 2}
                  className="teyvat-input min-w-0 resize-y px-3 py-2"
                  value={profileDraft[field]}
                  onChange={(event) => updateProfileDraft(field, event.target.value)}
                />
              </label>
            ))}
          </div>
          {npc.原著角色 && <p className="mt-2 text-xs" style={{ color: mutedColor }}>原著角色姓名锁定，避免档案与剧情身份错配。</p>}
          {profileError && <p className="mt-2 text-xs" role="alert" style={{ color: 'rgb(var(--tj-ui-nsfw))' }}>{profileError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <ActionChip active={false} onClick={() => setIsEditing(false)}>取消编辑</ActionChip>
            <ActionChip active onClick={saveProfile}>保存资料</ActionChip>
          </div>
        </section>
      )}

      {planning && detailTab === 'planning' && (
        <section className="px-4 py-3 text-xs leading-relaxed" style={panelStyle}>
          <div className="font-serif text-[12px] tracking-[0.22em]" style={{ color: accentColor }}>
            关系规划
          </div>
          <div className="mt-2 flex flex-wrap gap-2" style={{ color: bodyColor }}>
            <span>优先级：{planning.优先级}</span>
            <span>建议：{planning.建议动作}</span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <MiniList title="理由" items={planning.理由} />
            <MiniList title="关注点" items={planning.关注点} />
          </div>
        </section>
      )}

      {detailTab === 'archive' && (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="人物介绍">
              <Paragraph text={npc.介绍 || npc.性格} placeholder="尚无人物介绍" />
            </DetailBlock>
            <DetailBlock title="对你的称呼">
              <Paragraph text={npc.对玩家称呼} placeholder="尚未形成固定称呼" italic />
            </DetailBlock>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="外貌">
              <Paragraph text={npc.外貌} placeholder="尚无外貌记录" />
            </DetailBlock>
            <DetailBlock title="常用穿着">
              <Paragraph text={npc.穿着} placeholder="尚无常用穿着记录" />
            </DetailBlock>
          </section>

          <DetailBlock title="外貌细项">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!onGenerateAppearance || appearanceGenerating} onClick={() => void generateAppearance()} className="teyvat-btn px-3 py-1.5 text-xs disabled:opacity-50">
                {appearanceGenerating ? '正在补全……' : 'AI 补全空白外貌'}
              </button>
              <button type="button" onClick={() => setAppearanceEditorOpen((open) => !open)} className="teyvat-btn px-3 py-1.5 text-xs">{appearanceEditorOpen ? '收起外貌编辑' : '编辑外貌细项'}</button>
              {!onGenerateAppearance && <span className="text-xs" style={{ color: mutedColor }}>请先配置文字模型 API</span>}
            </div>
            {appearanceMessage && <p role="status" className="mb-2 text-xs" style={{ color: appearanceMessage.startsWith('补全失败') ? 'var(--tj-danger)' : mutedColor }}>{appearanceMessage}</p>}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {NPC_APPEARANCE_KEYS.filter((key) => key !== '三围' || canRevealNpcRecordMeasurements(npc)).map((key) => {
                const fact = npc.外貌档案?.[key];
                return (
                  <div key={key} className="px-3 py-2 text-xs" style={{ background: quietSurface, color: bodyColor }}>
                    <span className="font-semibold">{key}</span>
                    <span className="ml-2">{fact?.value || '未记录'}</span>
                    {fact && <span className="ml-2" style={{ color: mutedColor }}>· {npcAppearanceSourceLabel(fact.source)}</span>}
                    {appearanceEditorOpen && <div className="mt-2 flex gap-1">
                      <input aria-label={`手动修改${key}`} className="teyvat-input min-w-0 flex-1 px-2 py-1" value={appearanceDraft[key] ?? ''} onChange={(event) => setAppearanceDraft((current) => ({ ...current, [key]: event.target.value }))} />
                      <button type="button" className="teyvat-btn shrink-0 px-2 py-1" onClick={() => {
                        const error = onSetAppearanceFact(npc, key, appearanceDraft[key] ?? '');
                        setAppearanceMessage(error ? `保存失败：${error}` : `${key}已手动保存。`);
                      }}>{`保存${key}`}</button>
                    </div>}
                  </div>
                );
              })}
            </div>
          </DetailBlock>

          <section className="grid gap-4 xl:grid-cols-2">
            <DetailBlock title="说话方式">
              <Paragraph text={npc.说话方式} placeholder="尚无说话方式记录" />
            </DetailBlock>
            <DetailBlock title="性格">
              <Paragraph text={npc.性格} placeholder="尚无性格记录" />
            </DetailBlock>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <DetailBlock title="装备面板">
              <Paragraph text={npc.装备摘要} placeholder="尚未记录其装备与随身物" italic />
            </DetailBlock>
            <VisualArchivePanel npc={npc} album={album} />
          </section>
        </>
      )}

      {detailTab === 'memory' && <MemoryPanel npc={npc} devMode={devMode} />}

      {nsfwEnabled && detailTab === 'nsfw' && <NSFWArchivePanel npc={npc} travelerName={travelerName} onCorrection={onPrivateArchiveCorrection} />}
    </div>
  );
});

function VisualArchivePanel({ npc, album }: { npc: NPC记录; album?: 相册系统 }) {
  return (
    <DetailBlock title="视觉档案预留">
      <div className="grid gap-3 sm:grid-cols-3">
        <AvatarSlotCard npc={npc} album={album} slot="档案" label="档案头像" description="伙伴面板" />
        <AvatarSlotCard npc={npc} album={album} slot="正文" label="正文头像" description="剧情气泡" />
        <AvatarSlotCard npc={npc} album={album} slot="手机" label="手机头像" description="聊天名片" />
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <InfoPill label="图像状态" value={npc.图像档案?.状态 ?? 'none'} />
        <InfoPill label="图像来源" value={npc.图像档案?.来源 ?? (读取NPC头像(npc) ? '手动 / 原著' : '未设定')} />
      </div>
      <div className="mt-3 space-y-1">
        <Paragraph text={npc.图像档案?.头像提示词} placeholder="未记录头像提示词" italic />
        <Paragraph text={npc.图像档案?.立绘提示词} placeholder="未记录立绘提示词" italic />
      </div>
    </DetailBlock>
  );
}

function AvatarSlotCard({
  npc,
  album,
  slot,
  label,
  description,
}: {
  npc: NPC记录;
  album?: 相册系统;
  slot: '档案' | '正文' | '手机';
  label: string;
  description: string;
}) {
  const src = 解析相册资源引用(album, 读取NPC头像(npc, slot));
  return (
    <div
      className="flex min-w-0 items-center gap-3 px-3 py-3"
      style={{
        background: src ? 'rgba(var(--tj-btn-primary-start), 0.075)' : quietSurface,
        boxShadow: src
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.32)'
          : 'inset 0 0 0 1px rgba(var(--tj-border), 0.48)',
        clipPath: CLIP_ITEM,
      }}
    >
      <Avatar npc={npc} album={album} size={42} slot={slot} selected={Boolean(src)} />
      <div className="min-w-0">
        <div className="truncate font-serif text-[12px] font-semibold tracking-[0.16em]" style={{ color: titleColor }}>
          {label}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] tracking-[0.12em]" style={{ color: faintColor }}>
          {src ? description : `${description} · 待生成`}
        </div>
      </div>
    </div>
  );
}

function NSFWArchivePanel({ npc, travelerName, onCorrection }: {
  npc: NPC记录;
  travelerName: string;
  onCorrection: (npcId: string, archive: NPC_NSFW档案) => void;
}) {
  const archive = npc.NSFW档案;
  const [editingPartner, setEditingPartner] = useState(false);
  const [partnerType, setPartnerType] = useState<'player' | 'other' | 'unknown'>('player');
  const [otherPartner, setOtherPartner] = useState('');
  const [partnerError, setPartnerError] = useState('');
  const [underwearDraft, setUnderwearDraft] = useState(archive?.常用内衣 ?? '');
  const [underwearMessage, setUnderwearMessage] = useState('');
  useEffect(() => setUnderwearDraft(archive?.常用内衣 ?? ''), [archive?.常用内衣]);
  const adultEligibility = resolveNpcAdultEligibility({
    name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [],
    description: [npc.介绍, npc.外貌, npc.备注.join(' ')].filter(Boolean).join(' '),
    ageConfirmation: archive?.年龄确认, ageSource: archive?.年龄确认来源,
    canonicalBaselineAge: getCanonicalArchiveBaselineAge(npc.姓名),
  });
  if (!adultEligibility.confirmed) {
    return <DetailBlock title="NSFW档案"><p className="px-4 py-4 text-sm" style={{ color: bodyColor }}>成年资格待确认；旧档内容已保留，但不会显示或用于私密结算。</p></DetailBlock>;
  }
  const savePartnerCorrection = () => {
    if (!archive) return;
    const name = otherPartner.trim();
    if (partnerType === 'other' && !name) {
      setPartnerError('请填写其他对象姓名');
      return;
    }
    onCorrection(npc.id, {
      ...archive,
      首次性行为对象: partnerType === 'other' ? name : undefined,
      首次性行为对象引用: partnerType === 'player' ? 'player' : undefined,
      首次性行为对象来源: 'manual',
      首次性行为对象回合: undefined,
      经历: archive.经历?.filter((entry) => entry !== '旧档推定，具体回合未知'),
    });
    setPartnerError('');
    setEditingPartner(false);
  };
  const tags = archive?.标签 ?? [];
  const femaleBodyArchive = archive?.女性身体档案;
  const maleBodyArchive = archive?.男性身体档案;
  const bodyPane = npc.性别 === '男' ? 'male' : 'female';
  return (
    <DetailBlock title="NSFW档案">
      <div
        className="px-4 py-4"
        style={{
          background: 'linear-gradient(135deg, rgba(var(--tj-ui-nsfw), 0.13), rgba(var(--tj-ui-panel), 0.72))',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw),0.22)',
          clipPath: CLIP_ITEM,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-serif text-[13px] font-semibold tracking-[0.22em]" style={{ color: titleColor }}>
              独立档案接口
            </div>
            <div className="mt-1 text-[11px] tracking-[0.12em]" style={{ color: faintColor }}>
              后续 NSFW 模式读取，普通剧情默认不调用
            </div>
          </div>
          <Chip tone={archive?.enabled ? 'gold' : 'silver'}>
            {archive?.enabled ? '已启用' : '预留'}
          </Chip>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <InfoPill label="年龄确认" value={formatNsfwAge(archive?.年龄确认)} />
          <InfoPill label="亲密阶段" value={archive?.亲密阶段 ?? '未记录'} />
          <InfoPill label="边界" value={archive?.边界 ?? '未记录'} />
        </div>

        {npc.性别 === '女' && archive && (
          <div className="mt-3 grid gap-2 md:grid-cols-2" data-testid="adult-female-sexual-history">
            <InfoPill label="是否处女" value={archive.是否处女 ?? '未知'} />
            <InfoPill label="首次性行为对象" value={displayFirstPartner(archive, travelerName)} />
          </div>
        )}

        {npc.性别 === '女' && (
          <div className="mt-3 space-y-2 text-xs" style={{ color: bodyColor }}>
            <ArchiveField title="常用内衣" text={archive?.常用内衣} />
            <div className="flex flex-wrap gap-2">
              <input aria-label="编辑常用内衣" value={underwearDraft} onChange={(event) => setUnderwearDraft(event.target.value)} className="teyvat-input min-w-0 flex-1 px-2 py-1.5" placeholder="仅手动记录已确认的常用内衣" />
              <button type="button" className="teyvat-btn px-3 py-1.5" onClick={() => {
                const value = underwearDraft.trim();
                if (value.length > 120 || /[<>\r\n\u0000-\u001f]/u.test(value)) { setUnderwearMessage('保存失败：内容过长或包含无效字符。'); return; }
                onCorrection(npc.id, { ...archive, 常用内衣: value || undefined });
                setUnderwearMessage('常用内衣已保存。');
              }}>保存常用内衣</button>
            </div>
            {underwearMessage && <p role="status">{underwearMessage}</p>}
          </div>
        )}

        {npc.性别 === '女' && archive?.首次性行为对象来源 === 'legacy_assumed' && (
          <div className="mt-3 space-y-2 text-xs" style={{ color: bodyColor }}>
            <p>旧档推定 · 具体回合未知，可手动校正。</p>
            {!editingPartner ? (
              <button type="button" onClick={() => setEditingPartner(true)} className="teyvat-input px-3 py-1.5">编辑首次对象</button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="首次对象类型" className="teyvat-input px-2 py-1.5" value={partnerType}
                  onChange={(event) => { setPartnerType(event.target.value as typeof partnerType); setPartnerError(''); }}>
                  <option value="player">当前玩家</option>
                  <option value="other">其他对象</option>
                  <option value="unknown">待确认</option>
                </select>
                {partnerType === 'other' && <input aria-label="其他对象姓名" className="teyvat-input px-2 py-1.5" value={otherPartner} onChange={(event) => setOtherPartner(event.target.value)} />}
                <button type="button" onClick={savePartnerCorrection} className="teyvat-input px-3 py-1.5">保存首次对象</button>
                <button type="button" onClick={() => setEditingPartner(false)} className="teyvat-input px-3 py-1.5">取消</button>
                {partnerError && <span role="alert">{partnerError}</span>}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <TagGroup title="偏好" items={archive?.偏好 ?? []} empty="暂无偏好记录" />
          <TagGroup title="敏感点" items={archive?.敏感点 ?? []} empty="暂无敏感点记录" />
          <TagGroup title="禁忌" items={archive?.禁忌 ?? []} empty="暂无禁忌记录" />
        </div>

        <div className="mt-4">
          {bodyPane === 'female' ? (
            <BodyArchiveSection title="女性身体档案">
              <ArchiveField title="胸部" text={femaleBodyArchive?.胸部} />
              <ArchiveField title="女性私处" text={femaleBodyArchive?.女性私处} />
              <ArchiveField title="后庭" text={femaleBodyArchive?.后庭} />
              <ArchiveField title="体态" text={femaleBodyArchive?.体态} />
              <ArchiveField title="体味" text={femaleBodyArchive?.体味} />
            </BodyArchiveSection>
          ) : (
            <BodyArchiveSection title="男性身体档案">
              <ArchiveField title="男性器" text={maleBodyArchive?.男性器} />
              <ArchiveField title="后庭" text={maleBodyArchive?.后庭} />
              <ArchiveField title="体态" text={maleBodyArchive?.体态} />
              <ArchiveField title="体味" text={maleBodyArchive?.体味} />
            </BodyArchiveSection>
          )}
        </div>

        {archive?.部位图片 && (
          <div className="mt-4">
            <BodyArchiveSection title="NSFW 部位图片">
              <PartImageSlot title="女性胸部" src={archive.部位图片.女性胸部} />
              <PartImageSlot title="女性私处" src={archive.部位图片.女性私处} />
              {/* 女角色的档案不展示男性器（玩家要求）。已有的历史数据不删除，只是不再显示。 */}
              {npc.性别 !== '女' && <PartImageSlot title="男性器" src={archive.部位图片.男性器} />}
              <PartImageSlot title="后庭" src={archive.部位图片.后庭} />
              <PartImageSlot title="体态参考" src={archive.部位图片.体态参考} />
            </BodyArchiveSection>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ListBlock title="经历" items={archive?.经历 ?? []} empty="暂无亲密经历记录" />
          <ListBlock title="长期事实" items={archive?.长期事实 ?? []} empty="暂无长期事实记录" />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length ? (
            tags.map((tag) => <Chip key={tag} tone="silver">{tag}</Chip>)
          ) : (
            <span className="font-serif text-[12px] italic tracking-[0.12em]" style={{ color: faintColor }}>
              暂无标签，等待后续模式写入
            </span>
          )}
        </div>

        <div className="mt-3">
          <Paragraph text={archive?.备注} placeholder="暂无 NSFW 备注" italic />
        </div>
      </div>
    </DetailBlock>
  );
}

function PartImageSlot({ title, src }: { title: string; src?: string }) {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: src ? 'rgba(var(--tj-ui-nsfw), 0.075)' : 'rgba(var(--tj-ui-nsfw), 0.035)',
        boxShadow: src ? 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw), 0.28)' : 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw), 0.12)',
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="aspect-[4/3]" style={{ background: 'rgba(var(--tj-ui-panel-strong), 0.58)' }}>
        {src ? <img src={src} alt={title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.56)' }}>待挂载</div>}
      </div>
      <div className="px-2 py-1.5 text-[11px]" style={{ color: nsfwColor }}>{title}</div>
    </div>
  );
}

function BodyArchiveSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-serif text-[12px] tracking-[0.24em]" style={{ color: accentColor }}>
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function formatNsfwAge(age: NPC_NSFW年龄确认 | undefined): string {
  // 年龄确认已降级为纯展示信息，不再控制写入或显示。
  if (age === 'adult') return '成人';
  if (age === 'minor_blocked') return '标注未成年';
  if (age === 'unknown') return '未标注';
  return '未标注';
}

function TagGroup({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.68)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw),0.18)', clipPath: CLIP_ITEM }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => <Chip key={item} tone="silver">{item}</Chip>)}
        </div>
      ) : (
        <EmptyText text={empty} />
      )}
    </div>
  );
}

function ArchiveField({ title, text }: { title: string; text?: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.66)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw),0.16)', clipPath: CLIP_ITEM }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      <Paragraph text={text} placeholder="未记录" />
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="min-w-0 px-3 py-3" style={{ background: 'rgba(var(--tj-ui-panel),0.66)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-ui-nsfw),0.16)', clipPath: CLIP_ITEM }}>
      <div className="mb-2 font-serif text-[11px] tracking-[0.24em]" style={{ color: 'rgba(var(--tj-ui-nsfw),0.82)' }}>
        {title}
      </div>
      {items.length ? (
        <ul className="max-h-[180px] space-y-1.5 overflow-y-auto pr-1">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} className="font-serif text-[13px] leading-relaxed tracking-[0.06em]" style={{ color: bodyColor }}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyText text={empty} />
      )}
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="min-w-0 px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-surface),0.62), rgba(var(--tj-surface-strong),0.72))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.62)',
        clipPath: CLIP_ITEM,
      }}
    >
      <div
        className="font-serif text-[11px] tracking-[0.24em]"
        style={{ color: 'rgba(var(--tj-arcane-accent-deep, var(--tj-accent-primary)), 0.86)' }}
      >
        {label}
      </div>
      <div className="mt-1 truncate font-serif text-[13px] tracking-[0.08em]" style={{ color: titleColor }}>
        {value}
      </div>
    </div>
  );
}

function ActionChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 font-serif text-[12px] tracking-[0.16em] transition-all hover:bg-[rgba(var(--tj-btn-primary-start),0.08)]"
      style={{
        color: active ? accentColor : faintColor,
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.52)'
          : 'inset 0 0 0 1px rgba(var(--tj-border), 0.52)',
        clipPath: CLIP_ITEM,
      }}
    >
      {children}
    </button>
  );
}

function AffinityBadge({ value }: { value: number }) {
  const tone = getAffinityTone(value);
  return (
    <div
      className="flex w-[92px] shrink-0 flex-col items-center justify-center px-3 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-surface),0.62), rgba(var(--tj-surface-strong),0.72))',
        boxShadow: `inset 0 0 0 1px ${tone.stroke}`,
        clipPath: CLIP_SECTION,
      }}
    >
      <div className="font-serif text-[34px] leading-none" style={{ color: tone.color }}>
        ♥
      </div>
      <div className="mt-1 font-mono text-[17px] font-semibold" style={{ color: tone.color }}>
        {value > 0 ? '+' : ''}
        {value}
      </div>
      <div className="mt-1 font-serif text-[11px] tracking-[0.22em]" style={{ color: mutedColor }}>
        好感度
      </div>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-4" style={panelStyle}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-3 w-[3px]" style={{ background: gradientAccent(0.86, 0.82) }} />
      <h4 className="font-serif text-[13px] tracking-[0.26em]" style={{ color: accentColor }}>
        {children}
      </h4>
      <span className="h-px flex-1" style={{ background: 'rgba(var(--tj-border), 0.46)' }} />
    </div>
  );
}

function Paragraph({ text, placeholder, italic = false }: { text?: string; placeholder: string; italic?: boolean }) {
  if (!text?.trim()) return <EmptyText text={placeholder} />;
  return (
    <p
      className={`font-serif text-[13.5px] leading-relaxed tracking-[0.06em] ${italic ? 'italic' : ''}`}
      style={{ color: bodyColor }}
    >
      {text}
    </p>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-serif text-[11px] tracking-[0.18em]" style={{ color: accentColor }}>{title}</div>
      <div className="mt-1 space-y-1" style={{ color: mutedColor }}>
        {(items.length ? items : ['暂无']).slice(0, 5).map((item, index) => (
          <div key={`${title}_${item}_${index}`}>- {compactListText(item)}</div>
        ))}
      </div>
    </div>
  );
}

function LedgerListCard({ title, items, tone = 'normal' }: { title: string; items: string[]; tone?: 'normal' | 'danger' }) {
  const visibleItems = items.length ? items : ['暂无'];
  const toneColor = tone === 'danger' ? 'rgba(var(--tj-ui-nsfw),0.92)' : accentColor;
  const railColor = tone === 'danger'
    ? 'rgba(var(--tj-ui-nsfw),0.45)'
    : 'rgba(var(--tj-arcane-accent-deep, var(--tj-accent-primary)), 0.52)';

  return (
    <div
      className="flex h-[214px] min-w-0 flex-col px-3 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-surface),0.58), rgba(var(--tj-surface-strong),0.72))',
        boxShadow: `inset 2px 0 0 ${railColor}, inset 0 0 0 1px rgba(var(--tj-border), 0.46)`,
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate font-serif text-[11px] tracking-[0.2em]" style={{ color: toneColor }}>
          {title}
        </div>
        <div
          className="shrink-0 px-1.5 py-0.5 font-mono text-[10px]"
          style={{
            color: toneColor,
            background: 'rgba(var(--tj-bg-primary), 0.42)',
            boxShadow: `inset 0 0 0 1px ${railColor}`,
          }}
        >
          {items.length}
        </div>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        <ul className="space-y-1.5">
          {visibleItems.map((item, index) => {
            const empty = !items.length;
            return (
              <li
                key={`${title}_${item}_${index}`}
                className={`min-w-0 break-words font-serif text-[12.5px] leading-relaxed tracking-[0.04em] ${empty ? 'italic' : ''}`}
                style={{ color: empty ? faintColor : bodyColor }}
              >
                <span style={{ color: empty ? faintColor : railColor }}>- </span>
                {item}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function compactListText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 71)}…`;
}

function MemoryPanel({ npc, devMode = false }: { npc: NPC记录; devMode?: boolean }) {
  const ledger = buildNpcMemoryLedgerView(npc, 8);
  const memories = 提取NPC同行记忆文本列表(npc).filter((item) => !item.startsWith('[压缩]'));
  const protectedCount =
    ledger.必须记得.length +
    ledger.禁止遗忘.length +
    ledger.未完成事项.length +
    ledger.未解决冲突.length;
  return (
    <div className="grid gap-4">
      {devMode && (
        <section className="grid gap-4 2xl:grid-cols-[0.86fr_1.14fr]">
          <DetailBlock title="账本状态">
            <div className="grid gap-2 sm:grid-cols-2">
              <LedgerFact label="关系阶段" value={ledger.当前关系阶段} />
              <LedgerFact label="好感度" value={`${ledger.好感度 > 0 ? '+' : ''}${ledger.好感度}`} />
              <LedgerFact label="最近回合" value={`第 ${ledger.最近回合} 回合`} />
              <LedgerFact label="称呼" value={ledger.对玩家称呼 || '未固定'} />
            </div>
            <div className="mt-3 space-y-2">
              <Paragraph text={ledger.最近互动} placeholder="尚无最近互动" />
              <Paragraph text={ledger.对玩家长期印象} placeholder="尚未形成长期印象" italic />
            </div>
          </DetailBlock>

          <DetailBlock title="必须承接">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="font-serif text-[12px] tracking-[0.12em]" style={{ color: mutedColor }}>
                长期保护事项 {protectedCount} 条
              </div>
              <Chip tone={protectedCount ? 'gold' : 'silver'}>{protectedCount ? '需要承接' : '暂无压力'}</Chip>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <LedgerListCard title="必须记得" items={ledger.必须记得} />
              <LedgerListCard title="禁止遗忘" items={ledger.禁止遗忘} tone="danger" />
              <LedgerListCard title="未完成事项" items={ledger.未完成事项} />
              <LedgerListCard title="未解决冲突" items={ledger.未解决冲突} tone="danger" />
            </div>
          </DetailBlock>
        </section>
      )}

      <section className={devMode ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4'}>
        {devMode && (
          <DetailBlock title="共同经历">
            <LedgerListCard title="共同经历" items={ledger.共同经历} />
          </DetailBlock>
        )}

        <DetailBlock title="总结记忆">
          {ledger.总结记忆.length ? (
            <ul className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
              {ledger.总结记忆.slice(-8).map((summary, index) => (
                <li
                  key={`${summary.id}_${index}`}
                  className="px-3 py-2 font-serif text-[13px] leading-relaxed tracking-[0.06em]"
                  style={{
                    color: bodyColor,
                    background: 'linear-gradient(135deg, rgba(var(--tj-surface),0.56), rgba(var(--tj-surface-strong),0.66))',
                    boxShadow: 'inset 2px 0 0 rgba(var(--tj-btn-primary-start), 0.54), inset 0 0 0 1px rgba(var(--tj-border), 0.48)',
                    clipPath: CLIP_ITEM,
                  }}
                >
                  <div className="mb-1 text-[11px] tracking-[0.18em]" style={{ color: accentColor }}>
                    {summary.回合范围 || '长期摘要'}{summary.条数 ? ` · ${summary.条数} 条` : ''}
                  </div>
                  {summary.摘要}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyText text="尚未形成压缩后的长期关系记忆" />
          )}
        </DetailBlock>
      </section>

      <DetailBlock title={devMode ? '原始同行记忆' : '同行记忆'}>
        {memories.length ? (
          <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {memories.slice(-12).map((memory, index) => (
              <li
                key={`${index}-${memory}`}
                className="px-3 py-2 font-serif text-[13px] leading-relaxed tracking-[0.06em]"
                style={{
                  color: bodyColor,
                  background: 'linear-gradient(135deg, rgba(var(--tj-surface),0.62), rgba(var(--tj-surface-strong),0.72))',
                  boxShadow: 'inset 2px 0 0 rgba(var(--tj-arcane-accent-deep, var(--tj-accent-primary)), 0.62), inset 0 0 0 1px rgba(var(--tj-border), 0.56)',
                  clipPath: CLIP_ITEM,
                }}
              >
                {memory}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyText text="尚未记录共同经历的关键时刻" />
        )}
      </DetailBlock>
    </div>
  );
}

function LedgerFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-serif text-[11px] tracking-[0.18em]" style={{ color: accentColor }}>{label}</div>
      <div className="mt-1 truncate font-serif text-[13px] tracking-[0.08em]" style={{ color: bodyColor }}>{value}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return (
    <p className="font-serif text-[12.5px] italic tracking-[0.12em]" style={{ color: faintColor }}>
      {text}
    </p>
  );
}

function Chip({ tone, children }: { tone: 'gold' | 'silver'; children: ReactNode }) {
  const palette =
    tone === 'gold'
      ? { color: 'rgba(var(--tj-btn-primary-start), 0.94)', stroke: 'rgba(var(--tj-btn-primary-start), 0.45)' }
      : { color: mutedColor, stroke: 'rgba(var(--tj-border), 0.54)' };
  return (
    <span
      className="px-2 py-0.5 font-serif text-[12px] tracking-[0.18em]"
      style={{ color: palette.color, boxShadow: `inset 0 0 0 1px ${palette.stroke}`, clipPath: CLIP_ITEM }}
    >
      {children}
    </span>
  );
}

function NoSelection({ tab }: { tab: NPC阶位 | 'archived' }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center" style={panelStyle}>
      <div>
        <div className="font-serif text-[28px]" style={{ color: 'rgba(var(--tj-btn-primary-start), 0.42)' }}>
          ✦
        </div>
        <div className="mt-3 font-serif text-[14px] tracking-[0.22em]" style={{ color: faintColor }}>
          从左侧选择一位{tab === 'companion' ? '伙伴' : tab === 'extra' ? '路人' : '已归档角色'}
        </div>
      </div>
    </div>
  );
}
