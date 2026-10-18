import type { CoreScope, SourceRef, BranchHead } from './identity';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { CoreSnapshot, StateRecord } from './state';
import type { SourceRecord, EvidenceRef, FactCandidate, GameEvent, EventDraft } from './event';
import type { CommitReceipt, JourneySeed, OperationRecord, OperationStage, PreparedCommit } from './operation';
import type { DerivedReceipt, MemoryRecord, DerivedPatch, JobRecord, JobClaim, JobFinish, JobStepResult } from './memory';
import type { KnowledgeRecord, CommitmentRecord } from './knowledge';
import type { CommittedOperationQuery, CorePackageManifest, ForkRequest, SaveSlot, SnapshotRecord, SourceQuery, IndexPatch, IndexReceipt, IndexStatus,IndexPosting,PostingQuery, OperationSourceAppend, MemoryVersionQuery } from './storage';
import type { OperationQuery } from './storage';
import { described, describeChecks, ruled } from './validationSchema';
import type { SchemaDescription } from './validationSchema';

export interface CoreDtoTypes { scope: CoreScope; sourceRef: SourceRef; evidence: EvidenceRef; head: BranchHead; seed: JourneySeed; snapshot: CoreSnapshot; snapshotRecord: SnapshotRecord; saveSlot: SaveSlot; fork: ForkRequest; sourceQuery: SourceQuery; committedOperationQuery: CommittedOperationQuery; indexPatch: IndexPatch; indexStatus: IndexStatus; indexPosting:IndexPosting; postingQuery:PostingQuery; indexReceipt: IndexReceipt; commitReceipt: CommitReceipt; derivedReceipt: DerivedReceipt; worldMoment: WorldMoment; state: StateRecord; source: SourceRecord; operationSourceAppend: OperationSourceAppend; memoryVersionQuery: MemoryVersionQuery; candidate: FactCandidate; event: GameEvent; eventDraft: EventDraft; operation: OperationRecord; stage: OperationStage; commit: PreparedCommit; memory: MemoryRecord; derived: DerivedPatch; job: JobRecord; jobClaim: JobClaim; jobFinish: JobFinish; jobStep: JobStepResult; knowledge: KnowledgeRecord; commitment: CommitmentRecord; manifest: CorePackageManifest }
export type CoreDtoKind = keyof CoreDtoTypes;
export interface CoreDtoTypes { operationQuery: OperationQuery }
export interface CoreDtoTypes { journeyQuery: import('./storage').JourneyQuery; journeyEntry: import('./storage').JourneyEntry }
export type CoreValidationResult<T = unknown> = { ok: true; value: T } | { ok: false; errors: string[] };
export function coreSchemaDescriptions(): Record<string, SchemaDescription> { return describeChecks(checks); }
type Check = (value: unknown) => boolean;
type Shape = Record<string, Check>;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text: Check = described(v => typeof v === 'string', () => ({ kind: 'text' }));
const nonEmpty: Check = described(v => typeof v === 'string' && v.trim().length > 0, () => ({ kind: 'nonEmpty' }));
const id: Check = described(v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(v), () => ({ kind: 'id' }));
const finite: Check = described(v => typeof v === 'number' && Number.isFinite(v), () => ({ kind: 'finite' }));
const nat: Check = described(v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0, () => ({ kind: 'nat' }));
const positive: Check = described(v => nat(v) && (v as number) > 0, () => ({ kind: 'positive' }));
const bool: Check = described(v => typeof v === 'boolean', () => ({ kind: 'bool' }));
const one = (...values: readonly (string | number)[]): Check => described(v => values.includes(v as string | number), () => ({ kind: 'one', values }));
const opt = (check: Check): Check => described(v => v === undefined || check(v), ref => ({ kind: 'optional', item: ref(check) }));
const nullable = (check: Check): Check => described(v => v === null || check(v), ref => ({ kind: 'nullable', item: ref(check) }));
const list = (check: Check, min = 0): Check => described(v => Array.isArray(v) && v.length >= min && v.every(check), ref => ({ kind: 'list', item: ref(check), min }));
const object = (shape: Shape): Check => described(v => isObject(v) && Object.keys(v).every(key => Object.hasOwn(shape, key)) && Object.entries(shape).every(([key, check]) => check(v[key])), ref => ({ kind: 'object', fields: Object.fromEntries(Object.entries(shape).map(([key, check]) => [key, ref(check)])) }));
const dictionary = (check: Check): Check => described(v => isObject(v) && Object.values(v).every(check), ref => ({ kind: 'dictionary', item: ref(check) }));
const either = (...checks: Check[]): Check => described(v => checks.some(check => check(v)), ref => ({ kind: 'or', items: checks.map(ref) }));
const bounded = (check: Check, max: number): Check => described(v => check(v) && (v as number) <= max, ref => ({ kind: 'bounded', item: ref(check), max }));
const scope = object({ journeyId: id, branchId: id });
const sourceRef = object({ sourceId: id, sourceVersion: positive });
const memoryRef = object({ memoryId: id, version: positive });
const regions = one('mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai');
const element = one('anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo');
const domain = one('traveler', 'world', 'npc', 'inventory', 'quest', 'story', 'courier', 'news', 'album', 'map', 'doudizhu');
const recordRef = object({ domain, entityId: id, version: nat });
const moment = object({ worldName: one('提瓦特'), date: nullable(text), clock: nullable(text), weather: nullable(text), location: nullable(text), locationId: opt(id), travelDay: nullable(positive), turn: nat, settlementId: id });
const momentRange = object({ start: nullable(moment), end: nullable(moment), sourceIds: list(id) });
const visibility = object({ kind: one('public', 'participants', 'private'), npcIds: list(id) });
const contentRef = object({ contentId: id, version: nonEmpty, checksum: nonEmpty });
const head: Check = ruled('head', object({ scope, coreSeq: nat, memoryRevision: nat, sessionId: id, parent: opt(scope), forkSeq: opt(nat), forkMemoryRevision: opt(nat) }), v => isObject(v) && (
  v.parent === undefined ? v.forkSeq === undefined && v.forkMemoryRevision === undefined : isObject(v.parent) && isObject(v.scope) &&
    nat(v.forkSeq) && nat(v.forkMemoryRevision) && (v.coreSeq as number) >= (v.forkSeq as number) && (v.memoryRevision as number) >= (v.forkMemoryRevision as number) &&
    v.parent.journeyId === v.scope.journeyId && v.parent.branchId !== v.scope.branchId
));
const evidence: Check = ruled('evidence', object({ ref: sourceRef, blockId: id, start: nat, end: positive, quote: nonEmpty }), v => isObject(v) && (v.end as number) > (v.start as number) && (v.end as number) - (v.start as number) === (v.quote as string).length);
const source = object({ ref: sourceRef, scope, operationId: id, kind: one('player_input', 'narrative', 'courier', 'moment', 'news', 'image', 'manual', 'rule', 'initialization', 'content'), blocks: list(object({ blockId: id, kind: one('narration', 'dialogue', 'message', 'configuration', 'rule', 'content'), text: nonEmpty, speakerId: opt(id) }), 1), moment, createdAt: nat, assetRefs: opt(list(id, 1)),
  delivery: opt(object({ version: one(1), bundles: list(object({ bundleId: id, target: one('main', 'private', 'group', 'moment', 'news', 'image'), npcIds: list(id), selectedLeafIds: list(id) })), worldbookEntryIds: list(nonEmpty) })), publicCitations: opt(list(object({ blockId: id, eventIds: list(id, 1) }))) });
