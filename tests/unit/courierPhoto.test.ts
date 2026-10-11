import { describe, expect, it } from 'vitest';
import { normalizeCourierConversation } from '@/models/teyvat/courier';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { 创建相册图片条目 } from '@/utils/albumActions';
import { resolveCourierPhotoTarget, attachCourierPhoto, commitCourierPhotoToGame, readCourierPhotoContext, listCourierPhotoCandidates, sanitizeCourierPhotoText, sameCourierPhotoTarget } from '@/services/courierPhoto';

const raw = () => ({ id: 'chat', title: '安柏', type: 'private', participantIds: ['player', 'contact'], messages: [{ id: 'reply', senderId: 'contact', senderName: '安柏', role: 'assistant', content: '给你看看城门的花。', turn: 2, timestamp: 2, readBy: [], photo: { entryId: 'entry', assetId: 'asset', npcId: 'amber', url: 'data:image/png;base64,unwanted' } }], unread: 0, typingMemberIds: [], updatedAt: 2 });

describe('phone photo persistence', () => {
  it('retains only an album reference across load, without copying image payload or replacing text', () => {
    const loaded = normalizeCourierConversation(JSON.parse(JSON.stringify(raw())))!;
    expect(loaded.messages[0]).toHaveProperty('photo', { entryId: 'entry', assetId: 'asset', npcId: 'amber' });
    expect(loaded.messages[0]?.content).toBe('给你看看城门的花。');
  });

  it('drops malformed photo references rather than displaying unrelated resources', () => {
    const value = raw();
    value.messages[0]!.photo.assetId = '';
    expect(normalizeCourierConversation(value)?.messages[0]).not.toHaveProperty('photo');
  });
});

const fixture = () => {
  const game = createEmptyTeyvatGameState();
  game.NPC = normalizeTeyvatNpcRecords([{ id: 'amber', name: '安柏', gender: '女', tier: 'companion', affinity: 30 }]);
  const chat = normalizeCourierConversation(raw())!;
  delete chat.messages[0]!.photo;
  game.手机.contacts = [{ id: 'contact', name: '备注不当身份', npcId: 'amber', available: true }];
  game.手机.conversations = [chat];
  return game;
};

