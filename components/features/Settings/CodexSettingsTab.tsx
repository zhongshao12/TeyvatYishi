import { CLIP_CARD, CLIP_SMALL, CLIP_XS, gradientAccent, insetRing } from '@/styles/clipPaths';
import { useSavedFlash } from '@/hooks/useSavedFlash';
import { AI_PROVIDER_OPTIONS } from '@/data/aiProviderOptions';
﻿import type { ReactNode } from 'react';
import { useState } from 'react';
import type { AI提供商, API配置项, API设置, 游戏设置, 原著约束强度 } from '@/models/settings';
import { fetchModels } from '@/services/ai/apiTools';
import { saveSetting } from '@/services/dbService';

interface Props {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
  apiSettings: API设置;
}




const providerOptions = AI_PROVIDER_OPTIONS;

const constraintOptions: { value: 原著约束强度; label: string; desc: string }[] = [
  { value: 'loose', label: '宽松', desc: '只参考设定，不锁剧情' },
  { value: 'standard', label: '标准', desc: '关键设定不变，剧情可分支' },
  { value: 'strict', label: '严格', desc: '尽量贴近原著轨道' },
];

type ModelLookupConfigInput = Pick<API配置项, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'enableClaudeMode' | 'retryCount'>;

export function buildCodexModelLookupConfig(input: ModelLookupConfigInput): API配置项 {
  return { id: '__codex_override__', name: '图鉴', ...input, createdAt: 0, updatedAt: 0 };
}

type CodexPatch = Partial<Omit<游戏设置['图鉴系统'], 'api'>> & {
  api?: Partial<游戏设置['图鉴系统']['api']>;
};

