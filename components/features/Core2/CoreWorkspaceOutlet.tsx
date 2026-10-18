import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { CoreController } from '@/core/settlement/coreController';
import { CoreCourierPanel } from './CoreCourierPanel';
import { CoreMemoryWorkspace } from './CoreMemoryWorkspace';
import { CoreFailureCenter } from './CoreFailureCenter';
import { CoreRecordsPanel } from './CoreRecordsPanel';
import { CoreJourneyPanel } from './CoreJourneyPanel';
import { CoreStoryPanel } from './CoreStoryPanel';
import { CoreCodexPanel } from './CoreCodexPanel';
import { CoreDoudizhuPanel } from './CoreDoudizhuPanel';
import { CoreNewsPanel } from './CoreNewsPanel';
import { CoreAlbumPanel } from './CoreAlbumPanel';

export const CORE_WORKSPACES = { adventure: '冒险', profile: '旅人档案', companions: '同伴', inventory: '背包', quests: '任务', map: '地图', elements: '元素与天赋', story: '剧情', codex: '提瓦特图鉴', phone: '手机', album: '相册', news: '蒸汽鸟报', doudizhu: '斗地主', memory: '旅途记忆', irminsul: '世界树', failures: '失败结算中心' } as const;
export type CoreWorkspace = keyof typeof CORE_WORKSPACES;

/** Mount just the selected workspace. Opening a page never starts a model job. */
export function CoreWorkspaceOutlet({ page, repo, controller, snapshot, revision, disabled = false }: { page: Exclude<CoreWorkspace, 'adventure'>; repo: CoreRepository; controller: CoreController; snapshot: CoreSnapshot; revision: number; disabled?: boolean }) {
  if (page === 'profile' || page === 'companions' || page === 'inventory') return <CoreRecordsPanel page={page} repo={repo} snapshot={snapshot} disabled={disabled} onCommand={command => controller.command(command)} onCompleteProfile={npcId => controller.completeNpcProfile(npcId)} />;
  if (page === 'quests' || page === 'map' || page === 'elements') return <CoreJourneyPanel page={page} snapshot={snapshot} disabled={disabled} talents={controller.getTalentTemplates()} onCommand={command => controller.command(command)} />;
  if (page === 'story') return <CoreStoryPanel {...{ controller, snapshot, disabled }} />;
  if (page === 'codex') return <CoreCodexPanel {...{ controller, snapshot }} />;
  if (page === 'news') return <CoreNewsPanel {...{ controller, repo, snapshot, revision, disabled }} />;
  if (page === 'album') return <CoreAlbumPanel {...{ controller, repo, snapshot, disabled }} />;
  if (page === 'doudizhu') return <CoreDoudizhuPanel snapshot={snapshot} disabled={disabled} onCommand={command => controller.command(command)} />;
  if (page === 'phone') return <CoreCourierPanel repo={repo} controller={controller} snapshot={snapshot} revision={revision} disabled={disabled} onRetry={id => controller.retryJob(id)} onCommand={command => controller.command(command)}
    onSend={(conversationId, text) => controller.sendPhone({ conversationId, text, operationId: `phone-send-${crypto.randomUUID()}` })}
    onRead={(conversationId, expectedVersion, throughSeq) => controller.command({ type: 'conversation_read', conversationId, expectedVersion, throughSeq })} />;
  if (page === 'failures') return <CoreFailureCenter revision={revision} repo={repo} head={snapshot.head}
    onRetryJob={id => controller.retryJob(id)} onStopJob={id => controller.stopJob(id)} onRetryTurn={id => controller.retry(id)} onStopTurn={id => controller.cancel(id)} />;
  return <CoreMemoryWorkspace repo={repo} head={snapshot.head} tree={page === 'irminsul'} disabled={disabled} onEdit={input => controller.editMemory(input)}
    onPreview={(mode, ids) => controller.previewMaintenance(mode, ids)} onRun={async token => {
      const result = await controller.runMaintenance(token);
      if (result.kind !== 'completed') throw Error(result.detail ?? (result.kind === 'cancelled' ? '整理已停止，原记忆未覆盖。' : '整理没有完成，请查看失败结算中心。'));
      return { kind: 'completed' };
    }} />;
}
