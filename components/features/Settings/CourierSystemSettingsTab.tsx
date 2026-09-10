import { useState } from 'react';
import type { AI提供商, API配置项, API设置, 游戏设置 } from '@/models/settings';
import { fetchModels } from '@/services/ai/apiTools';
import { saveSetting } from '@/services/dbService';

interface Props {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
  apiSettings: API设置;
}

const smallClip =
  'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';
const cardClip =
  'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)';

const providerOptions: { value: AI提供商; label: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI 兼容' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'baidu', label: '百度千帆' },
  { value: 'opencode', label: 'OpenCode Zen' },
  { value: 'mimo', label: '小米 MiMo' },
  { value: 'ark', label: '火山方舟' },
  { value: 'claude', label: 'Claude' },
  { value: 'claude_compatible', label: 'Claude 兼容' },
  { value: 'gemini', label: 'Gemini' },
];

type ModelLookupConfigInput = Pick<API配置项, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'enableClaudeMode' | 'retryCount'>;

export function buildCourierModelLookupConfig(input: ModelLookupConfigInput): API配置项 {
  return { id: '__courier_override__', name: '手机消息', ...input, createdAt: 0, updatedAt: 0 };
}

export function CourierSystemSettingsTab({ settings, onChange, apiSettings }: Props) {
  const courier = settings.手机系统;
  const mainConfig = apiSettings.configs.find((c) => c.id === apiSettings.activeConfigId) ?? apiSettings.configs[0] ?? null;
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  type CourierPatch = Partial<Omit<typeof courier, 'api'>> & { api?: Partial<typeof courier.api> };

  const patch = (patch: CourierPatch) => {
    onChange({
      ...settings,
      手机系统: {
        ...courier,
        ...patch,
        api: {
          ...courier.api,
          ...(patch.api ?? {}),
        },
      },
    });
  };

  const effectiveApi = {
    provider: courier.api.provider || mainConfig?.provider || 'openai_compatible',
    baseUrl: courier.api.baseUrl.trim() || mainConfig?.baseUrl || '',
    apiKey: courier.api.apiKey.trim() || mainConfig?.apiKey || '',
    model: courier.api.model.trim() || mainConfig?.model || '',
    enableClaudeMode: settings.enableClaudeMode === true,
  };

  const handleFetchModels = async () => {
    if (!effectiveApi.baseUrl || !effectiveApi.apiKey) {
      setFetchMessage({ kind: 'error', text: '请填写手机消息 API，或先配置主 API 作为回退。' });
      return;
    }
    setLoadingModels(true);
    setFetchMessage(null);
    try {
      const tempConfig = buildCourierModelLookupConfig({
        provider: effectiveApi.provider,
        baseUrl: effectiveApi.baseUrl,
        apiKey: effectiveApi.apiKey,
        model: effectiveApi.model,
        enableClaudeMode: effectiveApi.enableClaudeMode,
        retryCount: courier.api.retryCount ?? mainConfig?.retryCount ?? 2,
      });
      const list = await fetchModels(tempConfig);
      setModelOptions(list);
      setFetchMessage({ kind: 'info', text: `获取到 ${list.length} 个模型` });
    } catch (err) {
      const text = (err as Error).message;
      setFetchMessage({ kind: 'error', text });
      window.alert(`手机消息获取模型失败：${text}`);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    setSaveMessage(null);
    try {
      await saveSetting('gameSettings', settings);
      setSavedFlash(true);
      setSaveMessage({ kind: 'info', text: '手机设置已保存。' });
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch (err) {
      setSavedFlash(false);
      setSaveMessage({ kind: 'error', text: `保存失败：${(err as Error).message}` });
    }
  };

  return (
    <div className="space-y-5">
      <div
        className="px-4 py-3 text-xs leading-relaxed"
        style={{
          color: 'rgba(var(--tj-text-secondary), 0.78)',
          background: 'rgba(var(--tj-accent-primary), 0.05)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.15)',
          clipPath: cardClip,
        }}
      >
        <div className="mb-1 font-serif text-[13px] tracking-[0.18em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))' }}>
          手机消息
        </div>
        手机消息独立于主剧情模型，用于私聊、群聊和同伴主动联系。每次生成都会读取人物性格、关系账本、同行记忆和近期对话，并可使用单独 API。
      </div>

      <ToggleRow
        label="启用手机消息"
        desc="关闭后，手机入口仍可查看聊天记录，但不会生成新消息。"
        checked={courier.enabled}
        onChange={(v) => patch({ enabled: v })}
      />

      <ToggleRow
        label="自动生成同伴主动消息"
        desc="开启后，变量模型可根据主剧情事件创建消息契机；手机系统会优先处理重要消息。"
        checked={courier.autoGenerateSeeds}
        onChange={(v) => patch({ autoGenerateSeeds: v })}
      />

      <Field label="每回合最多主动消息">
        <input
          type="number"
          min={0}
          max={5}
          value={courier.maxSeedsPerTurn}
          onChange={(e) => patch({ maxSeedsPerTurn: Number(e.target.value) })}
          className="teyvat-input w-full px-3 py-2 text-sm"
          style={{ clipPath: smallClip }}
        />
      </Field>

      <Field label="同一联系人冷却回合">
        <input
          type="number"
          min={0}
          max={12}
          value={courier.contactCooldownTurns}
          onChange={(e) => patch({ contactCooldownTurns: Number(e.target.value) })}
          className="teyvat-input w-full px-3 py-2 text-sm"
          style={{ clipPath: smallClip }}
        />
      </Field>

      <Field label="同一群聊冷却回合">
        <input
          type="number"
          min={0}
          max={12}
          value={courier.groupCooldownTurns}
          onChange={(e) => patch({ groupCooldownTurns: Number(e.target.value) })}
          className="teyvat-input w-full px-3 py-2 text-sm"
          style={{ clipPath: smallClip }}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="私聊本地压缩阈值">
          <input
            type="number"
            min={3}
            max={30}
            value={courier.privateArchiveThreshold}
            onChange={(e) => patch({ privateArchiveThreshold: Number(e.target.value) })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: smallClip }}
          />
        </Field>

        <Field label="群聊本地压缩阈值">
          <input
            type="number"
            min={6}
            max={40}
            value={courier.groupArchiveThreshold}
            onChange={(e) => patch({ groupArchiveThreshold: Number(e.target.value) })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: smallClip }}
          />
        </Field>
      </div>

      <div
        className="space-y-3 px-4 py-4"
        style={{
          background: 'rgba(var(--tj-bg-secondary), 0.45)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.18)',
          clipPath: cardClip,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
          <span className="font-serif text-[13px] font-semibold tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
            手机消息 API
          </span>
        </div>

        <Field label="服务商">
          <select
            value={courier.api.provider}
            onChange={(e) => patch({ api: { provider: e.target.value as AI提供商 } })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: smallClip }}
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
            value={courier.api.baseUrl}
            onChange={(e) => patch({ api: { baseUrl: e.target.value } })}
            placeholder={mainConfig?.baseUrl ? `留空则使用主 API：${mainConfig.baseUrl}` : 'https://...'}
            className="teyvat-input w-full px-3 py-2 text-sm font-mono"
            style={{ clipPath: smallClip }}
          />
        </Field>

        <Field label="API Key">
          <input
            type="password"
            value={courier.api.apiKey}
            onChange={(e) => patch({ api: { apiKey: e.target.value } })}
            placeholder={mainConfig?.apiKey ? '留空则使用主 API 的 Key' : 'sk-...'}
            className="teyvat-input w-full px-3 py-2 text-sm font-mono"
            style={{ clipPath: smallClip }}
          />
        </Field>

        <Field label="模型">
          <div className="flex gap-1.5">
            <input
              value={courier.api.model}
              onChange={(e) => patch({ api: { model: e.target.value } })}
              placeholder={mainConfig?.model ? `留空则使用主 API：${mainConfig.model}` : '模型 ID'}
              className="teyvat-input flex-1 px-2.5 py-2 text-sm font-mono"
              style={{ clipPath: smallClip }}
            />
            <button
              type="button"
              onClick={handleFetchModels}
              disabled={loadingModels}
              className="px-3 py-2 text-xs font-serif tracking-wider transition-all disabled:opacity-50"
              style={{
                color: 'rgba(var(--tj-accent-primary), 0.85)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.35)',
                background: 'rgba(var(--tj-accent-primary), 0.05)',
                clipPath: smallClip,
              }}
            >
              {loadingModels ? '获取中...' : '获取列表'}
            </button>
          </div>
          {modelOptions.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) patch({ api: { model: e.target.value } });
              }}
              className="teyvat-input mt-1.5 w-full px-2.5 py-1.5 text-xs"
              style={{ clipPath: smallClip }}
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
            value={courier.api.retryCount ?? 2}
            onChange={(e) => patch({ api: { retryCount: Math.max(0, Number(e.target.value) || 0) } })}
            className="teyvat-input w-full px-3 py-2 text-sm"
            style={{ clipPath: smallClip }}
          />
        </Field>

        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.68)' }}>
          字段留空时会回退主 API，方便用主模型先跑通；后续可以改成更便宜的通讯模型。
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="w-full py-3 text-sm font-serif tracking-[0.4em] transition-all hover:opacity-90"
          style={{
            background: savedFlash
              ? 'linear-gradient(135deg, rgba(140, 220, 160, 0.95), rgba(100, 180, 130, 0.95))'
              : 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start), 0.96), rgba(var(--tj-btn-primary-end), 0.84))',
            color: 'rgb(var(--tj-on-accent))',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.72), 0 0 18px rgba(var(--tj-arcane-accent), 0.14)',
            clipPath: cardClip,
          }}
        >
          {savedFlash ? '✓ 已 保 存' : '◆ 保 存 配 置'}
        </button>
        {saveMessage && (
          <div
            className="px-3 py-2 text-xs"
            style={{
              color: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.9)' : 'rgba(160, 200, 160, 0.85)',
              background: saveMessage.kind === 'error' ? 'rgba(220, 120, 120, 0.06)' : 'rgba(120, 200, 140, 0.06)',
              boxShadow: saveMessage.kind === 'error'
                ? 'inset 0 0 0 1px rgba(220, 120, 120, 0.25)'
                : 'inset 0 0 0 1px rgba(120, 200, 140, 0.25)',
              clipPath: smallClip,
            }}
          >
            {saveMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 font-serif text-xs tracking-[0.22em]" style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.86), rgba(var(--tj-accent-secondary),0.82))' }}>
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
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.15)',
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
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
            ? 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start), 0.95), rgba(var(--tj-btn-primary-end), 0.86))'
            : 'rgba(var(--tj-bg-secondary), 0.68)',
          boxShadow: checked
            ? 'inset 0 0 0 1px rgba(var(--tj-text-primary), 0.5), 0 0 10px rgba(var(--tj-accent-primary), 0.25)'
            : 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.2)',
          clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
        }}
      >
        <div
          className="absolute top-0.5 h-5 w-5 transition-transform"
          style={{
            left: checked ? 'calc(100% - 1.375rem)' : '0.125rem',
            background: checked ? 'rgb(var(--tj-bg-primary))' : 'rgba(var(--tj-text-secondary), 0.78)',
            clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
          }}
        />
      </button>
    </div>
  );
}