export function CodexSettingsTab({ settings, onChange, apiSettings }: Props) {
  const codex = settings.图鉴系统;
  const mainConfig = apiSettings.configs.find((c) => c.id === apiSettings.activeConfigId) ?? null;
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetchMessage, setFetchMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const { savedFlash, showSavedFlash, clearSavedFlash } = useSavedFlash(1800);

  const patch = (partial: CodexPatch) => {
    onChange({
      ...settings,
      图鉴系统: {
        ...codex,
        ...partial,
        api: {
          ...codex.api,
          ...(partial.api ?? {}),
        },
      },
    });
  };

  const effective = {
    provider: codex.api.provider || mainConfig?.provider || 'openai_compatible',
    baseUrl: codex.api.baseUrl.trim() || mainConfig?.baseUrl || '',
    apiKey: codex.api.apiKey.trim() || mainConfig?.apiKey || '',
    model: codex.api.model.trim() || mainConfig?.model || '',
    enableClaudeMode: settings.enableClaudeMode === true,
  };

  const handleFetchModels = async () => {
    if (!effective.baseUrl || !effective.apiKey) {
      setFetchMessage({
        kind: 'error',
        text: mainConfig
          ? '图鉴当前使用主 API 回退；如主 API 也未配置，请先补全。'
          : '请先填写图鉴 API 的 Base URL 和 API Key，或先配置主 API。',
      });
      return;
    }
    setLoadingModels(true);
    setFetchMessage(null);
    try {
      const tempConfig = buildCodexModelLookupConfig({
        provider: effective.provider,
        baseUrl: effective.baseUrl,
        apiKey: effective.apiKey,
        model: effective.model,
        enableClaudeMode: effective.enableClaudeMode,
        retryCount: codex.api.retryCount ?? mainConfig?.retryCount ?? 2,
      });
      const list = await fetchModels(tempConfig);
      setModelOptions(list);
      setFetchMessage({ kind: 'info', text: '获取到 ' + list.length + ' 个模型' });
    } catch (err) {
      const text = (err as Error).message;
      setFetchMessage({ kind: 'error', text });
      window.alert(`图鉴获取模型失败：${text}`);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    setSaveMessage(null);
    try {
      await saveSetting('gameSettings', settings);
      showSavedFlash();
      setSaveMessage({ kind: 'info', text: '图鉴设置已保存。' });
    } catch (e) {
      clearSavedFlash();
      setSaveMessage({ kind: 'error', text: `保存失败：${(e as Error).message}` });
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
          图鉴
        </div>
        这是原著资料中枢的独立配置。后续它会为周报、剧情和其他系统提供摘要、检索和约束，不直接替代主剧情模型。
      </div>

      <Field label="启用图鉴">
        <ToggleRow
          label="启用图鉴"
          desc="关闭后，资料终端和联动检索都不会参与生成。"
          checked={codex.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
      </Field>

      <Field label="检索方式">
        <ToggleRow
          label="AI 主动补充"
          desc="默认关闭。关闭时只按正文关键词检索，不会额外调用 API；开启后 AI 只补充关键词漏项。"
          checked={codex.enableAiSupplement === true}
          onChange={(v) => patch({ enableAiSupplement: v })}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-3">
        {constraintOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => patch({ 原著约束: opt.value })}
            className="px-3 py-3 text-left transition-all"
            style={{
              background:
                codex.原著约束 === opt.value
                  ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.14), rgba(var(--tj-accent-primary), 0.03))'
                  : 'rgba(var(--tj-bg-secondary), 0.45)',
              boxShadow:
                codex.原著约束 === opt.value
                  ? insetRing(0.55)
                  : insetRing(0.16),
              clipPath: CLIP_SMALL,
            }}
          >
            <div className="font-serif text-sm tracking-[0.22em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
              {opt.label}
            </div>
            <div className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)' }}>
              {opt.desc}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="关键词资料上限">
          <input
            type="number"
            min={1}
            max={5}
            value={codex.maxRelatedEntries}
            onChange={(e) => patch({ maxRelatedEntries: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: CLIP_SMALL }}
          />
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
            仅控制关键词召回的非角色资料上限；角色档案关键词上限固定 15 条。开启 AI 主动补充后，AI 另可补充最多 8 条。
          </p>
        </Field>

        <Field label="导入后自动摘要">
          <ToggleRow
            label="自动压缩条目"
            desc="导入原著资料后，自动生成更短的检索摘要。"
            checked={codex.autoSummarizeOnImport}
            onChange={(v) => patch({ autoSummarizeOnImport: v })}
          />
        </Field>
      </div>

      <div
        className="px-4 py-4 space-y-3"
        style={{
          background: 'rgba(var(--tj-bg-secondary), 0.45)',
          boxShadow: insetRing(0.18),
          clipPath: CLIP_CARD,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
          <span className="font-serif text-[13px] font-semibold tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
            图鉴 API
          </span>
        </div>

        <Field label="服务商">
          <select
            value={codex.api.provider}
            onChange={(e) => patch({ api: { provider: e.target.value as AI提供商 } })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: CLIP_SMALL }}
          >
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Base URL">
          <input
            value={codex.api.baseUrl}
            onChange={(e) => patch({ api: { baseUrl: e.target.value } })}
            placeholder={mainConfig?.baseUrl ? `留空则使用主 API：${mainConfig.baseUrl}` : 'https://...'}
            className="teyvat-input w-full px-3 py-2 text-sm font-mono"
            style={{ clipPath: CLIP_SMALL }}
          />
        </Field>

        <Field label="API Key">
          <input
            type="password"
            value={codex.api.apiKey}
            onChange={(e) => patch({ api: { apiKey: e.target.value } })}
            placeholder={mainConfig?.apiKey ? '留空则使用主 API 的 Key' : 'sk-...'}
            className="teyvat-input w-full px-3 py-2 text-sm font-mono"
            style={{ clipPath: CLIP_SMALL }}
          />
        </Field>

        <Field label="模型">
          <div className="flex gap-1.5">
            <input
              value={codex.api.model}
              onChange={(e) => patch({ api: { model: e.target.value } })}
              placeholder={mainConfig?.model ? `留空则使用主 API：${mainConfig.model}` : '模型 ID'}
              className="teyvat-input flex-1 px-2.5 py-2 text-sm font-mono"
              style={{ clipPath: CLIP_SMALL }}
            />
            <button
              onClick={handleFetchModels}
              disabled={loadingModels}
              className="px-3 py-2 text-xs font-serif tracking-wider transition-all disabled:opacity-50"
              style={{
                color: 'rgba(var(--tj-accent-primary), 0.85)',
                boxShadow: insetRing(0.35),
                background: 'rgba(var(--tj-accent-primary), 0.05)',
                clipPath: CLIP_SMALL,
              }}
            >
              {loadingModels ? '获取中…' : '获取列表'}
            </button>
          </div>
          {modelOptions.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) patch({ api: { model: e.target.value } });
              }}
              className="teyvat-input mt-1.5 w-full px-2.5 py-1.5 text-xs"
              style={{ clipPath: CLIP_SMALL }}
            >
              <option value="">从列表选择（{modelOptions.length}）</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {fetchMessage && (
            <div
              className="mt-1.5 text-[11px]"
              style={{
                color: fetchMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.9)' : 'rgba(160, 200, 160, 0.8)',
              }}
            >
              {fetchMessage.text}
            </div>
          )}
        </Field>

        <Field label="失败重试次数">
          <input
            type="number"
            min={0}
            max={5}
            value={codex.api.retryCount ?? 2}
            onChange={(e) => patch({ api: { retryCount: Math.max(0, Number(e.target.value) || 0) } })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: CLIP_SMALL }}
          />
        </Field>

        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
          这里建议使用便宜、稳定、偏检索型的模型。图鉴负责整理和召回，不追求长篇文采。
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 pt-1">
        <button
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
          {savedFlash ? '✓ 已 保存' : '◆ 保存 配置'}
        </button>
        {saveMessage && (
          <div
            className="px-3 py-2 text-xs"
            style={{
              color: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.9)' : 'rgba(160, 200, 160, 0.85)',
              background: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.06)' : 'rgba(120, 200, 140, 0.06)',
              boxShadow:
                saveMessage.kind === 'error'
                  ? 'inset 0 0 0 1px rgba(220, 120, 120, 0.25)'
                  : 'inset 0 0 0 1px rgba(120, 200, 140, 0.25)',
              clipPath: CLIP_SMALL,
            }}
          >
            {saveMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 block text-xs font-serif tracking-[0.2em]" style={{ color: 'rgba(var(--tj-accent-primary), 0.85)' }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        background: 'rgba(var(--tj-bg-secondary), 0.45)',
        boxShadow: insetRing(0.15),
        clipPath: CLIP_SMALL,
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