const appearanceField = object({ value: text, source: one('canon', 'manual', 'narrative', 'ai_estimate') });
const appearance = object({ 发色: opt(appearanceField), 瞳色: opt(appearanceField), 身高: opt(appearanceField), 体重: opt(appearanceField), 三围: opt(appearanceField) });
const anchor = object({ id: opt(id), 名称: opt(text), 是否启用: opt(bool), 生成时默认附加: opt(bool), 场景生图自动注入: opt(bool), 正面提示词: opt(text), 负面提示词: opt(text), 中文摘要: opt(text), 结构化特征: opt(object(Object.fromEntries(['外貌标签', '身材标签', '胸部标签', '发型标签', '发色标签', '眼睛标签', '肤色标签', '年龄感标签', '服装基底标签', '特殊特征标签'].map(key => [key, opt(list(text))])))), 来源: opt(one('ai_extract', 'manual', 'imported')), 原始提取文本: opt(text), 提取模型信息: opt(text), createdAt: opt(nat), updatedAt: opt(nat) });
const imageLink: Check = described(v => typeof v === 'string' && !/^(?:data:|blob:)/i.test(v), () => ({ kind: 'imageLink' }));
const englishFacts = object({ schemaVersion: one(1), sourceKey: nonEmpty, preparedAt: nat, facts: object({ language: one('en'), name: nonEmpty, gender: opt(text), appearance: opt(text), outfit: opt(text), appearanceDetails: opt(appearance), profileHeight: opt(text) }), anchorPrompt: opt(text), anchorNegative: opt(text), anchorSourceKey: opt(text) });
const visual = object({ englishFacts: opt(englishFacts), characterAnchor: opt(anchor), profileImage: opt(imageLink), fullPortrait: opt(imageLink), slotImages: object({ profile: opt(imageLink), narrative: opt(imageLink), courier: opt(imageLink) }), status: opt(one('none', 'pending', 'done', 'failed')), source: opt(one('manual', 'canon', 'generated', 'placeholder')) });
const talent = object({ id, 名称: text, 类别: one('normal_attack', 'elemental_skill', 'elemental_burst', 'passive'), 关联元素: either(one(''), element), 等级: nat, 说明: text });
const attunement = object({ element, source: one('vision', 'traveler_resonance', 'adeptal', 'divine', 'abyssal', 'other'), mastery: finite, unlocked: bool, unlockedAt: text, notes: text });
const privateArchive = object({ enabled: opt(bool), ageConfirmation: opt(one('adult', 'unknown', 'minor_blocked')), ageConfirmationSource: opt(one('canonical', 'manual', 'legacy_unverified')), usualUnderwear: opt(text), virginityStatus: opt(one('virgin', 'not_virgin', 'unknown')), firstSexualPartner: opt(text), firstSexualPartnerRef: opt(one('player')), firstSexualPartnerSource: opt(one('narrative', 'legacy_assumed', 'manual')), firstSexualPartnerTurn: opt(nat), intimacyStage: opt(text), boundaries: opt(text), preferences: list(text), sensitivePoints: list(text), taboos: list(text), femaleBodyProfile: object({ chest: opt(text), genital: opt(text), rear: opt(text), build: opt(text), scent: opt(text) }), maleBodyProfile: object({ genital: opt(text), rear: opt(text), build: opt(text), scent: opt(text) }), tags: list(text), partImages: object({ femaleChest: opt(imageLink), femaleGenital: opt(imageLink), maleGenital: opt(imageLink), rear: opt(imageLink), bodyReference: opt(imageLink) }) });
const values: Record<import('./state').CoreDomain, Check> = {
  traveler: object({ id, 姓名: nonEmpty, 别名: text, 性别: text, 年龄: nat, 生日: text, 身高: text, 身份: text, 外貌: text, 性格: text, 背景: text, 专长知识: list(text), 头像: imageLink, 元素共鸣: list(attunement), 主元素: either(one(''), element), 天赋: list(talent), attributes: dictionary(finite), capabilities: list(text), visualArchive: visual, level: positive, health: finite, experience: nat }),
  world: object({ moment, region: either(one(''), regions), visitedRegions: list(regions), atmosphere: text, completedMainTurns: nat, proactiveLastTurn: nat, worldbookTriggers: opt(dictionary(nat)), opening: opt(object({ presetId: id, storyMode: one('normal', 'harem', 'romance_alt', 'deep_single'), travelerPreset: one('custom', '空', '荧'), canonicalCompanion: one('', '空', '荧') })), proactivePending: opt(object({ originBranchId: id, npcId: id, contactId: id, operationId: id, atTurn: nat, previousTurn: nat, jobId: id, channelId: id, moment })) }),
  npc: object({ id, 姓名: nonEmpty, 地区: text, 身份: text, 元素: opt(element), 力量来源: opt(one('vision', 'traveler_resonance', 'adeptal', 'divine', 'abyssal', 'other')), 天赋: list(talent), 说明: text, aliases: list(text), roleTier: one('companion', 'extra'), archived: opt(bool), tierBeforeArchive: opt(one('companion', 'extra')), affinity: finite, relationship: text, intimate: bool, travelingTogether: bool, firstSeenTurn: nat, lastSeenTurn: nat, gender: text, playerAddress: text, appearance: text, appearanceFacts: opt(appearance), clothing: text, speechStyle: text, personality: text, equipmentSummary: text, notes: list(text), playerCorrections: list(text), canonical: bool, canonicalId: opt(id), avatar: imageLink, visualArchive: visual, matureArchive: nullable(privateArchive) }),
  inventory: either(object({ kind: one('wallet'), mora: nat }), object({ kind: one('item'), name: nonEmpty, category: one('weapon', 'artifact', 'food', 'material', 'gadget', 'quest', 'furnishing'), quantity: nat, rarity: one(1, 2, 3, 4, 5), description: text, status: one('owned', 'depleted', 'discarded') })),
  quest: object({ id, title: nonEmpty, description: text, source: one('main', 'side', 'custom', 'letter'), status: one('not_started', 'active', 'completed', 'failed', 'abandoned'), objectives: list(object({ id, type: one('reach', 'collect', 'talk', 'travel', 'defeat', 'time'), description: text, targetCount: nat, currentCount: nat, completed: bool })), rewards: list(text), createdAtTurn: nat, updatedAt: nat, completedAtTurn: opt(nat), notes: opt(text), worldMoment: opt(moment) }),
  story: object({ seriesId: nullable(id), chapterId: nullable(id), nodeId: nullable(id), status: one('not_started', 'progressing', 'completed', 'diverged', 'paused'), completedNodeIds: list(id), resourceEdits: opt(list(object({ seriesId: id, nodeId: id, field: one('seriesTitle', 'chapterTitle', 'title', 'location', 'goal', 'completionEvidence', 'referenceText'), baseFingerprint: nonEmpty, value: either(text, list(text)) }))) }),
  courier: either(object({ kind: one('contact'), npcId: id, name: nonEmpty, remark: text, avatarAssetId: opt(id), available: bool }), object({ kind: one('conversation'), name: text, memberIds: list(id, 1), conversationType: one('private', 'group'), unreadCount: nat, lastReadSeq: nat, dissolved: bool }), object({ kind: one('moment'), authorId: id, sourceRef, imageAssetIds: list(id), mentionedNpcIds: list(id), visibilityNpcIds: list(id), commentNpcIds: opt(list(id)), randomCommentNpcIds: opt(list(id)), commentPlanSeq: opt(nat), commentReplies: opt(list(object({ npcId: id, jobId: id, operationId: id }))) })),
  news: object({ issueId: id, sourceRef, eventIds: list(id), moment }),
  album: object({ entryId: id, title: text, kind: one('scene', 'character', 'snapshot'), assetId: id, sourceRefs: list(sourceRef), npcIds: list(id), moment, phoneOrigin: opt(object({ conversationId: id, playerEventId: id, npcId: id })) }),
  map: object({ locationId: id, name: text, region: regions, visited: bool, parentId: opt(id) }),
  doudizhu: object({ currentGame: nullable(object({ id, npcIds: list(id, 2), seed: nat, redeals: nat, hands: list(list(nat), 3), bottom: list(nat), played: list(nat), phase: one('bidding', 'playing', 'finished'), bids: list(nullable(nat), 3), highestBid: nat, landlord: nullable(one(0, 1, 2)), activeSeat: one(0, 1, 2), trick: nullable(object({ seat: one(0, 1, 2), cards: list(nat), pattern: object({ kind: one('single', 'pair', 'triple', 'tripleSingle', 'triplePair', 'straight', 'pairStraight', 'airplane', 'airplaneSingles', 'airplanePairs', 'fourSingles', 'fourPairs', 'bomb', 'rocket'), mainRank: nat, cardCount: positive, chainLength: positive }) })), passCount: nat, result: nullable(object({ winningSide: one('landlord', 'farmers'), winnerSeat: one(0, 1, 2), spring: bool })), settled: bool })), lastError: opt(text) }),
};
const state: Check = described(v => object({ scope, domain, entityId: id, version: positive, value: () => true })(v) && isObject(v) && values[v.domain as keyof typeof values](v.value), ref => ({ kind: 'switch', field: 'domain', cases: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, ref(object({ scope, domain: one(name), entityId: id, version: positive, value }))])) }));
const change = object({ ref: recordRef, before: nullable(state), after: nullable(state), effectKey: id });
const factStatus = one('proposed', 'verified', 'pending', 'disputed', 'rejected');
const trigger: Check = either(object({ kind: one('date'), date: nonEmpty, clock: opt(text) }), object({ kind: one('location'), locationId: id }), object({ kind: one('event'), eventType: nonEmpty, targetId: opt(id) }));
const proposals: Record<import('./state').FactProposal['kind'], Check> = {
  inventory: object({ kind: one('inventory'), action: one('gain', 'consume', 'give', 'transfer'), itemId: id, quantity: positive, recipientId: opt(id), itemName: opt(nonEmpty) }),
  currency: object({ kind: one('currency'), delta: finite }),
  traveler: object({ kind: one('traveler'), field: one('health', 'experience', 'level'), value: finite }),
  time: object({ kind: one('time'), elapsedMinutes: nat, date: opt(text), clock: opt(text) }),
  location: object({ kind: one('location'), location: nonEmpty, region: opt(regions) }),
  weather: object({ kind: one('weather'), weather: nonEmpty }),
  npc: object({ kind: one('npc'), npcId: id, name: nonEmpty, action: one('meet', 'join', 'leave') }),
  quest: object({ kind: one('quest'), questId: id, action: one('start', 'progress', 'complete', 'fail'), objectiveId: opt(id), amount: opt(positive), definition: opt(object({ title: nonEmpty, objectives: list(object({ description: nonEmpty, type: one('reach', 'collect', 'talk', 'travel', 'defeat', 'time'), targetCount: positive }), 1) })) }),
  relationship: object({ kind: one('relationship'), npcId: id, affinityDelta: finite, relationship: opt(text) }),
  commitment: object({ kind: one('commitment'), action: one('create', 'fulfill', 'cancel'), commitmentId: id, text: nonEmpty, participantIds: list(id, 1), trigger: opt(trigger) }),
  experience: object({ kind: one('experience'), participantIds: list(id, 2), description: nonEmpty }),
  profile: object({ kind: one('profile'), npcId: id, field: one('appearance', 'clothing', 'personality', 'speechStyle', 'playerAddress'), value: text }),
  element: object({ kind: one('element'), element, unlocked: bool }),
  talent: object({ kind: one('talent'), talentId: id, element: either(one(''), element), level: nat }),
  story: object({ kind: one('story'), action: opt(one('enter', 'complete')), seriesId: id, chapterId: id, nodeId: id }),
};
const proposal: Check = described(v => isObject(v) && typeof v.kind === 'string' && Object.hasOwn(proposals, v.kind) && proposals[v.kind as keyof typeof proposals](v), ref => ({ kind: 'switch', field: 'kind', cases: Object.fromEntries(Object.entries(proposals).map(([name, check]) => [name, ref(check)])) }));
const candidate: Check = ruled('candidate', object({ candidateId: id, scope, operationId: id, kind: one(...Object.keys(proposals)), actors: list(id), targets: list(id), proposal, evidenceRefs: list(evidence, 1), status: factStatus, reason: opt(text) }), v => isObject(v) && isObject(v.proposal) && v.kind === v.proposal.kind);
const eventFields: Shape = { eventId: id, journeyId: id, branchId: id, operationId: id, turn: nat, type: nonEmpty, actorIds: list(id), targetIds: list(id), evidenceRefs: list(evidence, 1), occurredMoment: moment, momentRange: opt(momentRange), ruleVersion: nonEmpty, committedChanges: list(change), visibility, recordedAt: nat, correctionOf: opt(id), fact: opt(proposal), channelId: opt(id), sourceOrder: opt(nat), replyToEventId: opt(id) };
const eventDraft = object(eventFields);
const event = object({ ...eventFields, commitSeq: positive });
const memory: Check = ruled('memory', object({ memoryId: id, scope, version: positive, layer: one('immediate', 'short', 'middle', 'long'), text: nonEmpty, sourceRefs: list(sourceRef), eventIds: list(id), memoryRefs: list(memoryRef), turns: list(nat, 1), momentRange, npcIds: list(id), locations: list(text), visibility, importance: finite, pinned: bool, status: one('pending', 'active', 'failed', 'superseded'), generation: object({ mode: one('local', 'model', 'manual'), version: nonEmpty }), editVersion: nat }), v => isObject(v) && [v.sourceRefs, v.eventIds, v.memoryRefs].some(refs => Array.isArray(refs) && refs.length > 0));
const failure = object({ code: nonEmpty, detail: text });
const step: Check = ruled('jobStep', object({ scope, sessionId: id, jobId: id, leaseId: id, sourceRefs: list(sourceRef), stepId: id, status: one('completed', 'failed'), memories: list(memory), failure: opt(failure) }), v => isObject(v) &&
  (v.status === 'failed' ? v.failure !== undefined && Array.isArray(v.memories) && v.memories.length === 0 : v.failure === undefined));
