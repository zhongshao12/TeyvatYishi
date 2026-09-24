import { CLIP_CARD, CLIP_ITEM } from '@/styles/clipPaths';
import { useMemo, useState } from 'react';
import type { 角色数据结构 } from '@/models/character';
import { 创建空角色 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import { 创建空世界状态, 根据官方开局预设创建开局档案 } from '@/models/world';
import type { NPC记录 } from '@/models/npc';
import { 创建默认游戏设置, type API配置项, type API设置, type 游戏设置, type 主题预设 } from '@/models/settings';
import type { Talent, TalentCategory } from '@/models/teyvat/character';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { OFFICIAL_OPENING_PRESETS, type OfficialOpeningPresetId, type 剧情模式 } from '@/models/teyvat/opening';
import { getOfficialOpeningPreset, storyModes } from '@/data/journeyPresets';
import { unlockElement } from '@/services/elementalAttunementService';
import { createTeyvatGameFromOpeningPreset } from '@/services/teyvatOpeningFactory';
import type { TravelerTemplateContext, TravelerTemplateDraft } from '@/services/ai/travelerTemplate';
import { ELEMENT_NAMES as ELEMENT_LABELS } from '@/styles/elementTokens';
import { buildCanonicalElementTalents, buildCanonicalTravelerPreset, type CanonicalTravelerChoice } from '@/data/canonicalTravelerPresets';
import { LUMINE_COMPANION_OPENING_TEXT } from '@/data/openingCompanionScenes';
import { evaluateNewGameApiReadiness } from '@/utils/newGameApiReadiness';

interface NewGameWizardProps {
  onStart: (traveler: 角色数据结构, worldState: 世界状态, initialNpcRecords?: NPC记录[]) => void | Promise<void>;
  onBack: () => void;
  currentTheme: 主题预设;
  gameSettings?: 游戏设置;
  onGameSettingsChange?: React.Dispatch<React.SetStateAction<游戏设置>>;
  openingArchiveApiConfig?: API配置项 | null;
  apiSettings?: API设置;
  onOpenApiSettings?: () => void;
  onGenerateTravelerTemplate?: (context: TravelerTemplateContext) => Promise<TravelerTemplateDraft>;
}

const CATEGORY_LABELS: Record<TalentCategory, string> = {
  normal_attack: '普通攻击', elemental_skill: '元素战技', elemental_burst: '元素爆发', passive: '固有天赋',
};
const CATEGORY_ORDER: TalentCategory[] = ['normal_attack', 'elemental_skill', 'elemental_burst', 'passive'];

// 手账内页配色（与首页封面同一套 token）。
const INK = 'var(--journal-ink)';
const INK_MUTED = 'var(--journal-ink-muted)';
const PAPER_BORDER = 'rgba(53, 46, 39, 0.16)';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;



const STEPS = [
  { id: 1, label: '玩家档案' },
  { id: 2, label: '元素共鸣与天赋' },
  { id: 3, label: '开局预设' },
  { id: 4, label: '总览确认' },
] as const;

export interface NewGameOpeningPayloadInput {
  presetId: OfficialOpeningPresetId;
  name: string;
  alias?: string;
  gender?: string;
  age?: number;
  birthday?: string;
  appearance?: string;
  personality?: string;
  identity?: string;
  background?: string;
  element: ElementId;
  elements?: ElementId[];
  canonicalTraveler: 世界状态['原著主角'];
  canonicalPresetChoice?: CanonicalTravelerChoice | null;
  storyMode?: 剧情模式;
  talents: Talent[];
}

export function buildNewGameOpeningPayload(input: NewGameOpeningPayloadInput): {
  traveler: 角色数据结构;
  world: 世界状态;
} {
  const effectivePresetId: OfficialOpeningPresetId = input.canonicalPresetChoice ? 'official_mondstadt_dragon' : input.presetId;
  const openingGame = createTeyvatGameFromOpeningPreset(effectivePresetId);
  const preset = OFFICIAL_OPENING_PRESETS.find((item) => item.id === effectivePresetId)!;
  const base = 创建空角色();
  const travelerDraft = {
    ...base,
    id: input.canonicalPresetChoice
      ? `traveler_canonical_${input.canonicalPresetChoice === '空' ? 'aether' : 'lumine'}`
      : `traveler_${Date.now()}`,
    姓名: input.name.trim(),
    别名: input.alias?.trim() ?? '',
    性别: input.gender?.trim() ?? '',
    年龄: Number.isFinite(input.age) ? Math.max(1, Math.trunc(input.age!)) : 20,
    生日: input.birthday?.trim() ?? '',
    外貌: input.appearance?.trim() ?? '',
    性格: input.personality?.trim() ?? '',
    身份: input.identity?.trim() || openingGame.旅行者.身份,
    背景: input.background?.trim() ?? '',
    主元素: input.element,
    能力: [...(base.能力 ?? [])],
    天赋: input.talents
      .filter((talent) => !talent.关联元素 || (input.elements?.length ? input.elements : [input.element]).includes(talent.关联元素))
      .map((talent) => ({ ...talent })),
  };
  const selectedElements = Array.from(new Set(input.elements?.length ? input.elements : [input.element]));
  const traveler = selectedElements.reduce((current, resonanceElement) => unlockElement(current, resonanceElement, {
    source: 'traveler_resonance',
    unlockedAt: '开局',
    notes: `${preset.title}开局共鸣`,
  }), travelerDraft);
  const world = 创建空世界状态();
  world.当前地区 = openingGame.世界.当前地区 || undefined;
  world.当前地点 = openingGame.世界.当前地点;
  world.起航之地ID = effectivePresetId;
  world.原著主角 = input.canonicalTraveler;
  world.剧情模式 = input.storyMode ?? 'normal';
  const archivePreset = getOfficialOpeningPreset(effectivePresetId);
  if (archivePreset) world.开局档案 = 根据官方开局预设创建开局档案(archivePreset, world);
  if (input.canonicalTraveler === '荧' && world.开局档案) {
    world.开局档案.玩家介入原文 = LUMINE_COMPANION_OPENING_TEXT;
  }
  return { traveler, world };
}

export function NewGameWizard({ onStart, onBack, onGenerateTravelerTemplate, apiSettings, gameSettings, onOpenApiSettings }: NewGameWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('20');
  const [birthday, setBirthday] = useState('');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');
  const [identity, setIdentity] = useState('');
  const [background, setBackground] = useState('');
  const [element, setElement] = useState<ElementId>('anemo');
  const [elements, setElements] = useState<ElementId[]>(['anemo']);
  const [presetId, setPresetId] = useState<OfficialOpeningPresetId>('official_mondstadt_dragon');
  const [canonicalTraveler, setCanonicalTraveler] = useState<世界状态['原著主角']>('空');
  const [storyMode, setStoryMode] = useState<剧情模式>('normal');
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentName, setTalentName] = useState('');
  const [talentDescription, setTalentDescription] = useState('');
  const [talentCategory, setTalentCategory] = useState<TalentCategory>('elemental_skill');
  const [starting, setStarting] = useState(false);
  const [templatePrompt, setTemplatePrompt] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [canonicalPresetChoice, setCanonicalPresetChoice] = useState<CanonicalTravelerChoice | null>(null);

  const selectedPreset = useMemo(() => OFFICIAL_OPENING_PRESETS.find((preset) => preset.id === presetId)!, [presetId]);
  const apiReadiness = evaluateNewGameApiReadiness(
    apiSettings ?? { activeConfigId: null, configs: [] },
    gameSettings ?? 创建默认游戏设置(),
  );

  const addTalent = () => {
    if (!talentName.trim() || !talentDescription.trim()) return;
    setTalents((current) => [...current, {
      id: `talent_${Date.now()}`,
      名称: talentName.trim(),
      类别: talentCategory,
      关联元素: talentCategory === 'normal_attack' || talentCategory === 'passive' ? '' : element,
      等级: 1,
      说明: talentDescription.trim(),
    }]);
    setTalentName('');
    setTalentDescription('');
  };

  const generateTemplate = async () => {
    if (!onGenerateTravelerTemplate || templateLoading) return;
    setTemplateLoading(true);
    setTemplateError('');
    try {
      const draft = await onGenerateTravelerTemplate({
        storyModeName: storyModes.find((mode) => mode.id === storyMode)?.name,
        openingSourceLabel: '官方预设',
        openingRegionName: selectedPreset.title.split('·')[0]?.trim(),
        openingChapterName: selectedPreset.title,
        openingLocationHint: selectedPreset.location,
        openingMainlineEnabled: true,
        openingEntryText: selectedPreset.summary,
        existingName: name,
        existingAlias: alias,
        existingGender: gender,
        existingAge: Number(age) || undefined,
        existingBirthday: birthday,
        userPrompt: templatePrompt,
      });
      setName(draft.name);
      setAlias(draft.alias);
      setGender(draft.gender);
      setAge(String(draft.age));
      setBirthday(draft.birthday);
      setAppearance(draft.appearance);
      setPersonality(draft.personality);
      setBackground(draft.background);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '模板生成失败，请稍后再试。');
    } finally {
      setTemplateLoading(false);
    }
  };

  const start = async () => {
    if (!name.trim() || starting) return;
    setStarting(true);
    try {
      const payload = buildNewGameOpeningPayload({
        presetId, name, alias, gender, age: Number(age), birthday, appearance, personality, identity, background, element, elements, canonicalPresetChoice, canonicalTraveler, storyMode, talents,
      });
      await onStart(payload.traveler, payload.world, []);
    } finally {
      setStarting(false);
    }
  };

  const applyCanonicalTraveler = (choice: '空' | '荧') => {
    const preset = buildCanonicalTravelerPreset(choice);
    setCanonicalPresetChoice(choice);
    setCanonicalTraveler('无主角');
    setName(preset.name);
    setGender(preset.gender);
    setIdentity('跨越世界的旅行者');
    setAppearance(preset.appearance);
    setPersonality(preset.personality);
    setBackground(preset.background);
    setElement(preset.primaryElement);
    setPresetId('official_mondstadt_dragon');
    setElements(preset.元素共鸣.filter((item) => item.unlocked).map((item) => item.element));
    setTalents(preset.天赋.map((talent) => ({ ...talent })));
  };

  const toggleElement = (nextElement: ElementId) => {
    setElements((current) => {
      if (current.includes(nextElement)) {
        if (current.length === 1) return current;
        const next = current.filter((id) => id !== nextElement);
        const nextPrimary = next[0];
        if (element === nextElement && nextPrimary) setElement(nextPrimary);
        if (canonicalPresetChoice) setTalents((items) => items.filter((talent) => talent.关联元素 !== nextElement));
        return next;
      }
      if (!current.length) setElement(nextElement);
      if (canonicalPresetChoice) {
        setTalents((items) => [...items, ...buildCanonicalElementTalents(nextElement).filter((talent) => !items.some((entry) => entry.id === talent.id))]);
      }
      return [...current, nextElement];
    });
  };

  const patchTalent = (id: string, partial: Partial<Talent>) => {
    setTalents((current) => current.map((talent) => talent.id === id ? { ...talent, ...partial } : talent));
  };

  const canLeaveStep1 = Boolean(name.trim());
  const goNext = () => {
    if (step === 1 && !canLeaveStep1) return;
    setStep((current) => Math.min(4, current + 1) as 1 | 2 | 3 | 4);
    scrollToTop();
  };
  const goPrev = () => {
    setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3 | 4);
    scrollToTop();
  };
  const scrollToTop = () => {
    document.getElementById('new-game-wizard-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      id="new-game-wizard-scroll"
      className="mx-auto h-[100dvh] max-w-4xl overflow-y-auto p-4 pb-12 sm:p-6"
      style={{ background: 'linear-gradient(180deg, var(--journal-leather), var(--journal-leather-deep) 74%)' }}
    >
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="px-3 py-1.5 text-xs tracking-[0.12em]" style={{ color: 'rgba(239,227,201,0.9)', boxShadow: 'inset 0 0 0 1px rgba(240,213,139,0.4)', clipPath: CLIP_ITEM }}>
          ← 返回首页
        </button>
        <span className="text-[11px] tracking-[0.3em]" style={{ color: 'rgba(240,213,139,0.75)' }}>❦ 旅行者建档 ❦</span>
      </div>

      {/* 步骤指示条 */}
      <ol className="mt-4 flex items-center gap-1 sm:gap-2">
        {STEPS.map((item, index) => (
          <li key={item.id} className="flex flex-1 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => (item.id < step || (item.id === 2 && canLeaveStep1) ? setStep(item.id) : undefined)}
              className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-left"
              style={{ opacity: item.id === step ? 1 : 0.62, cursor: item.id < step || (item.id === 2 && canLeaveStep1) ? 'pointer' : 'default' }}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-serif text-[11px]"
                style={{
                  color: item.id <= step ? 'var(--journal-leather-deep)' : 'rgba(239,227,201,0.7)',
                  background: item.id <= step ? 'linear-gradient(135deg, #f0d58b, var(--journal-antique-gold))' : 'rgba(239,227,201,0.12)',
                  boxShadow: item.id === step ? '0 0 10px rgba(240,213,139,0.35)' : 'none',
                }}
              >
                {item.id}
              </span>
              <span className="hidden truncate font-serif text-[11px] tracking-[0.12em] sm:inline" style={{ color: item.id === step ? '#f0d58b' : 'rgba(239,227,201,0.6)' }}>
                {item.label}
              </span>
            </button>
            {index < STEPS.length - 1 && <span aria-hidden className="h-px flex-1" style={{ background: 'rgba(240,213,139,0.25)' }} />}
          </li>
        ))}
      </ol>

      {/* ── 步骤 1：玩家档案 ── */}
      {step === 1 && (
        <PaperSection title="玩家档案" subtitle="自定义旅行者身份；空与荧可并存于世界中。">
          <div className="grid gap-3 sm:grid-cols-2">
            <PaperField label="姓名"><input className={paperInput} value={name} onChange={(event) => setName(event.target.value)} /></PaperField>
            <PaperField label="别名"><input className={paperInput} value={alias} onChange={(event) => setAlias(event.target.value)} /></PaperField>
            <PaperField label="性别"><input className={paperInput} value={gender} onChange={(event) => setGender(event.target.value)} /></PaperField>
            <PaperField label="年龄"><input className={paperInput} inputMode="numeric" value={age} onChange={(event) => setAge(event.target.value)} /></PaperField>
            <PaperField label="生日"><input className={paperInput} value={birthday} onChange={(event) => setBirthday(event.target.value)} placeholder="如 8月14日" /></PaperField>
            <PaperField label="身份"><input className={paperInput} value={identity} onChange={(event) => setIdentity(event.target.value)} /></PaperField>
            <PaperField label="外貌"><textarea className={`${paperInput} min-h-24 w-full`} value={appearance} onChange={(event) => setAppearance(event.target.value)} /></PaperField>
            <PaperField label="性格"><textarea className={`${paperInput} min-h-24 w-full`} value={personality} onChange={(event) => setPersonality(event.target.value)} /></PaperField>
            <PaperField label="背景"><textarea className={`${paperInput} min-h-24 w-full`} value={background} onChange={(event) => setBackground(event.target.value)} /></PaperField>
            <PaperField label="原著旅行者（决定剧情中的另一位主角）"><select className={paperInput} value={canonicalTraveler} onChange={(event) => setCanonicalTraveler(event.target.value as 世界状态['原著主角'])}><option value="无主角">无主角（自定义旅行者独行）</option><option value="空">空</option><option value="荧">荧</option></select></PaperField>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-[11px] tracking-[0.08em]" style={{ color: INK_MUTED }}>快捷预设：一键套用空 / 荧的官方形象，仍可逐项修改。</p>
              <div className="flex gap-2">
                <PaperButton onClick={() => applyCanonicalTraveler('空')}>套用「空」预设</PaperButton>
                <PaperButton onClick={() => applyCanonicalTraveler('荧')}>套用「荧」预设</PaperButton>
              </div>
              {canonicalPresetChoice && <p className="text-[11px] leading-5" style={{ color: 'var(--journal-travel-green)' }}>已套用「{canonicalPresetChoice}」七元素原作档案。姓名、身份、外貌、元素和每条天赋均可继续修改。</p>}
            </div>
            {onGenerateTravelerTemplate && <div className="space-y-2 sm:col-span-2">
              <PaperField label="生成偏好（可选）"><textarea className={`${paperInput} min-h-20 w-full`} value={templatePrompt} onChange={(event) => setTemplatePrompt(event.target.value)} placeholder="例如：温和的蒙德炼金术学徒，擅长风元素辅助，不要贵族背景" /></PaperField>
              <div className="flex flex-wrap items-center gap-3">
                <PaperButton onClick={() => void generateTemplate()} disabled={templateLoading}>{templateLoading ? '正在生成模板…' : '✦ 随机生成模板'}</PaperButton>
                <span className="text-[11px]" style={{ color: INK_MUTED }}>该功能走主 API 模型，生成后仍可逐项修改。</span>
              </div>
              {templateError && <p role="alert" className="text-xs" style={{ color: 'var(--tj-danger)' }}>{templateError}</p>}
            </div>}
          </div>
        </PaperSection>
      )}

      {/* ── 步骤 2：元素共鸣与天赋 ── */}
      {step === 2 && (
        <div className="space-y-5">
          <PaperSection title="初始元素共鸣" subtitle="可多选并自由修改；带金底的第一项是当前主元素。空 / 荧预设默认登记原作七元素共鸣。">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {ELEMENT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    if (elements.includes(id)) setElement(id);
                    else toggleElement(id);
                  }}
                  onDoubleClick={() => toggleElement(id)}
                  aria-pressed={elements.includes(id)}
                  title={elements.includes(id) ? (element === id ? '当前主元素；双击移除此共鸣' : '点击设为主元素；双击移除此共鸣') : '点击添加此元素共鸣'}
                  className="px-2 py-2.5 text-center font-serif text-sm transition-colors"
                  style={{
                    color: element === id ? 'var(--journal-leather-deep)' : INK,
                    background: element === id ? 'linear-gradient(135deg, #f0d58b, var(--journal-antique-gold))' : elements.includes(id) ? 'rgba(70,98,78,0.14)' : 'rgba(53,46,39,0.05)',
                    boxShadow: `inset 0 0 0 1px ${element === id ? 'rgba(240,213,139,0.8)' : elements.includes(id) ? 'rgba(70,98,78,0.5)' : PAPER_BORDER}`,
                    clipPath: CLIP_ITEM,
                  }}
                >
                  {ELEMENT_LABELS[id]}
                </button>
              ))}
            </div>
          </PaperSection>
          <PaperSection title="旅行者天赋" subtitle="可创建普通攻击、元素战技、元素爆发与固有天赋；留空则由剧情中逐步习得。">
            <div className="grid gap-2 sm:grid-cols-4">
              <input className={paperInput} value={talentName} onChange={(event) => setTalentName(event.target.value)} placeholder="天赋名称" aria-label="天赋名称" />
              <select className={paperInput} value={talentCategory} onChange={(event) => setTalentCategory(event.target.value as TalentCategory)} aria-label="天赋类别">
                {CATEGORY_ORDER.map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
              </select>
              <input className={paperInput} value={talentDescription} onChange={(event) => setTalentDescription(event.target.value)} placeholder="效果与限制" aria-label="效果与限制" />
              <PaperButton onClick={addTalent}>添加天赋</PaperButton>
            </div>
            {talents.length === 0 ? (
              <p className="mt-3 text-xs leading-5" style={{ color: INK_MUTED }}>尚未登记天赋——不加也可以，开局后仍可在「天赋」面板补录。</p>
            ) : (
              <div className="mt-3 space-y-2">
                {talents.map((talent) => (
                  <div key={talent.id} className="px-4 py-3" style={{ background: 'rgba(53,46,39,0.05)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`, clipPath: CLIP_ITEM }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(130px,1fr)_120px_90px]">
                        <input className={paperInput} value={talent.名称} onChange={(event) => patchTalent(talent.id, { 名称: event.target.value })} aria-label={`天赋名称 ${talent.id}`} />
                        <select className={paperInput} value={talent.类别} onChange={(event) => patchTalent(talent.id, { 类别: event.target.value as TalentCategory })} aria-label={`天赋类别 ${talent.id}`}>
                          {CATEGORY_ORDER.map((id) => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}
                        </select>
                        <select className={paperInput} value={talent.关联元素} onChange={(event) => patchTalent(talent.id, { 关联元素: event.target.value as ElementId | '' })} aria-label={`关联元素 ${talent.id}`}>
                          <option value="">无</option>
                          {ELEMENT_IDS.map((id) => <option key={id} value={id}>{ELEMENT_LABELS[id]}</option>)}
                        </select>
                      </div>
                      <button type="button" onClick={() => setTalents((current) => current.filter((item) => item.id !== talent.id))} className="shrink-0 text-[11px]" style={{ color: 'var(--tj-danger)' }}>移除</button>
                    </div>
                    <textarea className={`${paperInput} mt-2 min-h-16 w-full`} value={talent.说明} onChange={(event) => patchTalent(talent.id, { 说明: event.target.value })} aria-label={`天赋说明 ${talent.id}`} />
                  </div>
                ))}
              </div>
            )}
          </PaperSection>
        </div>
      )}

      {/* ── 步骤 3：开局预设 ── */}
      {step === 3 && (
        <div className="space-y-5">
          <PaperSection title="官方开局预设" subtitle={canonicalPresetChoice ? '空／荧原著预设固定从蒙德觉醒风元素；后续再随旅程解锁其他元素。' : '提供地区、地点与叙事种子，不锁定剧情路线。'}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {OFFICIAL_OPENING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => !canonicalPresetChoice && setPresetId(preset.id)}
                  disabled={Boolean(canonicalPresetChoice && preset.id !== 'official_mondstadt_dragon')}
                  className="p-3 text-left disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: presetId === preset.id ? 'linear-gradient(135deg, #f0d58b33, #b68a4322)' : 'rgba(53,46,39,0.04)',
                    boxShadow: `inset 0 0 0 1px ${presetId === preset.id ? 'var(--journal-antique-gold)' : PAPER_BORDER}`,
                    clipPath: CLIP_ITEM,
                  }}
                >
                  <strong className="font-serif text-sm" style={{ color: INK }}>{preset.title}</strong>
                  <p className="mt-2 text-xs leading-5" style={{ color: INK_MUTED }}>{preset.summary}</p>
                </button>
              ))}
            </div>
          </PaperSection>
          <PaperSection title="剧情模式" subtitle="决定关系与群像的叙事侧重，不锁死剧情。">
            <div className="grid gap-2 sm:grid-cols-2">
              {storyModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setStoryMode(mode.id)}
                  className="p-3 text-left"
                  style={{
                    background: storyMode === mode.id ? 'linear-gradient(135deg, #f0d58b33, #b68a4322)' : 'rgba(53,46,39,0.04)',
                    boxShadow: `inset 0 0 0 1px ${storyMode === mode.id ? 'var(--journal-antique-gold)' : PAPER_BORDER}`,
                    clipPath: CLIP_ITEM,
                  }}
                >
                  <strong className="font-serif text-sm" style={{ color: INK }}>{mode.name}</strong>
                  <p className="mt-2 text-xs leading-5" style={{ color: INK_MUTED }}>{mode.description}</p>
                </button>
              ))}
            </div>
          </PaperSection>
        </div>
      )}

      {/* ── 步骤 4：总览确认 ── */}
      {step === 4 && (
        <PaperSection title="总览确认" subtitle="确认档案无误后，翻开来旅的第一页。">
          <section
            aria-label="开局 API 就绪检查"
            className="mb-4 space-y-2 px-3 py-3 text-xs leading-5"
            style={{ background: 'rgba(70,98,78,0.08)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`, clipPath: CLIP_ITEM }}
          >
            <h4 className="font-serif text-sm" style={{ color: INK }}>开局 API 就绪检查</h4>
            {[apiReadiness.main, apiReadiness.variable, apiReadiness.image].map((entry) => (
              <p key={entry.label} className="break-words" style={{ color: INK }}>
                <span className="font-semibold">{entry.label}{entry.status === 'ready' ? '已配置（尚未测试连接）' : entry.status === 'disabled' ? '未开启' : '未就绪'}</span>
                <span className="ml-2" style={{ color: INK_MUTED }}>{entry.detail}</span>
              </p>
            ))}
            {apiReadiness.main.status !== 'ready' && (
              <p style={{ color: INK_MUTED }}>可以继续建档；开始游戏前配置主模型，才能生成正文。</p>
            )}
            {onOpenApiSettings && <PaperButton onClick={onOpenApiSettings}>打开 API 设置</PaperButton>}
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBlock label="旅行者">
              <p className="font-serif text-base" style={{ color: 'var(--journal-antique-gold)' }}>{name}</p>
              <SummaryLine label="别名" value={alias} />
              <SummaryLine label="性别 / 年龄" value={`${gender || '未填'} / ${age}`} />
              <SummaryLine label="身份" value={identity} />
              <SummaryLine label="生日" value={birthday} />
              <SummaryLine label="原著旅行者" value={canonicalTraveler === '无主角' ? '无主角（自定义旅行者独行）' : canonicalTraveler === '空荧双主角' ? '空与荧并存' : canonicalTraveler} />
            </SummaryBlock>
            <SummaryBlock label="元素与预设">
              <SummaryLine label="元素共鸣" value={elements.map((id) => ELEMENT_LABELS[id]).join('、')} />
              <SummaryLine label="主元素" value={ELEMENT_LABELS[element]} />
              <SummaryLine label="开局预设" value={canonicalPresetChoice ? OFFICIAL_OPENING_PRESETS.find((preset) => preset.id === 'official_mondstadt_dragon')?.title ?? selectedPreset.title : selectedPreset.title} />
              <SummaryLine label="剧情模式" value={storyModes.find((mode) => mode.id === storyMode)?.name ?? storyMode} />
              <SummaryLine label="天赋" value={talents.length ? `${talents.length} 条` : '暂无（开局后可补录）'} />
            </SummaryBlock>
            {(appearance || personality || background) && (
              <SummaryBlock label="档案细节" span>
                {appearance && <SummaryLine label="外貌" value={appearance} />}
                {personality && <SummaryLine label="性格" value={personality} />}
                {background && <SummaryLine label="背景" value={background} />}
              </SummaryBlock>
            )}
            {talents.length > 0 && (
              <SummaryBlock label="天赋清单" span>
                {talents.map((talent) => (
                  <SummaryLine key={talent.id} label={`${talent.名称}（${CATEGORY_LABELS[talent.类别]}${talent.关联元素 ? ` · ${ELEMENT_LABELS[talent.关联元素]}` : ''}）`} value={talent.说明} />
                ))}
              </SummaryBlock>
            )}
          </div>
        </PaperSection>
      )}

      {/* ── 步骤导航 ── */}
      <footer className="flex items-center justify-between gap-3 pb-4">
        {step > 1 ? (
          <PaperButton onClick={goPrev}>← 上一步</PaperButton>
        ) : (
          <button type="button" onClick={onBack} className="px-4 py-2 text-xs tracking-[0.12em]" style={{ color: 'rgba(239,227,201,0.85)', boxShadow: 'inset 0 0 0 1px rgba(240,213,139,0.35)', clipPath: CLIP_ITEM }}>← 返回首页</button>
        )}
        {step < 4 ? (
          <PaperButton onClick={goNext} disabled={step === 1 && !canLeaveStep1}>下一步 →</PaperButton>
        ) : (
          <button
            type="button"
            disabled={!name.trim() || starting}
            onClick={() => void start()}
            className="teyvat-btn teyvat-btn-primary px-8 py-2.5 text-sm disabled:opacity-50"
          >
            <span className="relative">{starting ? '正在启程…' : '✦ 开始旅程'}</span>
          </button>
        )}
      </footer>
    </div>
  );
}

