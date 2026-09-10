import type { Meta, StoryObj } from '@storybook/react-vite';
import { LegacyUniverseSaveCard } from '../components/features/SaveLoad/LegacyUniverseSaveCard';
import { SaveMigrationDialog } from '../components/features/SaveLoad/SaveMigrationDialog';

const report = {
  sourceUniverse: 'partial-teyvat' as const,
  appliedMappings: [{ from: '旅人.主命途', to: '旅行者.element', value: 'electro' }],
  issues: [],
};

const meta = {
  title: '存档/迁移预览',
  component: SaveMigrationDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    report,
    sourceBackupId: 'sha256-8d6f34e2f971a54d',
    onConfirm: async () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof SaveMigrationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 旧宇宙只读卡: Story = {
  args: { issues: [] },
  render: () => <LegacyUniverseSaveCard report={{ ...report, sourceUniverse: 'legacy-hsr' }} onExport={async () => {}} />,
};

export const 元素待选择: Story = {
  args: {
    issues: [{ code: 'UNRESOLVED_ELEMENT', path: '旅人.主元素', value: 'unknown-path', message: '此旧路径没有确定的元素对应关系。' }],
  },
};

export const 稀有度待选择: Story = {
  args: {
    issues: [{ code: 'UNRESOLVED_RARITY', path: '背包[0].星级', value: 'legendary', message: '此物品等级需要你选择对应星级。' }],
  },
};

export const 全部解决后可确认: Story = {
  args: {
    issues: [{ code: 'UNRESOLVED_ELEMENT', path: '旅人.主元素', value: 'unknown-path', message: '已示范完成一个需要手动选择的元素字段。' }],
    initialChoices: { '旅人.主元素': 'electro' },
  },
};