describe('phone photo target and atomic commit', () => {
  it('reads only the selected conversation and sender up to that reply, not future or other private chat', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '拍张城门的花的照片。', timestamp: 1 });
    const target = resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')!.target;
    chat.messages.unshift({ ...chat.messages[0]!, id: 'other-member', senderId: 'other', content: '别人的秘密' });
    chat.messages.push({ ...chat.messages[2]!, id: 'future', content: '未来消息' });
    game.手机.conversations.push({ ...chat, id: 'other-private', messages: [{ ...chat.messages[2]!, content: '另一私聊秘密' }] });
    const context = readCourierPhotoContext(game.手机, target);
    expect(context).toContain('城门的花');
    expect(context).not.toMatch(/别人的秘密|未来消息|另一私聊秘密/);
    expect(context).not.toContain('给你看看');
  });
  it('never substitutes NPC dialogue for an uncertain player photo request', () => {
    const game = fixture();
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', 'reply')!.target;
    expect(readCourierPhotoContext(game.手机, target)).toBe('');
  });
  it('freezes a provable legacy generated request and rejects attachment when that request disappears', () => {
    const game = fixture(); const chat = game.手机.conversations[0]!;
    chat.messages[0]!.id = 'courier_reply_ask_0';
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '拍张城门照片', timestamp: 1 });
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', 'courier_reply_ask_0')!.target;
    expect(readCourierPhotoContext(game.手机, target)).toContain('城门');
    expect(target.requestFingerprint).toBeTruthy();
    chat.messages.push({ ...chat.messages[0]!, id: 'next', content: '新消息', timestamp: 3 });
    expect(sameCourierPhotoTarget(target, resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', target.messageId)!.target)).toBe(true);
    chat.messages.shift();
    expect(resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', target.messageId)).toBeNull();
    expect(attachCourierPhoto(game.手机, target, { entryId: 'e', assetId: 'a', npcId: 'amber' })).toBe(game.手机);
  });
  it.each(['missing', 'empty', 'removed-owner', 'oversized', 'malformed', 'wrong-batch', 'empty-binding', 'malformed-binding'] as const)('fails closed for explicit replies with %s completion evidence after reload', kind => {
    const game = fixture(); const chat = game.手机.conversations[0]!; const old = chat.messages[0]!;
    const ids = ['courier_group_reply_ask_contact', 'courier_group_reply_ask_other'];
    chat.type = 'group'; chat.participantIds.push('other');
    chat.messages = [
      { ...old, id: 'ask', senderId: 'player', role: 'user', content: '拍张照片', timestamp: 1 },
      { ...old, id: ids[0]!, replyToMessageIds: ['ask'], expectedReplyIds: ids },
      { ...old, id: ids[1]!, senderId: 'other', replyToMessageIds: ['ask'] },
    ];
    if (kind === 'missing') delete chat.messages[1]!.expectedReplyIds;
    if (kind === 'empty') chat.messages[1]!.expectedReplyIds = [];
    if (kind === 'removed-owner') chat.messages.splice(1, 1);
    if (kind === 'oversized') chat.messages[1]!.expectedReplyIds = Array.from({ length: 121 }, (_, index) => `reply_${index}`);
    if (kind === 'malformed') (chat.messages[1] as unknown as { expectedReplyIds: unknown }).expectedReplyIds = [null];
    if (kind === 'wrong-batch') chat.messages[2]!.replyToMessageIds = ['missing'];
    if (kind === 'empty-binding') chat.messages[1]!.replyToMessageIds = [];
    if (kind === 'malformed-binding') (chat.messages[1] as unknown as { replyToMessageIds: unknown }).replyToMessageIds = [null];
    game.手机.conversations = [normalizeCourierConversation(JSON.parse(JSON.stringify(chat)))!];
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toEqual([]);
    expect(resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', ids[0]!)).toBeNull();
  });
  it('reuses one batch lookup when listing 120 responders instead of rescanning all history per target', () => {
    const game = fixture(); const chat = game.手机.conversations[0]!; const old = chat.messages[0]!;
    const members = Array.from({ length: 120 }, (_, index) => `member${index}`);
    const expected = members.map(member => `courier_group_reply_ask_${member}`);
    const npcs = members.map(id => ({ id, 姓名: id }));
    game.手机.contacts = members.map(id => ({ id, name: id, npcId: id, available: true }));
    chat.type = 'group'; chat.participantIds = ['player', ...members];
    chat.messages = [
      ...Array.from({ length: 200 }, (_, index) => ({ ...old, id: `history${index}`, senderId: index % 2 ? 'contact' : 'player', role: index % 2 ? 'contact' : 'user', turn: index, timestamp: index })),
      { ...old, id: 'ask', senderId: 'player', role: 'user', content: '拍张照片', turn: 201, timestamp: 201 },
      ...members.map((member, index) => ({ ...old, id: expected[index]!, senderId: member, turn: 201, timestamp: 202, replyToMessageIds: ['ask'], ...(index ? {} : { expectedReplyIds: expected }) })),
    ];
    let idReads = 0;
    for (const message of chat.messages) { const id = message.id; Object.defineProperty(message, 'id', { get: () => { idReads++; return id; } }); }
    expect(listCourierPhotoCandidates(game.手机, npcs, 'chat')).toHaveLength(120);
    expect(idReads).toBeLessThan(25000);
  });
  it('retains subsequent scene requirements but not unrelated player chatter', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '今天午饭很好吃。帮我拍张照片。站在城门下，背景是鲜花。', timestamp: 1 });
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', 'reply')!.target;
    expect(readCourierPhotoContext(game.手机, target)).toContain('站在城门下');
    expect(readCourierPhotoContext(game.手机, target)).not.toContain('午饭');
  });
  it('extracts photoask then thanks only from an explicit stored reply batch and freezes that request', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift(...['ask', 'thanks'].map((id, index) => ({ ...chat.messages[0]!, id, senderId: 'player', role: 'user', content: index ? '谢谢' : '拍张城门的照片', timestamp: index })));
    chat.messages[2]!.id = 'courier_reply_thanks_0';
    chat.messages[2]!.replyToMessageIds = ['ask', 'thanks'];
    chat.messages[2]!.expectedReplyIds = [chat.messages[2]!.id];
    const loaded = normalizeCourierConversation(JSON.parse(JSON.stringify(chat)))!;
    expect(loaded.messages[2]?.replyToMessageIds).toEqual(['ask', 'thanks']);
    game.手机.conversations = [loaded];
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', loaded.messages[2]!.id)!.target;
    expect(readCourierPhotoContext(game.手机, target)).toBe('拍张城门的照片');
    loaded.messages[2]!.replyToMessageIds = ['thanks'];
    const rebound = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', loaded.messages[2]!.id)!.target;
    expect(sameCourierPhotoTarget(target, rebound)).toBe(false);
    expect(attachCourierPhoto(game.手机, target, { entryId: 'e', assetId: 'a', npcId: 'amber' })).toBe(game.手机);
    loaded.messages[2]!.replyToMessageIds = ['ask', 'thanks'];
    loaded.messages.shift();
    expect(resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', loaded.messages[1]!.id)).toBeNull();
  });
  it('keeps photo clauses while removing relation and private metadata from manual edits', () => {
    expect(sanitizeCourierPhotoText('golden sunlight, 好感度: 90, 湖边散步, NSFW档案: 秘密, char_seven: 1 2 3 4 5 6 7')).toBe('golden sunlight, 湖边散步');
  });
  it('fails closed for ambiguous legacy replies after consecutive player inputs', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift(...['ask', 'new-ask'].map((id, index) => ({ ...chat.messages[0]!, id, senderId: 'player', role: 'user', content: '拍张照片', timestamp: index })));
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', 'reply')!.target;
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toHaveLength(0);
    expect(readCourierPhotoContext(game.手机, target)).toBe('');
  });
  it('never uses an intermediate legacy contact bubble as proof that an older same-turn request completed', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    const reply = chat.messages[0]!;
    chat.messages = [
      { ...reply, id: 'old-ask', senderId: 'player', role: 'user', content: '拍张城门照片', timestamp: 1 },
      { ...reply, id: 'first-part', content: '稍等', timestamp: 2 },
      { ...reply, id: 'new-ask', senderId: 'player', role: 'user', content: '拍张湖边照片', timestamp: 3 },
      { ...reply, id: 'old-late', content: '城门的照片', timestamp: 4 },
    ];
    const target = resolveCourierPhotoTarget(game.手机, game.NPC, 'chat', 'old-late')!.target;
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toEqual([]);
    expect(readCourierPhotoContext(game.手机, target)).toBe('');
  });
  it('offers only actual valid group responders and consumes a member once per exchange', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.type = 'group'; chat.participantIds.push('silent');
    game.手机.contacts.push({ id: 'silent', npcId: 'lisa', name: '丽莎', available: true });
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '拍张照片', timestamp: 1 });
    const npcs = [...game.NPC, { id: 'lisa', 姓名: '丽莎' }];
    expect(listCourierPhotoCandidates(game.手机, npcs, 'chat').map(item => item.npc.id)).toEqual(['amber']);
    chat.messages[1]!.photo = { entryId: 'e', assetId: 'a', npcId: 'amber' };
    chat.messages.push({ ...chat.messages[1]!, id: 'reply2', photo: undefined });
    expect(listCourierPhotoCandidates(game.手机, npcs, 'chat')).toEqual([]);
  });
  it('does not mistake a proactive delivery for a reply to a pending player input', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '拍张照片', timestamp: 1 });
    chat.messages[1]!.sourceSeedId = 'proactive-seed';
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toEqual([]);
  });
  it('exposes only actual replies to the latest completed player exchange', () => {
    const game = fixture();
    const chat = game.手机.conversations[0]!;
    chat.messages.unshift({ ...chat.messages[0]!, id: 'ask', senderId: 'player', role: 'user', content: '拍张照片', timestamp: 1 });
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toHaveLength(1);
    chat.typingMemberIds = ['contact'];
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toHaveLength(0);
    chat.typingMemberIds = [];
    chat.messages.splice(1, 0, { ...chat.messages[0]!, id: 'new-ask', timestamp: 3 });
    chat.messages[2]!.id = 'courier_reply_ask_0';
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toHaveLength(0);
    chat.messages[2]!.id = 'courier_reply_new-ask_0';
    expect(listCourierPhotoCandidates(game.手机, game.NPC, 'chat')).toHaveLength(1);
  });
  it('accepts the live phone service contact role, but never user or system notices', () => {
    const game = fixture();
    const message = game.手机.conversations[0]!.messages[0]!;
    message.role = 'contact';
    expect(resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')).not.toBeNull();
    message.role = 'system';
    expect(resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')).toBeNull();
  });
  it('resolves a group photo only to the actual sender NPC, with no name guessing', () => {
    const game = fixture();
    game.手机.conversations[0]!.type = 'group';
    const resolved = resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply');
    expect(resolved?.npc.姓名).toBe('安柏');
    expect(resolved?.target.npcId).toBe('amber');
    game.手机.contacts[0]!.npcId = 'missing';
    expect(resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')).toBeNull();
    game.手机.conversations[0]!.messages[0]!.senderId = 'player';
    expect(resolveCourierPhotoTarget(game.手机, [{ id: 'player', 姓名: '玩家' }], 'chat', 'reply')).toBeNull();
  });

  it('commits photo and album together while preserving messages appended during generation', () => {
    const game = fixture();
    const resolved = resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')!;
    game.手机.conversations[0]!.messages.push({ id: 'later', senderId: 'player', senderName: '云', role: 'user', content: '谢谢！', turn: 3, timestamp: 3, readBy: [] });
    const image = 创建相册图片条目({ title: '手机照片', src: 'https://example.invalid/photo.png', source: 'generated', targetType: 'npc', targetId: 'amber', slot: 'misc' });
    const next = commitCourierPhotoToGame(game, resolved.target, image);
    expect(next.相册.assets[0]?.id).toBe(image.asset.id);
    expect(next.相册.entries[0]?.assetId).toBe(image.asset.id);
    expect(next.手机.conversations[0]?.messages[0]?.photo?.assetId).toBe(image.asset.id);
    expect(next.手机.conversations[0]?.messages[1]?.content).toBe('谢谢！');
    expect(next.手机.conversations[0]?.messages[0]?.content).toBe('给你看看城门的花。');
    expect(next.NPC).toBe(game.NPC);
    expect(commitCourierPhotoToGame(next, resolved.target, image)).toBe(next);
  });

  it('rejects stale, removed or rebound targets without adding orphan album images', () => {
    const mutations = [
      (game: ReturnType<typeof fixture>) => { game.手机.conversations = []; },
      (game: ReturnType<typeof fixture>) => { game.手机.contacts[0]!.npcId = 'other'; },
      (game: ReturnType<typeof fixture>) => { game.手机.contacts[0]!.available = false; },
      (game: ReturnType<typeof fixture>) => { game.手机.conversations[0]!.messages[0]!.content = '变了'; },
      (game: ReturnType<typeof fixture>) => { game.NPC = []; },
    ];
    for (const mutate of mutations) {
      const game = fixture();
      const target = resolveCourierPhotoTarget(game.手机, [{ id: 'amber', 姓名: '安柏' }], 'chat', 'reply')!.target;
      mutate(game);
      const image = 创建相册图片条目({ title: '照片', src: 'https://example.invalid/photo.png', source: 'generated', targetType: 'npc', targetId: 'amber' });
      expect(commitCourierPhotoToGame(game, target, image)).toBe(game);
      if (game.NPC.length) expect(attachCourierPhoto(game.手机, target, { entryId: 'e', assetId: 'a', npcId: 'amber' })).toBe(game.手机);
    }
  });
});