const derivedReceipt = object({ status: one('published', 'conflict', 'cancelled'), memoryRevision: nat, memoryIds: list(id), reason: opt(text) });
const job = object({ jobId: id, scope, sessionId: id, kind: one('turn_summary', 'compression', 'rebuild', 'index', 'image', 'courier', 'news', 'profile', 'manual_memory'), sourceRefs: list(sourceRef), operationId: id, status: one('pending', 'running', 'completed', 'failed', 'cancelled'), leaseId: nullable(id), configFingerprint: text, attempts: nat, steps: list(step), failure: opt(failure), version: positive, retryOfJobId: opt(id), retriedByJobId: opt(id), publicationReceipt: opt(derivedReceipt) });
const claimFields = { scope, sessionId: id, jobId: id, leaseId: id, sourceRefs: list(sourceRef), expectedVersion: positive };
const jobClaim = object(claimFields);
const jobFinish: Check = ruled('jobFinish', object({ ...claimFields, status: one('completed', 'failed', 'cancelled'), failure: opt(failure) }), v => isObject(v) &&
  (v.status === 'failed' ? v.failure !== undefined : v.status !== 'completed' || v.failure === undefined));
const receipt = object({ status: one('committed', 'already_committed', 'conflict', 'cancelled'), scope, operationId: id, coreSeq: nat, eventIds: list(id), jobIds: list(id), reason: opt(text) });
const indexReceipt = object({ status: one('published', 'conflict', 'cancelled'), indexVersion: nat, reason: opt(text) });
const stage = object({ scope, sessionId: id, operationId: id, sourceRefs: list(sourceRef), candidates: list(candidate), review: list(object({ candidateId: id, status: factStatus, reason: text })), stageVersion: positive });
const operation = object({ scope, operationId: id, kind: one('main', 'courier', 'moment', 'manual', 'system', 'initialization'), status: one('draft', 'prepared', 'committed', 'failed', 'cancelled'), sourceRefs: list(sourceRef), readSet: list(recordRef), candidateRefs: list(id), effects: list(id), attempts: nat, receipt: opt(receipt), stage: opt(stage), failure: opt(failure) });
const knowledge = object({ knowledgeId: id, scope, npcId: id, eventId: id, mode: one('witnessed', 'told', 'read_public', 'rumor', 'inferred'), informantId: opt(id), channelId: opt(id), evidenceRefs: list(evidence, 1), learnedMoment: moment, nature: one('fact', 'belief'), version: positive });
const commitmentStatus = one('pending', 'due', 'fulfilled', 'cancelled', 'breached');
const commitment = object({ commitmentId: id, scope, participantIds: list(id, 1), text: nonEmpty, establishedEventId: id, trigger, recurring: bool, status: commitmentStatus, history: list(object({ eventId: id, status: commitmentStatus, moment })), version: positive });
const snapshot = object({ head, records: list(state), contentRefs: list(contentRef), tombstones: opt(list(object({ domain, entityId: id, version: positive }))) });
const snapshotRecord: Check = ruled('snapshotRecord', object({ snapshotId: id, scope, coreSeq: nat, memoryRevision: nat, state: snapshot, createdAt: nat, checksum: nonEmpty }), v =>
  isObject(v) && isObject(v.state) && isObject(v.state.head) && v.coreSeq === v.state.head.coreSeq && v.memoryRevision === v.state.head.memoryRevision);
