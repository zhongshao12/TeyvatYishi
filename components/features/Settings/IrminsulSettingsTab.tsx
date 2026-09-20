import { CLIP_CARD, CLIP_MEDIUM, CLIP_SMALL, CLIP_XS, gradientAccent, insetRing } from '@/styles/clipPaths';
import { useSavedFlash } from '@/hooks/useSavedFlash';
import { AI_PROVIDER_OPTIONS } from '@/data/aiProviderOptions';
import { useMemo, useState } from 'react';
import type { AI提供商, API设置, 游戏设置, 世界树API覆盖 } from '@/models/settings';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { fetchModels, testConnection, type ConnectionTestResult } from '@/services/ai/apiTools';
import { saveSetting } from '@/services/dbService';

interface Props {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
  apiSettings: API设置;
}

const providerOptions = AI_PROVIDER_OPTIONS;




interface ResolvedApi {
  provider: AI提供商;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  retryCount: number;
  enableClaudeMode?: boolean;
}

export function IrminsulSettingsTab({ settings, onChange, apiSettings }: Props) {
  const memory = settings.记忆系统 ?? 创建默认记忆系统设置();
  const mainConfig = useMemo(
    () => apiSettings.configs.find((c) => c.id === apiSettings.activeConfigId) ?? null,
    [apiSettings.activeConfigId, apiSettings.configs],
  );

  const [recallLoadingModels, setRecallLoadingModels] = useState(false);
  const [recallModelOptions, setRecallModelOptions] = useState<string[]>([]);
  const [recallTestResult, setRecallTestResult] = useState<ConnectionTestResult | null>(null);
  const [recallMessage, setRecallMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const [archiveLoadingModels, setArchiveLoadingModels] = useState(false);
  const [archiveModelOptions, setArchiveModelOptions] = useState<string[]>([]);
  const [archiveTestResult, setArchiveTestResult] = useState<ConnectionTestResult | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const { savedFlash, showSavedFlash, clearSavedFlash } = useSavedFlash(1800);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  const patchMemory = (patch: Partial<typeof memory>) => {
    onChange({
      ...settings,
      记忆系统: {
        ...memory,
        ...patch,
      },
    });
  };

  const buildEffective = (api: 世界树API覆盖): ResolvedApi => ({
    provider: (api.provider || mainConfig?.provider || 'openai_compatible') as AI提供商,
    baseUrl: api.baseUrl.trim() || mainConfig?.baseUrl || '',
    apiKey: api.apiKey.trim() || mainConfig?.apiKey || '',
    model: api.model.trim() || mainConfig?.model || '',
    maxTokens: api.maxTokens ?? mainConfig?.maxTokens,
    temperature: api.temperature ?? mainConfig?.temperature,
    retryCount: api.retryCount ?? mainConfig?.retryCount ?? 2,
    enableClaudeMode: settings.enableClaudeMode === true,
  });

  const recallEffective = buildEffective(memory.世界树召回API);
  const archiveEffective = buildEffective(memory.世界树归档API);

  const recallModelChoices = useMemo(() => uniqueModels([recallEffective.model, ...recallModelOptions]), [
    recallEffective.model,
    recallModelOptions,
  ]);
  const archiveModelChoices = useMemo(() => uniqueModels([archiveEffective.model, ...archiveModelOptions]), [
    archiveEffective.model,
    archiveModelOptions,
  ]);

  const patchRecallApi = (patch: Partial<typeof memory.世界树召回API>) => {
    patchMemory({
      世界树召回API: {
        ...memory.世界树召回API,
        ...patch,
      },
    });
  };

  const patchArchiveApi = (patch: Partial<typeof memory.世界树归档API>) => {
    patchMemory({
      世界树归档API: {
        ...memory.世界树归档API,
        ...patch,
      },
    });
  };

  const fetchRecallModels = async () => {
    if (!recallEffective.baseUrl || !recallEffective.apiKey) {
      setRecallMessage({
        kind: 'error',
        text: mainConfig
          ? '世界树召回会回退主 API；如果主 API 也没配，请先补全。'
          : '请先填写世界树召回 API 的 Base URL 和 API Key，或先配置主 API。',
      });
      return;
    }
    setRecallLoadingModels(true);
    setRecallMessage(null);
    try {
      const list = await fetchModels({ ...recallEffective, name: '世界树召回' });
      setRecallModelOptions(list);
      if (list.length > 0 && !list.includes(memory.世界树召回API.model.trim())) {
        patchRecallApi({ model: list[0] });
      }
      setRecallMessage({ kind: 'info', text: `已获取 ${list.length} 个模型。` });
    } catch (err) {
      setRecallMessage({ kind: 'error', text: `获取模型失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setRecallLoadingModels(false);
    }
  };

  const testRecall = async () => {
    if (!recallEffective.baseUrl || !recallEffective.apiKey || !recallEffective.model) {
      setRecallTestResult({ ok: false, detail: '请先补全世界树召回 API 的 Base URL / API Key / Model。' });
      return;
    }
    try {
      const result = await testConnection({ ...recallEffective, name: '世界树召回' });
      setRecallTestResult(result);
    } catch (err) {
      setRecallTestResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const fetchArchiveModels = async () => {
    if (!archiveEffective.baseUrl || !archiveEffective.apiKey) {
      setArchiveMessage({
        kind: 'error',
        text: mainConfig
          ? '世界树归档会回退主 API；如果主 API 也没配，请先补全。'
          : '请先填写世界树归档 API 的 Base URL 和 API Key，或先配置主 API。',
      });
      return;
    }
    setArchiveLoadingModels(true);
    setArchiveMessage(null);
    try {
      const list = await fetchModels({ ...archiveEffective, name: '世界树归档' });
      setArchiveModelOptions(list);
      if (list.length > 0 && !list.includes(memory.世界树归档API.model.trim())) {
        patchArchiveApi({ model: list[0] });
      }
      setArchiveMessage({ kind: 'info', text: `已获取 ${list.length} 个模型。` });
    } catch (err) {
      setArchiveMessage({ kind: 'error', text: `获取模型失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setArchiveLoadingModels(false);
    }
  };

  const testArchive = async () => {
    if (!archiveEffective.baseUrl || !archiveEffective.apiKey || !archiveEffective.model) {
      setArchiveTestResult({ ok: false, detail: '请先补全世界树归档 API 的 Base URL / API Key / Model。' });
      return;
    }
    try {
      const result = await testConnection({ ...archiveEffective, name: '世界树归档' });
      setArchiveTestResult(result);
    } catch (err) {
      setArchiveTestResult({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSave = async () => {
    try {
      await saveSetting('gameSettings', settings);
      showSavedFlash();
      setSaveMessage({ kind: 'info', text: '世界树设置已保存。' });
    } catch (err) {
      clearSavedFlash();
      setSaveMessage({ kind: 'error', text: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <div className="space-y-5">
      <div
        className="px-4 py-3 text-xs leading-relaxed"
        style={{
          color: 'rgba(var(--tj-text-secondary), 0.78)',
          background: 'rgba(var(--tj-accent-primary), 0.05)',
          boxShadow: insetRing(0.15),
          clipPath: CLIP_CARD,
        }}
      >
        <div className="mb-1 font-serif text-[13px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))' }}>
          世界树
        </div>
        回忆库的独立接口分成两层：召回负责检索可注入的记忆，精炼负责把材料压成可回看的摘要与原文层。
      </div>

      <Section title="系统开关">
        <ToggleField
          label="启用世界树召回"
          desc="开启后，达到触发回合后会检索回忆档案并注入主剧情。关闭只停止召回，回合纪要仍会入库，方便之后重新开启。"
          checked={memory.世界树启用 !== false}
          onChange={(checked) => patchMemory({ 世界树启用: checked })}
        />
        <ToggleField
          label="启用独立精炼"
          desc="开启后，世界树归档会调用独立 API 生成概要；关闭时使用主剧情小总结和本地格式兜底。"
          checked={memory.世界树独立归档 === true}
          onChange={(checked) => patchMemory({ 世界树独立归档: checked })}
        />
      </Section>

      <ApiSection
        title="回忆接口"
        description="这里负责从回忆库里检索记忆，返回给主剧情做注入。"
        api={memory.世界树召回API}
        effective={recallEffective}
        modelOptions={recallModelChoices}
        loadingModels={recallLoadingModels}
        message={recallMessage}
        testResult={recallTestResult}
        onPatch={patchRecallApi}
        onFetchModels={fetchRecallModels}
        onTest={testRecall}
        mainConfig={mainConfig}
      />

      <ApiSection
        title="精炼接口"
        description="这里负责把回合材料压成回忆档案的摘要与原文层。"
        api={memory.世界树归档API}
        effective={archiveEffective}
        modelOptions={archiveModelChoices}
        loadingModels={archiveLoadingModels}
        message={archiveMessage}
        testResult={archiveTestResult}
        onPatch={patchArchiveApi}
        onFetchModels={fetchArchiveModels}
        onTest={testArchive}
        mainConfig={mainConfig}
      />

      <Section title="精炼规则">
        <TextareaField
          label="回忆库精炼提示词"
          value={memory.世界树归档提示词}
          onChange={(value) => patchMemory({ 世界树归档提示词: value })}
          rows={8}
          hint="用于把多回合材料压成摘要与原文两层，摘要要短，原文要完整，不要变成新剧情。"
        />
      </Section>

      <div className="flex flex-col items-stretch gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="w-full py-3 text-sm font-serif tracking-[0.4em] transition-all hover:opacity-90"
          style={{
            background: savedFlash
              ? 'linear-gradient(135deg, rgba(140, 220, 160, 0.95), rgba(100, 180, 130, 0.95))'
              : gradientAccent(0.96, 0.84),
            color: 'rgb(var(--tj-on-accent))',
            boxShadow: savedFlash
              ? 'inset 0 0 0 1px rgba(220, 255, 230, 0.5), 0 0 18px rgba(140, 220, 160, 0.35)'
              : 'inset 0 0 0 1px rgba(var(--tj-text-primary), 0.5), 0 0 18px rgba(var(--tj-accent-primary), 0.22)',
            clipPath: CLIP_CARD,
          }}
        >
          {savedFlash ? '✓ 已 保 存' : '◆ 保 存 配 置'}
        </button>
      </div>

      {saveMessage && (
        <div
          className="px-3 py-2 text-xs"
          style={{
            color: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.9)' : 'rgba(160, 200, 160, 0.85)',
            background: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.06)' : 'rgba(120, 200, 140, 0.06)',
            boxShadow: saveMessage.kind === 'error'
              ? 'inset 0 0 0 1px rgba(220, 120, 120, 0.25)'
              : 'inset 0 0 0 1px rgba(120, 200, 140, 0.25)',
            clipPath: CLIP_SMALL,
          }}
        >
          {saveMessage.text}
        </div>
      )}
    </div>
  );
}

function ToggleField({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        background: 'rgba(var(--tj-bg-secondary), 0.45)',
        boxShadow: insetRing(0.15),
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div className="min-w-0 mr-3">
        <div className="font-serif font-bold text-sm tracking-wider" style={{ color: 'rgb(var(--tj-text-primary))' }}>
          {label}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'rgba(var(--tj-text-secondary), 0.65)' }}>
          {desc}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 flex-shrink-0 transition-all"
        style={{
          background: checked
            ? gradientAccent(0.95, 0.86)
            : 'rgba(var(--tj-bg-secondary), 0.68)',
          boxShadow: checked
            ? 'inset 0 0 0 1px rgba(var(--tj-text-primary), 0.5), 0 0 10px rgba(var(--tj-accent-primary), 0.25)'
            : insetRing(0.2),
          clipPath: CLIP_SMALL,
        }}
      >
        <div
          className="absolute top-0.5 h-5 w-5 transition-transform"
          style={{
            left: checked ? 'calc(100% - 1.375rem)' : '0.125rem',
            background: checked ? 'rgb(var(--tj-bg-primary))' : 'rgba(var(--tj-text-secondary), 0.78)',
            clipPath: CLIP_XS,
          }}
        />
      </button>
    </div>
  );
}

function ApiSection({
  title,
  description,
  api,
  effective,
  modelOptions,
  loadingModels,
  message,
  testResult,
  onPatch,
  onFetchModels,
  onTest,
  mainConfig,
}: {
  title: string;
  description: string;
  api: 世界树API覆盖;
  effective: ResolvedApi;
  modelOptions: string[];
  loadingModels: boolean;
  message: { kind: 'info' | 'error'; text: string } | null;
  testResult: ConnectionTestResult | null;
  onPatch: (patch: Partial<世界树API覆盖>) => void;
  onFetchModels: () => void;
  onTest: () => void;
  mainConfig: { baseUrl?: string; apiKey?: string; model?: string } | null;
}) {
  return (
    <Section title={title}>
      <div
        className="px-3 py-2 text-xs leading-relaxed"
        style={{
          color: 'rgba(var(--tj-text-secondary), 0.78)',
          background: 'rgba(var(--tj-accent-primary), 0.04)',
          boxShadow: insetRing(0.12),
          clipPath: CLIP_SMALL,
        }}
      >
        {description}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label="供应商"
          value={effective.provider}
          onChange={(value) => onPatch({ provider: value as AI提供商 })}
          options={providerOptions.map((option) => ({ value: option.value, label: option.label }))}
        />
        <label className="block md:col-span-2">
          <div className="mb-1.5 font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
            模型
          </div>
          <div className="flex gap-2">
            <input
              value={api.model}
              onChange={(e) => onPatch({ model: e.target.value })}
              className="teyvat-input flex-1 px-2.5 py-1.5 text-sm"
              style={{ clipPath: CLIP_SMALL }}
              placeholder="模型 ID"
            />
            <button
              type="button"
              onClick={onFetchModels}
              className="px-3 py-1.5 text-xs font-serif tracking-wider transition-all disabled:opacity-50"
              style={{
                color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))',
                boxShadow: insetRing(0.45),
                background: 'rgba(var(--tj-accent-primary), 0.06)',
                clipPath: CLIP_SMALL,
              }}
            >
              {loadingModels ? '获取中...' : '获取模型'}
            </button>
          </div>
          {modelOptions.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onPatch({ model: e.target.value });
              }}
              className="teyvat-input mt-2 w-full px-2.5 py-1.5 text-xs"
              style={{ clipPath: CLIP_SMALL }}
            >
              <option value="">— 从列表选择（{modelOptions.length}）—</option>
              {modelOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </label>
	        <InputField label="Base URL" value={api.baseUrl} onChange={(value) => onPatch({ baseUrl: value })} placeholder={mainConfig?.baseUrl ? '留空则使用主 API：' + mainConfig.baseUrl : 'https://...'} />
	        <InputField label="API Key" value={api.apiKey} onChange={(value) => onPatch({ apiKey: value })} type="password" placeholder={mainConfig?.apiKey ? '留空则使用主 API 的 Key' : 'sk-...'} />
        <NumberField
          label="最大输出"
          value={api.maxTokens ?? 1024}
          onChange={(value) => onPatch({ maxTokens: Math.max(1, value) })}
          hint="留给该接口的最大输出 token。"
        />
        <NumberField
          label="温度"
          value={Math.round(((api.temperature ?? 0.2) * 100)) / 100}
          onChange={(value) => onPatch({ temperature: value })}
          hint="建议保持偏低，减少摘要和召回偏移。"
          step={0.05}
          min={0}
          max={2}
        />
        <NumberField
          label="重试"
          value={api.retryCount ?? 2}
          onChange={(value) => onPatch({ retryCount: Math.max(0, Math.trunc(value)) })}
          hint="获取模型和测试连接失败时自动重试的次数。"
          step={1}
          min={0}
          max={5}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onFetchModels}
          className="px-3 py-1.5 text-sm font-serif tracking-wider transition-all disabled:opacity-50"
          style={{
            color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))',
            boxShadow: insetRing(0.45),
            background: 'rgba(var(--tj-accent-primary), 0.06)',
            clipPath: CLIP_SMALL,
          }}
        >
          {loadingModels ? '获取中...' : '获取模型'}
        </button>
        <button
          type="button"
          onClick={onTest}
          className="px-3 py-1.5 text-sm font-serif tracking-wider transition-all disabled:opacity-50"
          style={{
            color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))',
            boxShadow: insetRing(0.45),
            background: 'rgba(var(--tj-accent-primary), 0.06)',
            clipPath: CLIP_SMALL,
          }}
        >
          测试连接
        </button>
      </div>

      {modelOptions.length > 0 && (
        <div className="mt-3 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.74)' }}>
          已获取模型：{modelOptions.slice(0, 8).join(' · ')}
        </div>
      )}

      {message && (
        <div
          className="mt-3 px-3 py-2 text-xs"
          style={{
            color: message.kind === 'error' ? '#ffb7b7' : 'rgba(var(--tj-text-secondary), 0.95)',
            background: message.kind === 'error' ? 'rgba(120, 30, 30, 0.35)' : 'rgba(var(--tj-accent-primary), 0.05)',
            boxShadow: insetRing(0.12),
            clipPath: CLIP_SMALL,
          }}
        >
          {message.text}
        </div>
      )}

      {testResult && (
        <div
          className="mt-3 px-3 py-2 text-xs leading-relaxed"
          style={{
            color: testResult.ok ? 'rgba(220, 240, 220, 0.95)' : '#ffb7b7',
            background: testResult.ok ? 'rgba(60, 120, 70, 0.28)' : 'rgba(120, 30, 30, 0.35)',
            boxShadow: insetRing(0.12),
            clipPath: CLIP_SMALL,
          }}
        >
          {testResult.detail}
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-4"
      style={{
        background: 'rgba(var(--tj-accent-primary), 0.035)',
        boxShadow: insetRing(0.18),
        clipPath: CLIP_CARD,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
        <span className="font-serif text-[13px] font-semibold tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
          {title}
        </span>
        <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.35), transparent)' }} />
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
        {label}
      </div>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="teyvat-input w-full px-3 py-2 text-sm font-mono"
        style={{ clipPath: CLIP_SMALL }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="teyvat-input w-full px-3 py-2 text-sm"
        style={{ clipPath: CLIP_SMALL }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  step = 1,
  min = 1,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
        {label}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="teyvat-input w-full px-3 py-2 text-sm"
        style={{ clipPath: CLIP_SMALL }}
      />
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
        {hint}
      </div>
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  hint: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-[12px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.92), rgba(var(--tj-accent-secondary),0.88))' }}>
        {label}
      </div>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="teyvat-input w-full px-3 py-2 text-sm leading-relaxed"
        style={{ clipPath: CLIP_SMALL }}
      />
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
        {hint}
      </div>
    </label>
  );
}

function uniqueModels(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
