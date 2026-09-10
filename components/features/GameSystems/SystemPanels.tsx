// 各游戏系统的占位面板。每个系统未来会替换为完整实现。

interface PlaceholderProps {
  label: string;
  description: string;
}

const cardClip =
  'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)';

function SystemPlaceholder({ label, description }: PlaceholderProps) {
  return (
    <div className="space-y-4">
      <div
        className="px-4 py-3"
        style={{
          background:
            'linear-gradient(180deg, rgba(var(--tj-accent-primary), 0.07), rgba(var(--tj-accent-primary), 0.015))',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.28)',
          clipPath: cardClip,
        }}
      >
        <div
          className="font-serif text-xs tracking-[0.35em]"
          style={{ color: 'rgba(var(--tj-accent-primary), 0.7)' }}
        >
          ◆ {label}
        </div>
        <div
          className="mt-2 font-serif text-sm leading-relaxed tracking-wider"
          style={{ color: 'rgba(var(--tj-text-secondary), 0.85)' }}
        >
          {description}
        </div>
      </div>

      <div
        className="px-4 py-8 text-center font-serif text-xs italic tracking-[0.22em]"
        style={{
          color: 'rgba(var(--tj-text-secondary), 0.65)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.15)',
          clipPath: cardClip,
        }}
      >
        <div className="mb-2 text-2xl" style={{ color: 'rgba(var(--tj-accent-primary), 0.35)' }}>
          ◇
        </div>
        建设中
      </div>
    </div>
  );
}

export function PathPanel() {
  // 这个占位仅用于直接渲染时的兜底；实际元素面板由
  // [components/features/GameSystems/PathPanel.tsx] 提供（需要 traveler / onTravelerChange）。
  // App.tsx 通过 renderSystemPanel 已经直接导入了真实的 PathPanel，这里保留兜底以防误用。
  return (
    <SystemPlaceholder
      label="元素"
      description="查看旅行者已经解锁的七元素共鸣、掌握度与当前主元素。"
    />
  );
}

export function QuestPanel() {
  return (
    <SystemPlaceholder
      label="任务"
      description="剧情任务清单：进行中 / 已完成 / 已放弃，目标进度自动结算。"
    />
  );
}

export function InventoryPanel() {
  return (
    <SystemPlaceholder
      label="背包"
      description="存放消耗品、关键道具、剧情物件。AI 在生成内容时会读取背包以决定可用资源。"
    />
  );
}

export function CompanionPanel() {
  // CompanionPanel 已搬到独立文件：components/features/GameSystems/CompanionPanel.tsx
  // 这里保留兜底，防止其他位置误引用导致编译错误。
  return (
    <SystemPlaceholder
      label="伙伴"
      description="同行者、相识者与情感关系的记录。"
    />
  );
}

export function AlbumPanel() {
  return (
    <SystemPlaceholder
      label="相册"
      description="统一管理角色头像、正文头像、手机头像、立绘、手机背景与后续文生图资产。"
    />
  );
}

export function TimelinePanel() {
  return (
    <SystemPlaceholder
      label="时间线"
      description="回合、蒸汽鸟报、剧情编织事件与长期记忆按时间排序的事件年表。"
    />
  );
}

export function PlotPanel() {
  return (
    <SystemPlaceholder
      label="剧情"
      description="剧情编织与关键节点的规划。当前支持蒙德、璃月、稻妻、须弥、枫丹、纳塔和自由开局的章节锚点，系统会按开局档案与当前地点选择注入窗口。"
    />
  );
}

export function MemoryPanel() {
  // MemoryPanel 已搬到独立文件：components/features/GameSystems/MemoryPanel.tsx
  // 这里保留兜底，防止其他位置误引用导致编译错误。
  return (
    <SystemPlaceholder
      label="记忆"
      description="长期、短期、即时三层记忆。"
    />
  );
}