const saveSlot = object({ slotId: id, journeyId: id, kind: one('manual', 'auto'), snapshotId: id, turn: nat, name: text, updatedAt: nat });
const fork = object({ snapshotId: id, parentScope: scope, branchId: id, sessionId: id });
const sourceQuery = object({ scope, cutoffSeq: nat, cursor: opt(nonEmpty), limit: opt(bounded(positive, 200)),
  refs: opt(list(sourceRef)), kinds: opt(list(one('player_input', 'narrative', 'courier', 'moment', 'news', 'image', 'manual', 'rule', 'initialization', 'content'))), operationId: opt(id) });
const committedOperationQuery = object({ scope, cutoffSeq: nat, afterSeq: nat, kinds: opt(list(one('main', 'courier', 'moment', 'manual', 'system', 'initialization'))), direction: opt(one('asc', 'desc')), cursor: opt(nonEmpty), limit: opt(bounded(positive,200)) });
const operationQuery = object({ scope, cutoffSeq: nat, statuses: list(one('draft', 'prepared', 'committed', 'failed', 'cancelled'), 1), kinds: opt(list(one('main', 'courier', 'moment', 'manual', 'system', 'initialization'))), cursor: opt(nonEmpty), limit: opt(bounded(positive, 200)) });
const indexStatus = object({ scope, coreSeq: nat, memoryRevision: nat, indexVersion: nat, status: one('ready', 'lagging', 'missing'), contentVersion: opt(one('recall-v2')) });
const indexPosting=object({scope,kind:one('npc','location','keyword','type'),key:nonEmpty,target:one('event','memory'),targetId:id,commitSeq:nat,memoryRevision:nat});
const postingQuery=object({scope,cutoffSeq:nat,memoryRevision:nat,cursor:opt(nonEmpty),limit:opt(bounded(positive,200)),kind:opt(one('npc','location','keyword','type')),keys:opt(list(nonEmpty)),target:opt(one('event','memory'))});
const indexPatch = object({ scope, sessionId: id, cutoffSeq: nat, memoryRevision: nat, expectedIndexVersion: nat,
  postings:list(indexPosting),mode:opt(one('replace','merge')),replacedTargets:opt(list(object({target:one('event','memory'),targetId:id}))),contentVersion:opt(one('recall-v2')) });
