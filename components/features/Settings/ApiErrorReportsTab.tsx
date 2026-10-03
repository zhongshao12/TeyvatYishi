import { CLIP_SMALL } from '@/styles/clipPaths';
import { ConfirmDialogHost, useConfirmDialog } from '@/components/ui/Modal';
import { useEffect, useMemo, useState } from 'react';
import {
  clearApiErrorReports,
  loadApiErrorReports,
  sanitizeApiErrorReportFields,
  type ApiErrorReport,
} from '@/services/ai/apiErrorReportService';



function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * 展示与复制出口。报告可以被整份复制出去，因此这里再脱敏一次：
 * 即使某份报告来自旧版本（落盘时还没脱敏）或别处的原始对象，
 * 复制/渲染出来的内容也不会带出 Key。
 */
export function formatReport(report: ApiErrorReport): string {
  const safe = sanitizeApiErrorReportFields(report);
  return [
    `时间: ${formatTime(safe.createdAt)}`,
    `模块: ${safe.source}`,
    `供应商: ${safe.provider || '-'}`,
    `模型: ${safe.model || '-'}`,
    `Base URL: ${safe.baseUrl || '-'}`,
    `API Key: ${safe.apiKeyHint || '-'}`,
    `状态码: ${safe.status ?? '-'}`,
    `请求模式: ${safe.requestMode || '-'}`,
    `请求地址: ${safe.requestUrl || '-'}`,
    '',
    '错误信息:',
    safe.message || '-',
    safe.responseText ? `\n原始响应:\n${safe.responseText}` : '',
  ].filter(Boolean).join('\n');
}

export function ApiErrorReportsTab() {
  const [reports, setReports] = useState<ApiErrorReport[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [message, setMessage] = useState('');
  const confirmDialog = useConfirmDialog();
  const askConfirm = confirmDialog.confirm;

  const refresh = async () => {
    const list = await loadApiErrorReports();
    setReports(list);
    setSelectedId((current) => (current && list.some((item) => item.id === current) ? current : list[0]?.id ?? ''));
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selected = useMemo(
    () => reports.find((item) => item.id === selectedId) ?? reports[0] ?? null,
    [reports, selectedId],
  );

  const handleClear = async () => {
    if (!await askConfirm({
      title: '清空 API 错误报告',
      message: '确定清空所有 API 错误报告吗？此操作不可恢复。',
      confirmLabel: '清空',
      tone: 'danger',
    })) return;
    await clearApiErrorReports();
    setReports([]);
    setSelectedId('');
    setMessage('错误报告已清空。');
  };

  const handleCopy = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(formatReport(selected));
    setMessage('已复制当前错误报告。');
  };

  return (
    <div className="space-y-4">
      <div>
        <h2
          className="font-serif text-xl font-bold tracking-[0.18em]"
          style={{ color: 'rgb(var(--tj-text-primary))' }}
        >
          API 错误报告
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
          当主剧情、手机消息、连接测试或模型列表请求失败时，系统会在这里记录供应商、模型、Base URL、状态码和原始错误，方便定位真实原因。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void refresh()} className="teyvat-btn teyvat-btn-secondary px-4 py-2 text-xs">
          刷新
        </button>
        <button onClick={() => void handleCopy()} disabled={!selected} className="teyvat-btn teyvat-btn-secondary px-4 py-2 text-xs disabled:opacity-50">
          复制当前报告
        </button>
        <button onClick={() => void handleClear()} disabled={!reports.length} className="teyvat-btn teyvat-btn-secondary px-4 py-2 text-xs disabled:opacity-50">
          清空报告
        </button>
      </div>

      {message && <div className="text-xs" style={{ color: 'rgba(160, 200, 160, 0.85)' }}>{message}</div>}

      {reports.length === 0 ? (
        <div className="p-4 text-sm" style={{ color: 'rgba(var(--tj-text-secondary), 0.7)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.55)', clipPath: CLIP_SMALL }}>
          暂无 API 错误报告。
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {reports.map((report) => (
              <button
                key={report.id}
                onClick={() => setSelectedId(report.id)}
                className="w-full p-3 text-left text-xs transition-all hover:opacity-90"
                style={{
                  color: 'rgba(var(--tj-text-primary), 0.88)',
                  background: report.id === selected?.id ? 'rgba(var(--tj-accent-primary), 0.12)' : 'rgba(var(--tj-bg-secondary), 0.42)',
                  boxShadow: `inset 0 0 0 1px ${report.id === selected?.id ? 'rgba(var(--tj-accent-primary), 0.45)' : 'rgba(var(--tj-border), 0.38)'}`,
                  clipPath: CLIP_SMALL,
                }}
              >
                <div className="truncate font-serif tracking-[0.12em]">{report.source}</div>
                <div className="mt-1 truncate" style={{ color: 'rgba(var(--tj-text-secondary), 0.72)' }}>
                  {report.provider || '-'} / {report.model || '-'}
                </div>
                <div className="mt-1" style={{ color: 'rgba(var(--tj-text-secondary), 0.58)' }}>
                  {formatTime(report.createdAt)}
                </div>
              </button>
            ))}
          </div>

          <pre
            className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed"
            style={{
              color: 'rgba(var(--tj-text-primary), 0.86)',
              background: 'rgba(var(--tj-bg-secondary), 0.46)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.42)',
              clipPath: CLIP_SMALL,
            }}
          >
            {selected ? formatReport(selected) : ''}
          </pre>
        </div>
      )}
      <ConfirmDialogHost dialog={confirmDialog} />
    </div>
  );
}
