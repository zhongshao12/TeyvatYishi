# Regional Backgrounds and Ancient Gods Portraits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate three compact regional backgrounds and two compact ancient-Sumeru character portraits in the approved travel-journal style.

**Architecture:** Each deliverable is generated independently with the built-in image generator, then converted into a deterministic project-local WebP asset with Sharp. Existing regional backgrounds remain unchanged; new files use `-v2` names. A final metadata and visual pass verifies size, format, compression, and recognizability.

**Tech Stack:** Built-in `image_gen`, Node.js, Sharp 0.34.5, WebP.

---

The workspace has no Git metadata. Commit steps are therefore replaced with explicit file and audit checkpoints.

### Task 1: Generate the three regional backgrounds

**Files:**
- Create: `public/assets/backgrounds/liyue-v2.webp`
- Create: `public/assets/backgrounds/natlan-v2.webp`
- Create: `public/assets/backgrounds/snezhnaya-v2.webp`

- [x] **Step 1: Generate Liyue independently**

Use built-in `image_gen` with a 16:9 Japanese-fantasy travel-journal landscape: golden-hour karst pillars and cloud sea, tiered Liyue-style pavilions, harbor lights and red lantern accents; no foreground character, text, logo, watermark, border, black corners, or transparent corners.

- [x] **Step 2: Generate Natlan independently**

Use built-in `image_gen` with a 16:9 Japanese-fantasy travel-journal landscape: volcanic canyon, distant lava glow, tribal totems and colorful woven banners, tiny distant saurian silhouettes; red-orange-charcoal palette with turquoise accents; no foreground character, text, logo, watermark, border, black corners, or transparent corners.

- [x] **Step 3: Generate Snezhnaya independently**

Use built-in `image_gen` with a 16:9 Japanese-fantasy travel-journal landscape: snowstorm city, grand icy spires and palace, aurora, blue-silver palette with warm amber windows; no foreground character, text, logo, watermark, border, black corners, or transparent corners.

- [x] **Step 4: Convert each generated PNG to compact WebP**

For each source file, run the equivalent of:

```js
await sharp(source)
  .resize(1672, 941, { fit: 'cover', position: 'attention' })
  .webp({ quality: 72, effort: 6, smartSubsample: true })
  .toFile(output);
```

Expected: each output is 1672 × 941 WebP, preferably 80–180 KiB and never above 300 KiB.

### Task 2: Generate the two ancient-Sumeru portraits

**Files:**
- Create: `public/assets/teyvat-avatars/characters/5-star/greater-lord-rukkhadevata.webp`
- Create: `public/assets/teyvat-avatars/characters/5-star/goddess-of-flowers.webp`

- [x] **Step 1: Generate Greater Lord Rukkhadevata independently**

Use built-in `image_gen` for a square Japanese-fantasy storybook chat portrait: adult goddess, long white-and-leaf-green hair, branch-and-leaf crown, green-and-gold divine robes, soft Dendro tree-canopy halo, compassionate and majestic expression; centered head and shoulders, face and hair occupy 65–70%, circular-crop safe, warm opaque cream paper background; no text, logo, watermark, UI frame, black corners, or transparent corners.

- [x] **Step 2: Generate the Goddess of Flowers independently**

Use built-in `image_gen` for a square Japanese-fantasy storybook chat portrait: ancient Sumeru flower goddess, long pale pink-lilac hair, lotus-and-flower crown, white-blue-rose-gold divine robes, moonlit desert flower halo, gentle mysterious expression; centered head and shoulders, face and hair occupy 65–70%, circular-crop safe, warm opaque cream paper background; no text, logo, watermark, UI frame, black corners, or transparent corners.

- [x] **Step 3: Convert each generated PNG to compact WebP**

For each source file, run the equivalent of:

```js
await sharp(source)
  .resize(256, 256, { fit: 'cover', position: 'attention' })
  .webp({ quality: 78, effort: 6, smartSubsample: true })
  .toFile(output);
```

Expected: each output is 256 × 256 WebP, preferably 10–30 KiB and never above 100 KiB.

### Task 3: Verify the five assets

**Files:**
- Verify: all five files created in Tasks 1–2

- [x] **Step 1: Run metadata validation**

```powershell
node --input-type=module -e "import sharp from './node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js'; import fs from 'node:fs'; const files=['public/assets/backgrounds/liyue-v2.webp','public/assets/backgrounds/natlan-v2.webp','public/assets/backgrounds/snezhnaya-v2.webp','public/assets/teyvat-avatars/characters/5-star/greater-lord-rukkhadevata.webp','public/assets/teyvat-avatars/characters/5-star/goddess-of-flowers.webp']; for(const file of files){const meta=await sharp(file).metadata(); console.log({file,width:meta.width,height:meta.height,format:meta.format,bytes:fs.statSync(file).size,hasAlpha:meta.hasAlpha});}"
```

Expected: three 1672 × 941 WebPs below 300 KiB; two 256 × 256 WebPs below 100 KiB; no alpha channel.

- [x] **Step 2: Visually inspect all five outputs**

Check that the three regions are immediately distinguishable, the two goddesses have different silhouettes and palettes, faces remain clear at avatar size, and no image contains text, watermarks, borders, black corners, or crop damage.

- [x] **Step 3: Confirm existing backgrounds remain unchanged**

Verify `public/assets/backgrounds/liyue.webp` and `public/assets/backgrounds/natlan.webp` still exist and the new files are separate `-v2` assets.
