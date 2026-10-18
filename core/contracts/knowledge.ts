import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { CoreScope } from './identity';
import type { EvidenceRef } from './event';

export interface KnowledgeRecord { knowledgeId: string; scope: CoreScope; npcId: string; eventId: string; mode: 'witnessed' | 'told' | 'read_public' | 'rumor' | 'inferred'; informantId?: string; channelId?: string; evidenceRefs: EvidenceRef[]; learnedMoment: WorldMoment; nature: 'fact' | 'belief'; version: number }
export type CommitmentTrigger = { kind: 'date'; date: string; clock?: string } | { kind: 'location'; locationId: string } | { kind: 'event'; eventType: string; targetId?: string };
export interface CommitmentRecord { commitmentId: string; scope: CoreScope; participantIds: string[]; text: string; establishedEventId: string; trigger: CommitmentTrigger; recurring: boolean; status: 'pending' | 'due' | 'fulfilled' | 'cancelled' | 'breached'; history: { eventId: string; status: CommitmentRecord['status']; moment: WorldMoment }[]; version: number }
export interface Audience { target: 'main' | 'private' | 'group' | 'moment' | 'news' | 'image'; npcIds: string[]; conversationId?: string }
export interface VisibilityDecision { allowed: boolean; reason: string; leafIds: string[] }
