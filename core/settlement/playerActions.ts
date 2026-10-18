import type { CoreAction } from './actions';
import type { CoreRulePolicy } from './domainRules';
import type { RuleContext } from './ruleContext';
import { stableJson } from '../persistence/repositoryValidation';
import { 格式化NPC关系, 限制NPC好感度 } from '@/models/npc';
import { applyCharacterRule } from './characterRules';
import { startDoudizhuGame, applyDoudizhuMove } from '@/services/doudizhu/game';
import { applyCoreDoudizhuTurn } from './doudizhuRules';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { coreMomentAudience, coreMomentReplyIdentity, selectCoreMomentPlan } from './momentRules';
import { applyCoreImageAction } from './imageActions';
import { applyStoryContentAction } from './storyContentActions';

export function applyPlayerAction(ctx: RuleContext, action: Extract<CoreAction, { kind: 'player' }>, policy: CoreRulePolicy): void {
  if (action.source.kind !== 'manual' || action.source.blocks.length !== 1 || action.source.blocks[0]!.kind !== 'configuration'
    || action.source.blocks[0]!.text !== stableJson(action.command) && action.source.blocks[0]!.text !== JSON.stringify(action.command)) throw Error('玩家操作必须有宿主冻结的完整指令来源。');
  const command = action.command.type === 'correct_event' ? action.command.command : action.command;
  if (command.type === 'memory_edit') {
    if (!command.text.trim() || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || command.pinned !== undefined && typeof command.pinned !== 'boolean'
      || command.importance !== undefined && (!Number.isFinite(command.importance) || command.importance < 0)) throw Error('记忆编辑内容、重要性或版本无效。');
    // Core records only the explicit request. Versioned memory is published separately.
  } else if (command.type === 'edit_npc') {
    const npc = ctx.get('npc', command.npcId);
    const originalImageBasics = JSON.stringify([npc.value.姓名, npc.value.appearance, npc.value.clothing]);
    if (command.field === '姓名') {
      if (npc.value.canonical || typeof command.value !== 'string' || !command.value.trim()) throw Error('原著姓名锁定，路人姓名不能为空。');
      if (ctx.state.records.some(r => r.domain === 'npc' && r.entityId !== npc.entityId && r.value.姓名 === command.value)) throw Error('姓名与其他人物冲突。');
      npc.value.姓名 = command.value;
    } else if (command.field === 'affinity') {
      if (typeof command.value !== 'number' || !Number.isFinite(command.value)) throw Error('好感度必须是数值。');
      npc.value.affinity = 限制NPC好感度(command.value); npc.value.relationship = 格式化NPC关系(npc.value.affinity, npc.value.intimate);
    } else if (command.field === 'archived') {
      if (typeof command.value !== 'boolean') throw Error('归档开关无效。');
      npc.value.archived = command.value;
    } else {
      if (!['appearance', 'clothing', 'personality', 'speechStyle', 'playerAddress'].includes(command.field) || typeof command.value !== 'string') throw Error('未注册的档案字段。');
      npc.value[command.field] = command.value;
    }
    if (originalImageBasics !== JSON.stringify([npc.value.姓名, npc.value.appearance, npc.value.clothing])) delete npc.value.visualArchive.englishFacts;
    if (!npc.value.playerCorrections.includes(`core2-manual:${command.field}`)) npc.value.playerCorrections.push(`core2-manual:${command.field}`);
    ctx.put(npc);
  } else if (command.type === 'edit_traveler') {
    const traveler = ctx.get('traveler');
    if (command.field === '年龄') {
      if (typeof command.value !== 'number' || !Number.isSafeInteger(command.value) || command.value < 0) throw Error('年龄无效。');
      traveler.value.年龄 = command.value;
    } else {
      if (!['姓名', '别名', '性别', '生日', '身高', '身份', '外貌', '性格', '背景'].includes(command.field) || typeof command.value !== 'string' || command.field === '姓名' && !command.value.trim()) throw Error('档案字段无效。');
      traveler.value[command.field] = command.value;
    }
    ctx.put(traveler);
  } else if (command.type === 'inventory') {
    const record = ctx.get('inventory', command.itemId);
    if (record.value.kind !== 'item' || !Number.isSafeInteger(command.quantity) || command.quantity <= 0 || command.quantity > record.value.quantity || !['consume', 'discard'].includes(command.action)) throw Error('物品数量不足或操作无效。');
    record.value.quantity -= command.quantity; record.value.status = record.value.quantity ? 'owned' : command.action === 'discard' ? 'discarded' : 'depleted'; ctx.put(record);
  } else if (command.type === 'contact') {
    const npc = ctx.get('npc', command.npcId), existing = ctx.state.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === npc.entityId);
    if (!['add', 'remove'].includes(command.action)) throw Error('未注册的联系人操作。');
    if (command.action === 'add' && !(npc.value.firstSeenTurn > 0 || npc.value.travelingTogether || npc.value.affinity > 0)) throw Error('尚未结识这位角色，不能凭图鉴添加联系人。');
    if (existing?.domain === 'courier' && existing.value.kind === 'contact') {
      const contact = ctx.get('courier', existing.entityId); if (contact.value.kind !== 'contact') throw Error('联系人资料无效。');
      contact.value.available = command.action === 'add'; contact.value.name = npc.value.姓名; ctx.put(contact);
    } else if (command.action === 'add') ctx.put({ scope: ctx.state.head.scope, domain: 'courier', entityId: `contact-${checksumUtf8(stableJson([ctx.state.head.scope, npc.entityId]))}`, version: 1,
      value: { kind: 'contact', npcId: npc.entityId, name: npc.value.姓名, remark: '', available: true } });
  } else if (command.type === 'conversation_create') {
    if (!command.name.trim() || !['private', 'group'].includes(command.conversationType) || new Set(command.memberIds).size !== command.memberIds.length
      || command.memberIds.length < (command.conversationType === 'group' ? 2 : 1) || command.conversationType === 'private' && command.memberIds.length !== 1
      || ctx.state.records.some(row => row.domain === 'courier' && row.entityId === command.conversationId)) throw Error('会话名称、成员或标识无效。');
    for (const id of command.memberIds) {
      ctx.get('npc', id);
      const contact = ctx.state.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === id && row.value.available);
      if (!contact) throw Error('只能与现有联系人建立会话。'); ctx.get('courier', contact.entityId);
    }
    ctx.put({ scope: ctx.state.head.scope, domain: 'courier', entityId: command.conversationId, version: 1,
      value: { kind: 'conversation', name: command.name.trim(), conversationType: command.conversationType, memberIds: command.memberIds, unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  } else if (command.type === 'contact_remark') {
    const contact = ctx.get('courier', command.contactId);
    if (contact.value.kind !== 'contact') throw Error('这不是联系人。');
    contact.value.remark = command.remark; ctx.put(contact);
  } else if (command.type === 'group') {
    const group = ctx.get('courier', command.conversationId);
    if (group.value.kind !== 'conversation' || group.value.conversationType !== 'group' || group.value.dissolved) throw Error('群聊不可用。');
    if (command.action === 'rename') { if (!command.name?.trim()) throw Error('群名不能为空。'); group.value.name = command.name.trim(); }
    else if (command.action === 'dissolve') group.value.dissolved = true;
    else {
      const npc = ctx.get('npc', command.npcId);
      if (command.action === 'add') {
        if (!ctx.state.records.some(r => r.domain === 'courier' && r.value.kind === 'contact' && r.value.npcId === npc.entityId && r.value.available)) throw Error('只能邀请现有联系人。');
        group.value.memberIds = [...new Set([...group.value.memberIds, npc.entityId])];
      } else if (command.action === 'remove') group.value.memberIds = group.value.memberIds.filter(id => id !== npc.entityId);
      else throw Error('未注册的群管理操作。');
    }
    ctx.put(group);
  } else if (command.type === 'conversation_read') {
    const conversation = ctx.get('courier', command.conversationId);
    if (conversation.value.kind !== 'conversation' || conversation.value.dissolved || conversation.version !== command.expectedVersion || !Number.isSafeInteger(command.throughSeq) || command.throughSeq < conversation.value.lastReadSeq || command.throughSeq > ctx.state.head.coreSeq) throw Error('会话有新消息或已变更，请重新打开后再标记已读。');
    conversation.value.unreadCount = 0; conversation.value.lastReadSeq = command.throughSeq; ctx.put(conversation);
  } else if (command.type === 'message') {
    const group = ctx.get('courier', command.conversationId);
    if (group.value.kind !== 'conversation' || group.value.dissolved || !command.text.trim()) throw Error('会话不可用或消息为空。');
    // The immutable manual source is the message; do not duplicate message history inside current state.
  } else if (command.type === 'moment') {
    const existing = ctx.state.records.find(r => r.domain === 'courier' && r.entityId === command.momentId);
    const traveler = ctx.get('traveler');
    if (existing && (existing.domain !== 'courier' || existing.value.kind !== 'moment' || existing.value.authorId !== traveler.entityId) || command.action === 'publish' && existing) throw Error('只能编辑自己的动态，发布不能覆盖已有记录。');
    if (command.action !== 'publish' && (!existing || existing.domain !== 'courier' || existing.value.kind !== 'moment')) throw Error('朋友圈记录不存在。');
    if (command.action === 'delete') {
      if (!existing) throw Error('朋友圈记录不存在。');
      ctx.changes.push({ ref: { domain: 'courier', entityId: existing.entityId, version: existing.version }, before: structuredClone(existing), after: null, effectKey: `${action.actionId}:courier:${existing.entityId}` }); return;
    }
    if (!command.text?.trim() && !command.imageAssetIds?.length) throw Error('朋友圈内容为空。');
    const allowed = coreMomentAudience(ctx.state);
    const visible = [...new Set(command.visibilityNpcIds ?? allowed)];
    for (const npcId of visible) {
      ctx.get('npc', npcId); if (!allowed.includes(npcId)) throw Error('动态受众必须是现有联系人或同行队员，且未被禁用或归档。');
    }
    for (const npcId of command.mentionedNpcIds ?? []) if (!visible.includes(npcId)) throw Error('被@角色必须能看到这条动态。');
    // Selection is part of the publication transaction, not an effect of rendering
    // the feed. Read the previous plan too, so concurrent posts cannot both reuse it.
    const prior = ctx.state.records.filter(row => row.domain === 'courier' && row.value.kind === 'moment').sort((a, b) =>
      (b.domain === 'courier' && b.value.kind === 'moment' ? b.value.commentPlanSeq ?? 0 : 0) - (a.domain === 'courier' && a.value.kind === 'moment' ? a.value.commentPlanSeq ?? 0 : 0))[0];
    const previous = prior?.domain === 'courier' && prior.value.kind === 'moment' ? prior.value.randomCommentNpcIds ?? [] : [];
    for (const row of ctx.state.records) if (row.domain === 'npc' || row.domain === 'courier' && (row.value.kind === 'contact' || row.entityId === prior?.entityId)) ctx.get(row.domain, row.entityId);
    const value = { kind: 'moment' as const, authorId: traveler.entityId, sourceRef: action.source.ref, imageAssetIds: command.imageAssetIds ?? [], mentionedNpcIds: [...new Set(command.mentionedNpcIds ?? [])], visibilityNpcIds: visible };
    const plan = selectCoreMomentPlan(ctx.state, action.actionId, value, previous);
    const commentReplies = plan.npcIds.map(npcId => { const { sourceId: _sourceId, ...identity } = coreMomentReplyIdentity(ctx.state.head.scope, command.momentId, action.source.ref, npcId); return identity; });
    ctx.put({ scope: ctx.state.head.scope, domain: 'courier', entityId: command.momentId, version: 1, value: { ...value, commentNpcIds: plan.npcIds, randomCommentNpcIds: plan.randomNpcIds, commentPlanSeq: ctx.state.head.coreSeq + 1, commentReplies } });
  } else if (command.type === 'image_bind' || command.type === 'image_delete' || command.type === 'image_profile_cache') {
    applyCoreImageAction(ctx, command);
  } else if (command.type === 'image') {
    const album = ctx.get('album', command.entryId); album.value.assetId = command.assetId; ctx.put(album);
  } else if (command.type === 'map') {
    const map = ctx.get('map', command.locationId);
    if (!map.value.visited) throw Error('不能通过手动地图入口凭空解锁地点。');
    const world = ctx.get('world'); world.value.moment.location = map.value.name; world.value.moment.locationId = map.entityId; world.value.region = map.value.region; ctx.put(world);
  } else if (command.type === 'element' || command.type === 'talent') {
    const traveler = ctx.get('traveler');
    if (command.type === 'element') {
      if (!traveler.value.元素共鸣.some(a => a.element === command.element && a.unlocked)) throw Error('元素尚未觉醒。');
      traveler.value.主元素 = command.element; ctx.put(traveler);
    } else applyCharacterRule(ctx, { candidateId: action.actionId, scope: action.source.scope, operationId: action.source.operationId, kind: 'talent', actors: [traveler.entityId], targets: [traveler.entityId], proposal: { kind: 'talent', talentId: command.talentId, element: command.element, level: command.level }, evidenceRefs: [], status: 'verified' }, policy);
  } else if (command.type === 'doudizhu_start') {
    command.npcIds.forEach(id => { if (ctx.get('npc', id).value.archived) throw Error('不能邀请已归档角色。'); });
    const record = ctx.get('doudizhu');
    if (record.value.currentGame && record.value.currentGame.phase !== 'finished') throw Error('已有未结束牌局。');
    const { publicLog: _publicLog, ...game } = startDoudizhuGame(command.npcIds, command.seed, command.gameId);
    record.value.currentGame = game; ctx.put(record);
  } else if (command.type === 'doudizhu_turn' || command.type === 'doudizhu_abandon') {
    applyCoreDoudizhuTurn(ctx, command);
  } else if (command.type === 'doudizhu_move') {
    const record = ctx.get('doudizhu');
    if (!record.value.currentGame) throw Error('没有进行中的牌局。');
    const old = record.value.currentGame;
    const { publicLog: _publicLog, ...game } = applyDoudizhuMove({ ...old, publicLog: [] }, command.move);
    if (game.phase === 'finished' && !old.settled) {
      game.settled = true;
      for (const id of game.npcIds) { const npc = ctx.get('npc', id); npc.value.affinity = 限制NPC好感度(npc.value.affinity + 5); npc.value.relationship = 格式化NPC关系(npc.value.affinity, npc.value.intimate); ctx.put(npc); }
    }
    record.value.currentGame = game; ctx.put(record);
  } else if (command.type === 'story_content') {
    applyStoryContentAction(ctx, command, policy);
  } else if (command.type === 'story_edit') {
    const story = ctx.get('story');
    const node = policy.storyNodes.find(n => n.seriesId === command.seriesId && n.nodeId === command.nodeId);
    if (!node || node.chapterId !== command.chapterId) throw Error('剧情资料节点无效。');
    story.value.seriesId = node.seriesId; story.value.chapterId = node.chapterId; story.value.nodeId = node.nodeId; story.value.status = 'progressing'; ctx.put(story);
  } else throw Error('未注册的玩家操作。');
}
