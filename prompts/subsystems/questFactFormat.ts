export const QUEST_FACT_FORMAT_PROMPT = `# 剧情任务 factCandidates 格式

任务变化只作为 NarrativeTurn.factCandidates 数组中的对象输出：
{"domain":"quest","fact":"任务动作: 参数","evidence":"逐字摘自 body.text 的非空片段"}

fact 允许以下语法：
- 接取: 任务标题|任务描述|来源
- 目标: 任务标题|目标类型|目标描述|目标数量|关联对象
- 进展: 任务标题|目标ID|新数量
- 完成: 任务标题
- 放弃: 任务标题

目标类型仅限达成、收集、交谈、前往、击杀、时间；来源仅限主线、支线、自定义、来信。每回合最多一个接取事实和两个目标事实。没有已被 body 证实的变化时，不生成 quest 候选事实。`;
