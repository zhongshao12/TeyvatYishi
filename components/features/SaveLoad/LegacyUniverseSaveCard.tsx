import { useState } from 'react';
import type { MigrationReport } from '@/compat/legacy-hsr/migrate';

interface Props {
  report?: MigrationReport;
  onExport: () => Promise<void> | void;
}

export function LegacyUniverseSaveCard({ report, onExport }: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      await onExport();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '原档导出失败，请重试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section
      aria-labelledby="legacy-save-title"
      className="mx-4 mb-4 max-w-3xl self-center border px-4 py-5 font-serif md:px-6"
      style={{ background: '#f4ead1', borderColor: '#9a7747', boxShadow: '4px 5px 0 rgba(89, 58, 30, 0.16)', color: '#38291e' }}
    >
      <p className="text-xs tracking-[0.22em]" style={{ color: '#806237' }}>封存档案 · READ ONLY</p>
      <h3 id="legacy-save-title" className="mt-1 text-xl font-bold tracking-[0.12em]">旧宇宙存档</h3>
      <p className="mt-3 text-sm leading-6">
        这份档案属于当前世界之外的旧宇宙。为保护原始内容，本页只提供只读查看与原档导出，不能迁移、确认或写入当前存档库。
      </p>
      {report && (
        <dl className="mt-4 grid gap-1 border-y py-3 text-xs leading-5" style={{ borderColor: 'rgba(128, 98, 55, 0.45)' }}>
          <div><dt className="inline font-semibold">识别来源：</dt><dd className="inline">{report.sourceUniverse}</dd></div>
          <div><dt className="inline font-semibold">迁移报告：</dt><dd className="inline">{report.appliedMappings.length} 项确定映射，{report.issues.length} 项待确认。</dd></div>
        </dl>
      )}
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={exporting}
        className="mt-5 min-h-11 border px-4 text-sm font-semibold tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: '#2c7068', color: '#185952', background: '#e5f0df' }}
      >
        {exporting ? '导出中…' : '导出原档'}
      </button>
      <p className="mt-3 text-xs" style={{ color: '#745e43' }}>只读查看：不会修改、转换或写入此旧宇宙存档。</p>
      <p aria-live="polite" className="mt-2 text-sm" style={{ color: '#9f3530' }}>{error}</p>
    </section>
  );
}
