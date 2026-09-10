import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodexManagerModal } from '@/components/features/Codex/CodexManagerModal';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat';

// 提瓦特图鉴视觉回归：检索筛选 / 已解锁角色档案 / 未解锁占位 / 召回预览。
const meta: Meta<typeof CodexManagerModal> = {
  title: '冒险者手账/图鉴',
  component: CodexManagerModal,
  parameters: { layout: 'fullscreen' },
};
export default meta;

function makeEntry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'category' | 'name'>): CodexEntry {
  return {
    description: '',
    unlockedAtTurn: 0,
    tags: [],
    summary: '',
    sourceText: '',
    source: '',
    keywords: [],
    triggerKeywords: [],
    injection: {},
    runtimeUnlock: { status: 'unlocked', note: '' },
    usage: { narrative: true, courier: false, steambird: false, variables: false },
    relatedEntryIds: [],
    importance: 5,
    linkable: true,
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const sampleCodex: ArchiveCodex = {
  entries: [
    makeEntry({
      id: 'amber',
      category: '角色',
      name: '安柏',
      summary: '西风骑士团唯一的侦察骑士，蒙德城最热情可靠的行动派。',
      tags: ['蒙德', '西风骑士团', '侦察骑士'],
      keywords: ['安柏', '兔兔伯爵', '飞行冠军'],
      triggerKeywords: ['安柏'],
      injection: {
        publicText: '安柏·侦察骑士',
        identityAndFaction: '西风骑士团侦察骑士，蒙德城活跃的行动派。',
        personalityAndBehavior: '热情外向、行动力强，遇事先冲再说，对新人极为照顾。',
        speechStyle: '元气、直率，喜欢用“交给我吧！”开头。',
        appearanceAnchor: '红棕色短发，发带束起，西风骑士团制服背着弓。',
        conciseStory: '自幼随祖父练习弓术，立志成为像爷爷一样的骑士。',
        portrayalBoundaries: '不替她表达对爷爷离去的完整心结，仅作背景提及。',
      },
      usage: { narrative: true, courier: true, steambird: true, variables: false },
      relatedEntryIds: ['mondstadt', 'kung-fu-rabbit'],
    }),
    makeEntry({
      id: 'mondstadt',
      category: '地点',
      name: '蒙德',
      summary: '七国之一的风之国度，自由之城。',
      triggerKeywords: ['蒙德'],
      injection: { publicText: '蒙德·自由之都', definition: '受风神巴巴托斯守护的自由城邦。' },
      usage: { narrative: true, courier: false, steambird: false, variables: false },
    }),
    makeEntry({
      id: 'skirk',
      category: '角色',
      name: '丝柯克',
      summary: '深渊中的神秘剑客。',
      triggerKeywords: ['丝柯克'],
      runtimeUnlock: { status: 'locked', note: '', condition: '在深渊边界遭遇战中初次提及后解锁' },
      usage: { narrative: true, courier: false, steambird: false, variables: false },
    }),
  ],
  unlockedEntryIds: ['amber', 'mondstadt'],
};

const noop = () => undefined;

export const 图鉴样例: StoryObj = {
  render: () => (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--tj-bg-primary))' }}>
      <CodexManagerModal codex={sampleCodex} onClose={noop} />
    </div>
  ),
};
