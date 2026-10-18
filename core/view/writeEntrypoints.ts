import type { BasicPlayerCommand } from '../settlement/actions';

/** Closed UI write inventory. New command types must declare their owning entry;
 * this is a route map, never a substitute for repository/session validation. */
export const CORE_COMMAND_ENTRIES = {
  edit_traveler: { feature: '旅人资料', method: 'command' },
  edit_npc: { feature: '同伴资料与关系', method: 'command' },
  inventory: { feature: '背包', method: 'command' },
  contact: { feature: '联系人管理', method: 'command' },
  contact_remark: { feature: '联系人备注', method: 'command' },
  conversation_create: { feature: '建立私聊与群聊', method: 'command' },
  conversation_read: { feature: '已读标记', method: 'command' },
  group: { feature: '群聊管理', method: 'command' },
  moment: { feature: '朋友圈发布与评论', method: 'command' },
  image_bind: { feature: '头像与立绘绑定', method: 'command' },
  image_delete: { feature: '相册移除', method: 'command' },
  image_profile_cache: { feature: '固定英文资料', method: 'command' },
  map: { feature: '已到访地图', method: 'command' },
  element: { feature: '元素', method: 'command' },
  talent: { feature: '天赋', method: 'command' },
  doudizhu_start: { feature: '建立牌局', method: 'command' },
  doudizhu_turn: { feature: '牌局出牌与结算', method: 'command' },
  doudizhu_abandon: { feature: '退出牌局', method: 'command' },
  story_edit: { feature: '剧情节点', method: 'command' },
  story_content: { feature: '剧情资源逐字段编辑', method: 'command' },
  message: { feature: '手机发送', method: 'sendPhone' },
  memory_edit: { feature: '记忆编辑', method: 'editMemory' },
  image: { feature: '图片上传或生成', method: 'uploadImage / requestImage' },
  doudizhu_move: { feature: '带版本保护的牌局操作', method: 'doudizhu_turn' },
} as const satisfies Record<BasicPlayerCommand['type'], { feature: string; method: string }>;

export const CORE_DIRECT_WRITE_ENTRIES = {
  journey: ['initialize', 'attach'],
  mainAndQuestSettlement: ['send', 'retry', 'cancel', 'review'],
  phoneAndNpcReplies: ['sendPhone', 'retryJob', 'stopJob'],
  publicNews: ['requestNews'],
  images: ['prepareImage', 'uploadImage', 'requestImage'],
  publicProfile: ['completeNpcProfile'],
  savesAndBranches: ['save', 'saveAutomatic', 'restore'],
  memoryAndIrminsul: ['previewMaintenance', 'runMaintenance', 'editMemory'],
} as const;
