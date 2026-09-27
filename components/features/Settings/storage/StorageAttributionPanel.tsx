import { useState } from 'react';
import { scanStorageAttribution } from '@/services/storage/storageAttributionScan';
import type { StorageAttribution } from '@/utils/storageAttribution';
import { formatByteSize } from '@/utils/formatByteSize';

interface Props {
  saves: ReadonlyArray<{ id: number; sizeBytes: number }>;
  scan?: typeof scanStorageAttribution;
}

export function StorageAttributionPanel({ saves, scan = scanStorageAttribution }: Props) {
  const [report, setReport] = useState<StorageAttribution | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setReport(await scan(saves));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取存储索引失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded border border-[rgb(var(--tj-arcane-accent))]/20 px-3 py-2 text-xs text-[rgb(var(--tj-text-primary))]/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>存储归属分析（浏览器 IndexedDB）</span>
        <button type="button" disabled={busy} onClick={() => void run()} className="rounded border border-[rgb(var(--tj-arcane-accent))]/40 px-3 py-1 disabled:opacity-50">
          {busy ? '分析中…' : '分析存储'}
        </button>
      </div>
      {error && <p role="alert">分析失败：{error}</p>}
      {report && (
        <div className="grid gap-1 sm:grid-cols-2">
          <span>存档节点估算合计：{formatByteSize(report.nodeEstimateBytes)}</span>
          <span>增量节点：{report.deltaNodeCount} 个</span>
          <span>图片资源去重估算：{formatByteSize(report.uniqueAssetBytes)}（{report.assetCount} 项）</span>
          <span>其中共享图片：{formatByteSize(report.sharedAssetBytes)}</span>
          <span>索引未找到引用的图片：{formatByteSize(report.unreferencedAssetBytes)}（不代表可安全删除）</span>
          <p className="sm:col-span-2 opacity-70">各存档体积原本可能包含图片与重建后的增量内容；以上估算不可相加，也不等于浏览器实际占用。桌面镜像文件未计入。</p>
        </div>
      )}
    </div>
  );
}
