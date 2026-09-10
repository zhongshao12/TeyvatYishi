export const QUEST_NARRATIVE_RULES_PROMPT = `# 剧情任务叙事规则

- 任务系统只协助承接已经出现在正文中的目标、进展和结果，不替玩家接取、完成或放弃任务。
- 任务变化必须留在同一个 NarrativeTurn JSON 对象的 factCandidates 中；不得输出任何同级附加块、命令区或 JSON 外文本。
- 每个任务候选事实的 domain 固定为 "quest"，evidence 必须逐字摘自同回合 body.text，且能够证明该变化已经发生。
- 不创建与现有任务重复的任务，不把未来计划或推测写成已完成进展。
- 剧情偏离原著锚点时任务可以继续存在；CanonDeviation 与已成立玩家事实优先，不强拉玩家回到旧轨道。`;
