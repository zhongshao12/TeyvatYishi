import { CLIP_MEDIUM, CLIP_PANEL, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import type { 角色数据结构 } from '@/models/character';
import type { 相册系统 } from '@/models/imageGeneration';
import { Modal } from '@/components/ui/Modal';
import type { ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { 解析相册资源引用 } from '@/utils/albumActions';

interface Props {
  traveler: 角色数据结构;
  album?: 相册系统;
  onClose: () => void;
  onTravelerChange?: (traveler: 角色数据结构) => void;
}



export function TravelerProfileModal({ traveler, album, onClose, onTravelerChange }: Props) {
  const handleAvatarUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 压缩到 256x256，控制存档体积
        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        onTravelerChange?.({ ...traveler, 头像: canvas.toDataURL('image/webp', 0.85) });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const primaryAttunement = traveler.元素共鸣.find((entry) => entry.element === traveler.主元素) ?? traveler.元素共鸣[0];
  const avatarUrl = 解析相册资源引用(album, traveler.头像?.trim() || traveler.图像档案?.头像?.trim());

  return (
    <Modal onClose={onClose} title="旅人档案" className="max-w-3xl">
      <div className="journal-story-page space-y-4 rounded-sm p-1">
        {/* 顶部：头像 + 姓名 */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden font-serif text-4xl font-bold"
            style={{
              background:
                avatarUrl
                  ? 'rgb(var(--tj-surface-strong))'
                  : 'radial-gradient(circle, rgba(var(--tj-bubble), 1) 0%, rgba(var(--tj-surface-strong), 1) 100%)',
              boxShadow:
                'inset 0 0 0 1.5px rgba(var(--tj-accent-primary), 0.75), 0 0 22px rgba(var(--tj-accent-primary), 0.18)',
              color: 'rgb(var(--tj-accent-primary))',
              clipPath:
                CLIP_PANEL,
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={`${traveler.姓名 || '旅人'} 头像`} className="h-full w-full object-cover" />
            ) : (
              traveler.姓名 ? traveler.姓名[0] : '?'
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="traveler-avatar-upload"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleAvatarUpload(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => document.getElementById('traveler-avatar-upload')?.click()}
              className="px-3 py-1.5 text-xs tracking-[0.1em]"
              style={{
                color: 'var(--journal-ink)',
                background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
                boxShadow: 'inset 0 0 0 1px rgba(53, 46, 39, 0.24)',
                clipPath: CLIP_SMALL,
                fontWeight: 600,
              }}
            >
              ⬆ 上传头像
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="font-serif text-2xl font-bold tracking-[0.2em]"
              style={{
                background: 'linear-gradient(180deg, rgb(var(--tj-text-primary)) 0%, rgb(var(--tj-accent-primary)) 60%, rgb(var(--tj-accent-secondary)) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {traveler.姓名 || '无名旅行者'}
            </div>
            {traveler.别名 && (
              <div
                className="mt-1 font-serif text-sm italic tracking-[0.22em]"
                style={{ color: 'rgba(var(--tj-text-secondary), 0.95)' }}
              >
                「{traveler.别名}」
              </div>
            )}
          </div>
        </div>

        <div className="teyvat-divider" />

        {/* 基本信息 */}
        <Section title="基本信息">
          <div className="grid grid-cols-2 gap-2">
            <InfoCell label="性别" value={traveler.性别} />
            <InfoCell label="身高" value={traveler.身高} />
            <InfoCell label="年龄" value={traveler.年龄 > 0 ? `${traveler.年龄} 岁` : ''} />
            <InfoCell label="生日" value={traveler.生日} />
            <InfoCell label="身份" value={traveler.身份} />
          </div>
        </Section>

        {/* 元素特质 */}
        {primaryAttunement && (
          <Section title="元素特质">
            <InfoCell
              label="主元素"
              value={`${ELEMENT_NAMES[primaryAttunement.element]} · 熟练度 ${primaryAttunement.mastery}`}
            />
            {traveler.天赋.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {traveler.天赋.filter((talent) => !talent.关联元素 || talent.关联元素 === primaryAttunement.element).map((trait) => (
                  <TraitChip key={trait.名称} trait={trait} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* 外观与心性 */}
        {(traveler.外貌 || traveler.性格 || traveler.背景) && (
          <Section title="外观与心性">
            <BlockCell label="外观" value={traveler.外貌} />
            <BlockCell label="性格" value={traveler.性格} />
            <BlockCell label="背景故事" value={traveler.背景} />
          </Section>
        )}

        {/* 能力与特长 */}
        {(traveler.能力?.length > 0 || traveler.专长知识?.length > 0) && (
          <Section title="能力 / 特长">
            {traveler.能力?.length > 0 && (
              <InfoCell label="能力" value={traveler.能力.join('、')} />
            )}
            {traveler.专长知识?.length > 0 && (
              <InfoCell label="知识" value={traveler.专长知识.join('、')} />
            )}
          </Section>
        )}

        {/* 底部提示 */}
        <div
          className="mt-2 px-3 py-2 text-[13px] font-serif tracking-wider"
          style={{
            color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.96), rgba(var(--tj-accent-secondary),0.92))',
            background: 'linear-gradient(135deg, rgba(var(--tj-amber-soft),0.16), rgba(var(--tj-bubble),1))',
            boxShadow: insetRing(0.32),
            clipPath: CLIP_MEDIUM,
          }}
        >
          ✦ 档案为只读视图。如需修改字段，请前往「变量管理」中调整。
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mb-2 font-serif text-[13px] tracking-[0.35em]"
        style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.96), rgba(var(--tj-accent-secondary),0.92))' }}
      >
        ◆ {title.toUpperCase()}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div
      className="px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgb(var(--tj-bubble)), rgba(var(--tj-paper-deep),0.72))',
        boxShadow:
          'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.22), inset 2px 0 0 rgba(var(--tj-accent-primary), 0.55)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <span
        className="text-[12px] font-serif tracking-[0.3em]"
        style={{ color: 'rgba(var(--tj-accent-primary), 0.96)' }}
      >
        {label}
      </span>
      <div
        className="mt-1 font-serif text-[15px] tracking-wider"
        style={{ color: 'rgba(var(--tj-text-primary), 0.96)' }}
      >
        {value}
      </div>
    </div>
  );
}

function BlockCell({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div
      className="px-3 py-2.5"
      style={{
        background: 'linear-gradient(135deg, rgb(var(--tj-bubble)), rgba(var(--tj-paper-deep),0.72))',
        boxShadow:
          'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.22), inset 2px 0 0 rgba(var(--tj-accent-primary), 0.55)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <span
        className="text-[12px] font-serif tracking-[0.3em]"
        style={{ color: 'linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))' }}
      >
        {label}
      </span>
      <div
        className="mt-1 whitespace-pre-wrap font-serif text-[14px] leading-relaxed tracking-wider"
        style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}
      >
        {value}
      </div>
    </div>
  );
}

function TraitChip({ trait }: { trait: { 名称: string; 说明: string } }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-arcane-accent),0.12), rgb(var(--tj-bubble)))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent), 0.28), inset 2px 0 0 rgba(var(--tj-accent-primary),0.42)',
        clipPath: CLIP_MEDIUM,
      }}
      title={trait.说明}
    >
      <div className="font-serif text-[13px] tracking-[0.22em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
        {trait.名称}
      </div>
      <div className="mt-1 font-serif text-[12px] leading-relaxed tracking-wider" style={{ color: 'rgba(var(--tj-text-secondary), 0.86)' }}>
        {trait.说明}
      </div>
    </div>
  );
}
