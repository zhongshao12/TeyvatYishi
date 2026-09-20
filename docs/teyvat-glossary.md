# 提瓦特术语词典（Teyvat Glossary）

> M0 产物 · v0.1 · 确认日期 2026-08-02
> 用途：原神化改造的冻结词典。所有面向用户的文案、提示词、数据展示字段以此为准；内部标识按第 8 节稳定清单保持不变。

## 1 项目与玩家

| 崩铁（原） | 原神（新） |
| --- | --- |
| 开拓轶事 / KaiTuoYiShi | 旅行者纪事 / TeyvatYishi（展示名） |
| 开拓者 / 旅人 | 旅行者（空 / 荧 或自定义） |
| 星穹列车 | 旅途 / 风之翼 |
| 黑塔空间站 | 蒙德（开局主舞台） |
| 无名客 | 冒险家 |
| 史官（向导步骤） | 开局锚点 / 介入方式 |

## 2 力量体系

| 崩铁（原） | 原神（新） |
| --- | --- |
| 命途 | 元素共鸣（神之眼） |
| 星神 | 尘世七执政 / 天理 |
| 命途觉醒 | 元素觉醒 |
| 命途狭间 | 元素回响 / 意识空间 |
| 命途阶段（浅涉→令使） | 元素共鸣阶段（微光→共鸣→精通→神选→权柄） |
| 战技 | 天赋（普通攻击 / 元素战技 / 元素爆发 / 固有天赋） |
| 光锥 | 圣遗物 |
| 命途特质 | 元素特质 / 元素反应倾向 |

命途 → 元素映射（M0 建议值，实施前可微调）：

| 原命途 ID | 新元素 ID | 新名称 | 意象 |
| --- | --- | --- | --- |
| hunt | electro | 雷 | 迅雷追猎、速度 |
| destruction | pyro | 火 | 灼烧、破坏 |
| preservation | geo | 岩 | 坚固、守护 |
| abundance | dendro | 草 | 生长、治愈 |
| remembrance | cryo | 冰 | 凝固、留存 |
| erudition | hydro | 水 | 流动、渗透 |
| elation | anemo | 风 | 自由、轻快 |
| harmony | —— | 展示移除 | 类型保留兼容旧档 |
| nihility | abyss | 深渊 | 虚无、禁忌 |
| none | none | 无神之眼 | 保持原样 |

> 实施落地（2026-08-02）：元素选择列表为「无神之眼 + 七元素 + 深渊」共 9 项；`harmony` 不再展示。

## 3 系统与组织

| 崩铁（原） | 原神（新） |
| --- | --- |
| 伙伴 | 同伴 / 角色档案 |
| 手机 | 信使（冒险家协会信件 + 派蒙通讯） |
| 新闻 / 星际和平周报 | 新闻 / 蒸汽鸟报 |
| 忆庭 | 世界树 · 记忆库 |
| 智库 | 图鉴 / 教令院资料库 |
| 如我所书 | 提瓦特之书 |
| 时间线 | 纪年 / 旅行日志 |
| 开拓任务 | 魔神任务 |
| 天才俱乐部 | 教令院 / 西风骑士团等 |
| 星际和平公司 | 愚人众 / 冒险家协会（按剧情） |
| 星核猎手 | 深渊教团（反派位） |
| 仙舟联盟 | 璃月七星 / 千岩军 |

## 4 背包物品与品质

| 原分类 | 新分类 |
| --- | --- |
| food | 料理 |
| consumable | 消耗品 |
| lightcone | 圣遗物 |
| weapon | 武器 |
| clothing | 风之翼 / 衣装 |
| accessory | 小道具 / 饰品 |
| memento | 纪念品 |
| key | 关键道具 |

品质：蓝 / 紫 / 金 → 三星 / 四星 / 五星（色值 #54A4B4 / #9174A9 / #DCA454）。

## 5 阵营 ID

none、favonius_knights（西风骑士团）、liyue_qixing（璃月七星）、inazuma_shogunate（稻妻幕府）、sangonomiya_resistance（海祇反抗军）、sumeru_akademiya（教令院）、fontaine_court（枫丹廷）、natlan_tribes（纳塔部族）、adventurers_guild（冒险家协会）、fatui（愚人众）、abyss_order（深渊教团）、treasure_hoarders（盗宝团）。

## 6 UI 主题

mondstadt 蒙德晨风、liyue 璃月金砂、inazuma 稻妻紫雷、sumeru 须弥翠影、fontaine 枫丹水蓝、natlan 纳塔赤焰。风格基调：日式西幻（羊皮纸 / 魔法书 + 蓝紫魔法光 + 金色描边 + 元素纹章）。

## 7 禁止词与白名单

业务文案 / 提示词 / 内置数据禁止出现：开拓、星穹、黑塔空间站、命途（作为力量系统名）、光锥、星际和平、忆庭、列车长、命途行者、令使、战技（作为系统名）。

白名单（允许保留）：旧档说明、历史文档、内部标识（kaituoyishi 等）、回归脚本断言、`.desktop-release` 等基础设施产物。

## 8 内部标识稳定清单（不改）

- package.json name：`kaituoyishi`
- Tauri productName 暂保持「开拓轶事」、identifier：`com.kaituoyishi.desktop`
- Wrangler 项目名 / KV：`kaituoyishi`、`kaituoyishi/online`
- 桌面存储 kind：`kaituoyishi-desktop-*`
- GitHub OAuth origin：`https://kaituoyishi.pages.dev`

## 9 变更记录

- 2026-08-02 v0.1：确认改造总纲不变；UI 风格为日式西幻；素材与合规不变；实施节奏 M0–M7 确认。