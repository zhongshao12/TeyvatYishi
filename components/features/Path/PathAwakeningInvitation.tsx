import { insetRing } from '@/styles/clipPaths';
import type { 世界状态 } from '@/models/world';
import type { ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';

interface Props {
  world: 世界状态;
  setWorld: React.Dispatch<React.SetStateAction<世界状态>>;
  onTrigger: () => void;
  disabled?: boolean;
}

export function PathAwakeningInvitation({ world, setWorld, onTrigger, disabled }: Props) {
  const element = world.元素回响邀请;
  if (!element) return null;

  return (
    <div className="mx-3 mb-2 p-4" style={{ background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.08), rgba(140,100,60,0.10))', boxShadow: insetRing(0.45) }}>
      <div className="mb-2 text-xs tracking-[0.4em]" style={{ color: 'rgba(var(--tj-accent-primary),0.7)' }}>元 素 回 响 之 邀</div>
      <div className="mb-1 font-serif text-base" style={{ color: 'rgba(var(--tj-text-primary),0.95)' }}>「{ELEMENT_NAMES[element]}」的回响正在靠近</div>
      <p className="mb-3 text-sm leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary),0.8)' }}>
        踏入后，下一回合会暂缓主剧情，在心像空间中回应三道问题。完成回响会深化对应元素的熟练度。
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={disabled} onClick={onTrigger} className="teyvat-btn teyvat-btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-40">踏入回响</button>
        <button type="button" disabled={disabled} onClick={() => setWorld((current) => ({ ...current, 元素回响邀请: undefined }))} className="teyvat-btn px-4 py-2 text-sm disabled:opacity-40">暂缓</button>
      </div>
    </div>
  );
}
