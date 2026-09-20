import { useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { CLIP_MEDIUM } from '@/styles/clipPaths';

export function JourneyLaunchOverlay() {
  const starSeeds = useMemo(
    () => Array.from({ length: 34 }, (_, index) => ({
      id: index,
      x: 8 + ((index * 17) % 84),
      y: 10 + ((index * 29) % 78),
      delay: (index % 8) * 0.045,
      size: 1 + (index % 4) * 0.42,
    })),
    [],
  );

  return (
    <div className="teyvat-journey-launch" role="status" aria-live="polite" aria-label="旅途已接入">
      <div className="teyvat-journey-launch__field" />
      <div className="teyvat-journey-launch__vignette" />
      {starSeeds.map((star) => (
        <span key={star.id} className="teyvat-journey-launch__star" style={{ left: `${star.x}%`, top: `${star.y}%`, width: `${star.size}px`, height: `${star.size}px`, animationDelay: `${star.delay}s` }} />
      ))}
      <div className="teyvat-journey-launch__rail teyvat-journey-launch__rail--a" />
      <div className="teyvat-journey-launch__rail teyvat-journey-launch__rail--b" />
      <div className="teyvat-journey-launch__rail teyvat-journey-launch__rail--c" />
      <div className="teyvat-journey-launch__rail teyvat-journey-launch__rail--d" />
      <div className="teyvat-journey-launch__core">
        <div className="teyvat-journey-launch__ring" />
        <div className="teyvat-journey-launch__glyph" aria-hidden="true">
          <span className="teyvat-journey-launch__starburst teyvat-journey-launch__starburst--main" />
          <span className="teyvat-journey-launch__starburst teyvat-journey-launch__starburst--cross" />
          <span className="teyvat-journey-launch__starburst-core" />
        </div>
        <div className="teyvat-journey-launch__title">旅途已接入</div>
        <div className="teyvat-journey-launch__subtitle">正在辨认旅途方向</div>
      </div>
      <div className="teyvat-journey-launch__flash" />
    </div>
  );
}

export function HomeJourneyOverlay() {
  const glints = useMemo(
    () => Array.from({ length: 18 }, (_, index) => ({
      id: index,
      x: 10 + ((index * 23) % 80),
      y: 14 + ((index * 31) % 70),
      delay: (index % 6) * 0.055,
      drift: index % 2 === 0 ? -1 : 1,
    })),
    [],
  );

  return (
    <div className="teyvat-home-journey" role="status" aria-live="polite" aria-label="旅途入口开启中">
      <div className="teyvat-home-journey__backdrop" />
      <div className="teyvat-home-journey__tracks" />
      {glints.map((glint) => (
        <span key={glint.id} className="teyvat-home-journey__glint" style={{ left: `${glint.x}%`, top: `${glint.y}%`, animationDelay: `${glint.delay}s`, ['--glint-drift' as string]: glint.drift }} />
      ))}
      <div className="teyvat-home-journey__door teyvat-home-journey__door--left" />
      <div className="teyvat-home-journey__door teyvat-home-journey__door--right" />
      <div className="teyvat-home-journey__threshold">
        <div className="teyvat-home-journey__seal">启</div>
        <div className="teyvat-home-journey__title">旅途入口已开启</div>
        <div className="teyvat-home-journey__subtitle">正在翻开冒险手账</div>
      </div>
      <div className="teyvat-home-journey__wipe" />
    </div>
  );
}

export function SaveLoadOverlay() {
  const dataNodes = useMemo(
    () => Array.from({ length: 24 }, (_, index) => ({
      id: index,
      x: 8 + ((index * 19) % 84),
      y: 12 + ((index * 37) % 74),
      delay: (index % 8) * 0.045,
      size: 2 + (index % 3),
    })),
    [],
  );

  return (
    <div className="teyvat-save-load" role="status" aria-live="polite" aria-label="存档读取中">
      <div className="teyvat-save-load__backdrop" />
      <div className="teyvat-save-load__grid" />
      {dataNodes.map((node) => (
        <span key={node.id} className="teyvat-save-load__node" style={{ left: `${node.x}%`, top: `${node.y}%`, width: `${node.size}px`, height: `${node.size}px`, animationDelay: `${node.delay}s` }} />
      ))}
      <div className="teyvat-save-load__archive">
        <div className="teyvat-save-load__frame" />
        <div className="teyvat-save-load__seal">档</div>
        <div className="teyvat-save-load__title">存档索引已唤醒</div>
        <div className="teyvat-save-load__subtitle">正在整理旅途足迹</div>
        <div className="teyvat-save-load__bar"><span /></div>
      </div>
      <div className="teyvat-save-load__scan teyvat-save-load__scan--a" />
      <div className="teyvat-save-load__scan teyvat-save-load__scan--b" />
    </div>
  );
}

export function BookOpenOverlay() {
  const motes = useMemo(
    () => Array.from({ length: 22 }, (_, index) => ({
      id: index,
      x: 12 + ((index * 21) % 76),
      y: 18 + ((index * 29) % 62),
      delay: (index % 7) * 0.05,
      drift: index % 2 === 0 ? -1 : 1,
    })),
    [],
  );

  return (
    <div className="teyvat-book-open" role="status" aria-live="polite" aria-label="书页展开中">
      <div className="teyvat-book-open__backdrop" />
      {motes.map((mote) => (
        <span key={mote.id} className="teyvat-book-open__mote" style={{ left: `${mote.x}%`, top: `${mote.y}%`, animationDelay: `${mote.delay}s`, ['--book-mote-drift' as string]: mote.drift }} />
      ))}
      <div className="teyvat-book-open__book">
        <div className="teyvat-book-open__spine" />
        <div className="teyvat-book-open__page teyvat-book-open__page--left"><span /><span /><span /></div>
        <div className="teyvat-book-open__page teyvat-book-open__page--right"><span /><span /><span /></div>
        <div className="teyvat-book-open__leaf teyvat-book-open__leaf--a" />
        <div className="teyvat-book-open__leaf teyvat-book-open__leaf--b" />
      </div>
      <div className="teyvat-book-open__copy">
        <div className="teyvat-book-open__title">提瓦特之书</div>
        <div className="teyvat-book-open__subtitle">正在翻开未署名的页</div>
      </div>
      <div className="teyvat-book-open__glow" />
    </div>
  );
}

export function MysteryChatModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="神秘聊天" className="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-sm px-4 py-4 text-sm leading-7" style={{ background: 'rgba(var(--tj-bg-primary), 0.34)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.7)' }}>
          <div className="font-serif text-base tracking-[0.18em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>960494342</div>
          <p className="mt-3" style={{ color: 'rgba(var(--tj-text-primary), 0.88)' }}>本群只进行内部交流与聊天，禁止对外宣传。</p>
        </div>
        <button type="button" onClick={onClose} className="w-full px-4 py-2 font-serif text-sm tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-active-text))', background: 'linear-gradient(135deg, rgb(var(--tj-accent-primary)) 0%, rgb(var(--tj-arcane-accent)) 100%)', boxShadow: 'inset 0 0 0 1px rgba(255,245,200,0.46)', clipPath: CLIP_MEDIUM }}>
          关闭
        </button>
      </div>
    </Modal>
  );
}