const paperInput =
  'w-full bg-transparent px-3 py-2 text-sm outline-none transition-shadow focus:shadow-[inset_0_0_0_1px_var(--journal-antique-gold)]';

function PaperSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section
      className="p-5"
      style={{
        background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 88%, var(--journal-leather) 12%))',
        boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}, 0 14px 34px rgba(0, 0, 0, 0.32)`,
        clipPath: CLIP_CARD,
      }}
    >
      <h3 className="font-serif text-lg tracking-[0.14em]" style={{ color: INK }}>{title}</h3>
      {subtitle && <p className="mt-1 text-xs leading-5" style={{ color: INK_MUTED }}>{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PaperField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-[11px] tracking-[0.08em]" style={{ color: INK_MUTED }}>
      <span>{label}</span>
      <span className={paperInput} style={{ display: 'block', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`, clipPath: CLIP_ITEM, color: INK }}>{children}</span>
    </label>
  );
}

function PaperButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-xs tracking-[0.12em] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        color: 'var(--journal-leather-deep)',
        background: 'linear-gradient(135deg, #f0d58b, var(--journal-antique-gold))',
        boxShadow: 'inset 0 0 0 1px rgba(240, 213, 139, 0.6)',
        clipPath: CLIP_ITEM,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function SummaryBlock({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={`px-3 py-3 ${span ? 'sm:col-span-2' : ''}`} style={{ background: 'rgba(53, 46, 39, 0.05)', boxShadow: `inset 0 0 0 1px ${PAPER_BORDER}`, clipPath: CLIP_ITEM }}>
      <p className="text-[10px] tracking-[0.24em]" style={{ color: 'var(--journal-antique-gold)' }}>{label}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value?: string | number }) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!text) return null;
  return (
    <p className="grid gap-0.5 text-[12px] leading-5 sm:grid-cols-[88px_1fr]">
      <span style={{ color: 'var(--journal-antique-gold)' }}>{label}</span>
      <span className="min-w-0 break-words" style={{ color: 'color-mix(in srgb, var(--journal-ink) 88%, transparent)' }}>{text}</span>
    </p>
  );
}