const seed = object({ head, playerId: id, records: list(state, 1), contentRefs: list(contentRef), sources: list(source, 1) });
const commit = object({ scope, sessionId: id, operationId: id, readSet: list(recordRef), sourceRefs: list(sourceRef), changes: list(change), events: list(eventDraft), knowledge: list(knowledge), commitments: list(commitment), jobs: list(job), jobGuard: opt(object({ jobId: id, leaseId: id, expectedVersion: positive, sourceRefs: list(sourceRef, 1) })) });
const derived = object({ scope, sessionId: id, jobId: id, leaseId: id, sourceRefs: list(sourceRef), readSet: list(memoryRef), expectedMemoryRevision: nat, additions: list(memory), supersededIds: list(id) });
const manifest = object({ kind: one('teyvat-core2-package'), formatVersion: one(1), scope, snapshotId: id, files: list(object({ path: nonEmpty, checksum: nonEmpty, size: nat })), containsPrivateData: bool });
const operationSourceAppend = object({ scope, sessionId: id, operationId: id, source });
const memoryVersionQuery = object({ scope, cutoffSeq: nat, memoryRevision: nat, refs: list(memoryRef) });
const journeyQuery = object({ cursor: opt(nonEmpty), limit: opt(bounded(positive, 200)) });
const journeyEntry = object({ scope, name: nonEmpty, turn: nat, coreSeq: nat, parentBranchId: opt(id) });
const checks: Record<CoreDtoKind, Check> = { journeyQuery, journeyEntry, operationQuery, scope, sourceRef, evidence, head, seed, snapshot, snapshotRecord, saveSlot, fork, sourceQuery, committedOperationQuery, indexPatch, indexStatus, indexPosting, postingQuery, indexReceipt, commitReceipt: receipt, derivedReceipt, worldMoment: moment, state, source, operationSourceAppend, memoryVersionQuery, candidate, event, eventDraft, operation, stage, commit, memory, derived, job, jobClaim, jobFinish, jobStep: step, knowledge, commitment, manifest };

