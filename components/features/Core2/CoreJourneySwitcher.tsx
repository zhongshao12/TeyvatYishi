import { useEffect, useRef, useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreRepository, JourneyEntry } from '@/core/contracts/storage';
import { CoreOpeningForm } from './CoreOpeningForm';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

export function CoreJourneySwitcher({ controller, repo, disabled, hasJourney }: { controller: CoreController; repo: CoreRepository; disabled: boolean; hasJourney: boolean }) {
  const [open, setOpen] = useState(false), [creating, setCreating] = useState(false), [rows, setRows] = useState<JourneyEntry[]>([]), [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const load = async (next?: string) => {
    if (busy || disabled) return; const token = ++generation.current; setBusy(true); setError('');
    try { const page = await repo.queryJourneys({ limit: 50, ...(next ? { cursor: next } : {}) }); if (token === generation.current) { setRows(before => next ? [...before, ...page.items] : page.items); setCursor(page.nextCursor); } }
    catch (failure) { if (token === generation.current) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const choose = async (row: JourneyEntry) => {
    if (busy || disabled) return; const token = ++generation.current; setBusy(true); setError('');
    try { await controller.attach({ scope: row.scope }); if (token === generation.current) setOpen(false); }
    catch (failure) { if (token === generation.current) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (token === generation.current) setBusy(false); }
  };
  return <section className="core2-card" aria-label="旅程选择"><button disabled={disabled || busy} onClick={() => { setOpen(true); void load(); }}>选择旅程</button>
    {hasJourney && <button disabled={disabled || busy} onClick={() => { setCreating(true); setOpen(false); }}>开始新旅程</button>}
    {open && <div><h2>已保存的旅程与分支</h2><p>同名旅人也按独立编号区分；选择只切换记录，不会合并背包、人物或记忆。</p>
      {rows.map(row => <button key={`${row.scope.journeyId}:${row.scope.branchId}`} data-journey-id={row.scope.journeyId} disabled={disabled || busy} onClick={() => void choose(row)}>{row.name} · 旅程 {row.scope.journeyId} · {row.parentBranchId ? '分支' : '起始线'} {row.scope.branchId} · 第 {row.turn} 回合</button>)}
      {!busy && !rows.length && !error && <p>还没有独立新内核旅程。</p>}{cursor && <button disabled={disabled || busy} onClick={() => void load(cursor)}>更多旅程</button>}<button disabled={busy} onClick={() => setOpen(false)}>关闭选择</button>
    </div>}
    {creating && <div><button disabled={busy} onClick={() => setCreating(false)}>取消新建</button><CoreOpeningForm onStart={async seed => { await controller.initialize(seed); setCreating(false); }} /></div>}
    {busy && <p role="status">正在读取旅程……</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
