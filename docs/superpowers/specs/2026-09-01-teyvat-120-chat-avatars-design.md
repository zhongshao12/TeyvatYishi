# 提瓦特 120 名角色聊天头像设计规格

## 目标

为聊天系统制作 120 张原创角色头像，覆盖当前口径下 69 名五星与 51 名四星可玩角色。头像应在小尺寸和圆形裁切下仍能一眼识别角色，并尽量降低静态资源体积。

## 已确认的视觉基准

- 以已获确认的安柏样张为唯一风格基准。
- 日式西幻、温暖冒险者手账、轻手绘动画质感。
- 头肩近景，脸部与发型占画面约 65% 至 70%。
- 保留发型、头饰、服装轮廓、主色与角色标志物等高辨识度特征。
- 简洁的圆形或柔和渐变背景，只使用一个弱化的元素纹样。
- 不出现文字、Logo、水印、UI 边框、复杂场景或密集粒子。
- 重要特征避开四角与外沿，保证圆形裁切安全。

## 文件标准

- 最终格式：WebP。
- 固定尺寸：256 × 256。
- 推荐编码：quality 78、effort 6、smart subsample。
- 目标体积：单张优先控制在 10–25 KiB；辨识度优先于硬性体积上限。
- 五星路径：`public/assets/teyvat-avatars/characters/5-star/<slug>.webp`。
- 四星路径：`public/assets/teyvat-avatars/characters/4-star/<slug>.webp`。
- 生成原图来自内置图像生成工具，项目只保存压缩后的最终头像。

## 名单与边界

- 名单基线：2026-08-19 更新的 GachaTracker 角色页，统计 69 名五星、51 名四星。
- `Traveler` 按名单保留为一个通用旅行者条目，不覆盖项目中的自定义旅行者身份。
- `Wonderland Manekin` 按名单保留。
- 安柏为已经确认的完成资产，其余 119 张沿用相同标准。
- 不复制游戏官方头像或第三方 fan art；每张均为原创生成的非官方同人头像。

## 生产与验收

每个角色使用独立提示词生成，不能用一次多图变体代替不同角色。原图生成后统一缩放、编码，并进行：

1. 尺寸、格式、文件可读性和文件体积自动检查。
2. 逐张检查脸部清晰度、角色辨识特征和圆形裁切安全。
3. 生成联系表，检查整套构图、背景复杂度和色彩一致性。
4. 清单精确计数为 120，路径不重复，清单中没有缺图。
5. 聊天头像解析对角色英文名、现有中文名及别名进行匹配。

## 提示词骨架

```text
Use case: stylized-concept
Asset type: compact square chat avatar
Primary request: original fan-art portrait of <character>
Subject: preserve <character-specific iconic cues>
Style/medium: crisp Japanese fantasy anime illustration with warm painted storybook texture, matching the approved Amber avatar
Composition/framing: centered head-and-shoulders, face and hair fill 65–70%, circular-crop-safe
Scene/backdrop: simple warm circular or soft gradient backdrop with one subtle elemental motif
Constraints: instantly recognizable at 64 px; no text, logo, watermark, UI frame; no copied official artwork
Avoid: full body, busy background, dense particles, tiny low-value details, cropped headwear
```
