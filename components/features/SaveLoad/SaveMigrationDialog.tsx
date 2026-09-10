import { useEffect, useMemo, useRef, useState } from 'react';
import type { MigrationIssue, MigrationReport } from '@/compat/legacy-hsr/migrate';
import { ELEMENT_IDS, type ElementId, type ItemRarity } from '@/models/teyvat';
import { ELEMENT_NAMES as elementLabels } from '@/styles/elementTokens';

export type MigrationChoice = Record<string, ElementId | ItemRarity>;

interface Props {
  issues: MigrationIssue[];
  report: MigrationReport;
  sourceBackupId?: string;
  backupError?: string;
  initialChoices?: MigrationChoice;
  onConfirm: (choices: MigrationChoice) => Promise<void> | void;
  onCancel: () => void;
}

export function SaveMigrationDialog({ issues, report, sourceBackupId, backupError, initialChoices, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const [choices, setChoices] = useState<MigrationChoice>(() => initialChoices ?? {});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const canConfirm = Boolean(sourceBackupId) && issues.every((issue) => choices[issue.path] !== undefined) && !confirming;
  const reportSummary = useMemo(
    () => `${report.appliedMappings.length} 项确定映射；${report.issues.length} 项需要你的选择。`,
    [report],
  );

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setConfirming(true);
    setError('');
    try {
      await onConfirm(choices);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '迁移写入失败，原档备份仍可保留。');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="migration-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !confirming) onCancel();
      }}
      className="mx-3 my-4 max-h-[85dvh] w-auto max-w-3xl self-center overflow-y-auto border p-4 font-serif md:mx-6 md:p-6"
      style={{ background: '#f7efd9', borderColor: '#8d6b3b', boxShadow: '6px 7px 0 rgba(83, 54, 27, 0.18)', color: '#35281d' }}
    >
      <p className="text-xs tracking-[0.22em]" style={{ color: '#806237' }}>迁移预览 · 需手动确认</p>
      <h3 id="migration-title" className="mt-1 text-xl font-bold tracking-[0.1em]">补全提瓦特存档</h3>
      <p className="mt-2 text-sm leading-6">下列字段没有确定等价值，必须逐项选择。确认前不会写入当前存档库。</p>

      <div className="mt-4 border-y py-3 text-sm leading-6" style={{ borderColor: 'rgba(128, 98, 55, 0.45)' }}>
        <p><span className="font-semibold">来源备份标识：</span>{sourceBackupId ?? '备份尚未完成，不能确认迁移。'}</p>
        <p><span className="font-semibold">MigrationReport：</span>{reportSummary}</p>
        {report.appliedMappings.length > 0 && <p className="text-xs" style={{ color: '#745e43' }}>已确定映射：{report.appliedMappings.map((mapping) => `${mapping.from} → ${mapping.to}`).join('；')}</p>}
      </div>
      {backupError && <p role="alert" className="mt-3 text-sm" style={{ color: '#9f3530' }}>备份失败：{backupError}</p>}

      <fieldset className="mt-4 space-y-4" disabled={confirming}>
        <legend className="text-sm font-semibold">需要补全的字段</legend>
        {issues.length === 0 && <p className="text-sm" style={{ color: '#745e43' }}>没有未决字段；请核对上方备份标识与迁移报告后确认。</p>}
        {issues.map((issue, index) => {
          const isElement = issue.code === 'UNRESOLVED_ELEMENT';
          return (
            <div key={`${issue.path}-${index}`} className="border-l-2 pl-3" style={{ borderColor: isElement ? '#2c7068' : '#a67532' }}>
              <label htmlFor={`migration-choice-${index}`} className="block text-sm font-semibold">
                {isElement ? '选择初始元素' : '选择物品稀有度'} · {issue.path}
              </label>
              <p className="mt-1 text-xs leading-5" style={{ color: '#745e43' }}>{issue.message || `原值：${String(issue.value ?? '空')}`}</p>
              <select
                id={`migration-choice-${index}`}
                value={choices[issue.path] ?? ''}
                onChange={(event) => setChoices((current) => ({
                  ...current,
                  [issue.path]: isElement ? event.target.value as ElementId : Number(event.target.value) as ItemRarity,
                }))}
                className="mt-2 min-h-10 max-w-full border bg-[#fff9e9] px-2 text-sm"
                style={{ borderColor: '#9a7747', color: '#35281d' }}
              >
                <option value="">请选择</option>
                {isElement
                  ? ELEMENT_IDS.map((element) => <option key={element} value={element}>{elementLabels[element]}元素</option>)
                  : ([1, 2, 3, 4, 5] as ItemRarity[]).map((rarity) => <option key={rarity} value={rarity}>{rarity} 星</option>)}
              </select>
            </div>
          );
        })}
      </fieldset>

      <p aria-live="polite" className="mt-4 text-sm" style={{ color: '#9f3530' }}>{error}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onCancel} disabled={confirming} className="min-h-11 border px-4 text-sm disabled:opacity-50" style={{ borderColor: '#806237', color: '#5b452d' }}>返回</button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={!canConfirm}
          className="min-h-11 border px-4 text-sm font-semibold tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: '#2c7068', color: '#f7efd9', background: '#21645d' }}
        >
          {confirming ? '写入中…' : '确认迁移并写入'}
        </button>
      </div>
    </section>
  );
}
