export const DOMAIN_COMMAND_OUTPUT_FORMAT_PROMPT = `# 领域事实 JSON 输出契约

只输出一个合法 JSON 对象，不要 Markdown、XML 标签、解释或额外文本：
{"facts":[{"type":"location","location":"蒙德·风起地","evidence":"安柏领着旅行者抵达风起地的大树下"}]}

没有可落库事实时输出：{"facts":[]}

约束：
- facts 必须是数组；每条事实必须有正式 type 和非空 evidence。
- npc 的 name 必填；memory 必须是字符串摘要。
- item.action 只能为 gain / consume / give / lose。获得物品例如 {"type":"item","action":"gain","category":"food","name":"提瓦特煎蛋","rarity":1,"quantity":2,"evidence":"凯瑟琳交付了两份提瓦特煎蛋"}；使用或交出物品例如 {"type":"item","action":"give","name":"提瓦特煎蛋","quantity":1,"evidence":"旅行者把一份提瓦特煎蛋交给安柏"}。
- item.category 只能为 weapon / artifact / food / material / gadget / quest / furnishing；quantity 为正整数。只有 gain 必须带 category 与 1..5 的 rarity。
- npc 在约定明确完成、取消或失效时用 resolvedItems 列出要从旧 openItems 移除的内容。
- artifact 的 artifactSlot 只能为 flower / plume / sands / goblet / circlet；坐标、路线、权限、口令、消息和情报等信息不是实体物品，不得写入背包。
- 不输出调试过程、内部推理、旧路径命令或第二个载荷。`;