/** Check inert JSON data before any field access; reject cycles, accessors and unsafe keys. */
export function isCoreJsonData(value: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === 'string') return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value) && Object.getOwnPropertyNames(value).length !== value.length + 1) return false;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !Object.hasOwn(descriptor, 'value')) return false;
      if (!isCoreJsonData(key)) return false;
      if (Array.isArray(value) && key === 'length') continue;
      if (!descriptor.enumerable) return false;
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
      if (!isCoreJsonData(descriptor.value, ancestors, depth + 1)) return false;
    }
    return Object.getOwnPropertySymbols(value).length === 0;
  } finally { ancestors.delete(value); }
}
function sameScope(a: unknown, b: CoreScope): boolean { return isObject(a) && a.journeyId === b.journeyId && a.branchId === b.branchId; }
function scopeConsistent(value: unknown, expected: CoreScope, rootHead = false): boolean {
  if (!isObject(value) && !Array.isArray(value)) return true;
  if (isObject(value) && Object.hasOwn(value, 'scope') && !sameScope(value.scope, expected)) return false;
  if (isObject(value) && Object.hasOwn(value, 'journeyId') && value.journeyId !== expected.journeyId) return false;
  if (isObject(value) && Object.hasOwn(value, 'branchId') && value.branchId !== expected.branchId) return false;
  // The already-validated head.parent is lineage metadata, not a writable foreign record.
  return Object.entries(value).every(([key, child]) => key === 'head' || (rootHead && key === 'parent') || scopeConsistent(child, expected));
}
export function validateCoreDto<K extends CoreDtoKind>(kind: K, input: unknown): CoreValidationResult<CoreDtoTypes[K]> {
  if (!isCoreJsonData(input) || !Object.hasOwn(checks, kind) || !checks[kind](input)) return { ok: false, errors: [`INVALID_CORE2_${kind.toUpperCase()}`] };
  if (isObject(input)) {
    const expected = isObject(input.head) ? input.head.scope : input.scope ?? (id(input.journeyId) && id(input.branchId) ? { journeyId: input.journeyId, branchId: input.branchId } : undefined);
    if (scope(expected) && !scopeConsistent(input, expected as unknown as CoreScope, kind === 'head')) return { ok: false, errors: ['CORE2_SCOPE_MISMATCH'] };
  }
  return { ok: true, value: input as CoreDtoTypes[K] };
}
