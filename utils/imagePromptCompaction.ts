/** Local fallback: keep drawable facts, not the instructions used to produce them. */
import { formatImageCharacterFacts, removeContradictoryImageColors, type ImageCharacterFacts } from '@/utils/imageCharacterFacts';

export const GENERATED_IMAGE_PROMPT_LIMIT = 1800;

export interface PromptCharacter {
  name: string;
  visualPrompt: string;
  negativePrompt?: string;
  enabled?: boolean;
  facts?: ImageCharacterFacts;
  anchorPrompt?: string;
}

const safety = /adult(?:s| only)?|no minors|underage|未成年|仅限成年/i;
const instruction = /^(?:choose composition|avatar:|portrait:|scene:|phone wallpaper:|anchor hair|keep stable|do not (?:change|output|rewrite|redesign)|only add |for (?:official|original) characters|but still |if other prompt|when |if |return |output |only output|output format|prompt must|must |never |follow |preserve (?:stable|character|identity)|keep (?:stable|character|identity)|use (?:the|plain|traveler)|the (?:prompt|model|character)|(?:novelai|comfyui|sd webui|openai-compatible) |png style preset|it should |target canvas|visible personality|abilities:|identity:|faithful to the official|角色锚定|锚定模式|输出格式|输出英文|你是|把(?:性格|正文|角色档案|输入|新闻)|适用范围|正文生图|不再依赖|先建立|再写|再突出|场景必须|故事快照应|场景图应|信使背景优先|不要把|纯场景可以|请|必须|不得|禁止把|规则)/i;

/** Separators inside SD/NAI weights, LoRA tokens and brackets are not tag boundaries. */
export function splitImagePromptFragments(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let weighted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if ('([{<'.includes(char)) depth++;
    else if (')]}>'.includes(char)) depth = Math.max(0, depth - 1);
    if (text.slice(index, index + 2) === '::' && depth === 0) {
      weighted = !weighted;
      index++;
      continue;
    }
    if (depth === 0 && !weighted && (/[,，;；。\n]/.test(char) || (char === '.' && /\s/.test(text[index + 1] || '')))) {
      result.push(text.slice(start, index));
      start = index + 1;
    }
  }
  result.push(text.slice(start));
  return result.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Match familiar units only. Do not infer conversions or treat scene distances as height.
const measurementUnit = /\d\s*(cm\b|centimet(?:er|re)s?\b|厘米|m\b|met(?:er|re)s?\b|米|in\b|inch(?:es)?\b|英寸|kg\b|kilograms?\b|公斤|千克|lbs?\b|pounds?\b|磅)/i;

function readNumericMeasurement(value: string): { numbers: number[]; unit: string } | undefined {
  const unit = value.match(measurementUnit)?.[1]?.toLowerCase();
  if (!unit) return undefined;
  const canonicalUnit = /^(?:cm|centimet|厘米)/.test(unit) ? 'cm'
    : /^(?:m|米)/.test(unit) ? 'm'
    : /^(?:in|英寸)/.test(unit) ? 'in'
    : /^(?:kg|kilogram|公斤|千克)/.test(unit) ? 'kg' : 'lb';
  const numbers = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return numbers.length ? { numbers, unit: canonicalUnit } : undefined;
}

/** Model responses only: never call this for manual prompts or local fallback text. */
export function sanitizeImageModelPrompt(prompt: string, characters?: readonly PromptCharacter[]): string {
  const activeCharacters = (characters ?? []).filter(character => character.enabled !== false);
  const records = activeCharacters.map(character => ({
    ...character.facts?.appearanceDetails,
    ...(!character.facts?.appearanceDetails?.身高 && character.facts?.profileHeight
      ? { 身高: { value: character.facts.profileHeight } } : {}),
  }));
  const supported = splitImagePromptFragments(prompt).filter(tag => {
    // Prompt emphasis coefficients are not body measurements.
    const plain = tag.replace(/^\s*\d+(?:\.\d+)?::/, '').replace(/:\s*\d+(?:\.\d+)?\s*(?=\)$)/, '');
    const tall = /\d+(?:\.\d+)?\s*(?:cm\b|centimet(?:er|re)s?\b|m\b|met(?:er|re)s?\b|in\b|inch(?:es)?\b)\s+tall\b/i.test(plain);
    const isMeasurement = /(?:\bheight\b|\bweight\b|\bbust\b|\bwaist\b|\bhips?\b|\bmeasurements?\b|身高|体重|三围|胸围|腰围|臀围)\s*[:：=]?\s*\d/i.test(plain)
      || /\d+(?:\.\d+)?\s*(?:cm\b|kg\b|centimet(?:er|re)s?\b|kilograms?\b|lbs?\b|pounds?\b|厘米|公斤|千克|磅)/i.test(plain)
      || tall
      || /\d+\s*[-/]\s*\d+\s*[-/]\s*\d+/.test(tag);
    if (!isMeasurement) return true;
    const measurement = readNumericMeasurement(plain);
    if (!measurement) return false;
    const tupleIndex = /\bbust\b|胸围/i.test(plain) ? 0
      : /\bwaist\b|腰围/i.test(plain) ? 1
      : /\bhips?\b|臀围/i.test(plain) ? 2 : undefined;
    const key = /\bheight\b|身高/i.test(plain) || tall ? '身高'
      : /\bweight\b|体重/i.test(plain) ? '体重'
      : tupleIndex !== undefined || /\bmeasurements?\b|三围/i.test(plain) || measurement.numbers.length === 3 ? '三围'
      : measurement.unit === 'kg' || measurement.unit === 'lb' ? '体重' : '身高';
    const mass = measurement.unit === 'kg' || measurement.unit === 'lb';
    if ((key === '体重') !== mass) return false;
    return records.some(record => {
      const recorded = readNumericMeasurement(record[key]?.value ?? '');
      if (!recorded || recorded.unit !== measurement.unit) return false;
      const numbers = tupleIndex !== undefined && recorded.numbers.length === 3
        ? [recorded.numbers[tupleIndex]!] : recorded.numbers;
      return numbers.length === measurement.numbers.length
        && numbers.every((number, index) => number === measurement.numbers[index]);
    });
  }).join(', ');
  // A global multi-person caption cannot safely attribute a color to one person.
  const singleAnchor = activeCharacters.length === 1 ? activeCharacters[0]?.anchorPrompt : '';
  return singleAnchor ? removeContradictoryImageColors(supported, singleAnchor) : supported;
}

function priority(value: string): number {
  if (safety.test(value)) return 120;
  if (/character(?: name)?\s*:|player character name:|appearance:|outfit:|hair|eyes?|ribbon|hat\b|dress|coat|costume|accessor|signature|发色|头发|眼眸|服装|发带/.test(value.toLowerCase())) return 100;
  if (/location|scene|action|walking|standing|sitting|sunset|sunlight|night|rain|snow|city|forest|fountain|蒙德|璃月|须弥|地点|动作|天气|光线|场景/.test(value.toLowerCase())) return 90;
  if (/portrait|head and shoulders|full body|close.up|camera|composition|focus|视角|构图/.test(value.toLowerCase())) return 80;
  return 40;
}

// Only used for a single oversized prose fragment. Unwrap emphasis before shortening,
// rather than emitting a dangling weight/bracket or cutting a UTF-16 surrogate pair.
function shortenProse(value: string, limit: number): string {
  const plain = value.replace(/[()[\]{}<>]/g, '').replace(/\d+(?:\.\d+)?::|::/g, '');
  const points = Array.from(plain);
  let output = '';
  for (const point of points) {
    if (output.length + point.length > limit) break;
    output += point;
  }
  const boundary = output.lastIndexOf(' ');
  return (boundary > output.length / 2 ? output.slice(0, boundary) : output).trim();
}

function compactCaption(text: string, limit: number, stripInstructions = true): string {
  if (limit <= 0) return '';
  if (stripInstructions) {
    // These multiline builder instructions contain commas; remove the whole
    // known instruction before tag splitting, retaining the actual anchor below.
    text = text
      .replace(/\b(?:player character|character) APPEARANCE LOCK:[^\n]*/gi, '')
      .replace(/^Do not change hairstyle,[^\n]*/gmi, '')
      .replace(/^If other prompt sections conflict[^\n]*/gmi, '');
  }
  const seen = new Set<string>();
  const atoms = splitImagePromptFragments(text).flatMap(value => {
    // Verbose prose is not necessarily comma-tagged. Split its visible clauses
    // before budgeting so late hair/eyes/accessories don't disappear with the tail.
    if (value.length > limit / 2 && !/[()[\]{}<>]|::/.test(value)) {
      return value.split(/\s+(?:with|and|featuring)\s+/i).map(part => part.trim()).filter(Boolean);
    }
    return [value];
  }).filter(value => {
    if (stripInstructions && !safety.test(value) && instruction.test(value)) return false;
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ordered = atoms.map((value, index) => ({ value, index, priority: priority(value) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const selected: Array<{ value: string; index: number }> = [];
  let remaining = limit;
  for (const atom of ordered) {
    const separator = selected.length ? 2 : 0;
    if (atom.value.length + separator <= remaining) {
      selected.push(atom);
      remaining -= atom.value.length + separator;
    } else if (!selected.length) {
      // Still leave room for subsequent identity/scene facts.
      const value = shortenProse(atom.value, Math.min(remaining, Math.max(100, Math.floor(limit / 2))));
      if (value) { selected.push({ value, index: atom.index }); remaining -= value.length; }
    }
  }
  return selected.sort((a, b) => a.index - b.index).map(atom => atom.value).join(', ');
}

export function compactImagePrompts(input: {
  prompt: string;
  negative?: string;
  characters?: readonly PromptCharacter[];
  limit?: number;
  negativeLimit?: number;
}): { prompt: string; negative: string; compacted: boolean } {
  const limit = input.limit ?? GENERATED_IMAGE_PROMPT_LIMIT;
  const characters = input.characters?.filter(character => character.enabled !== false) ?? [];
  // Fair per-person reservations prevent a long first character from erasing later ones.
  const mandatoryCaptions = characters.map(character => character.facts ? [
    formatImageCharacterFacts(character.facts),
    character.anchorPrompt ? `stable anchor (priority over profile): ${character.anchorPrompt.trim()}` : '',
  ].filter(Boolean).join('\n') : '');
  const mandatorySize = mandatoryCaptions.reduce((sum, value) => sum + (value ? value.length + 2 : 0), 0);
  if (mandatorySize > limit) throw new Error('已记录角色外貌事实超过提示词上限，请减少同框角色或缩短外貌摘要；不会静默丢弃已记录事实。');
  const characterBudget = characters.length ? Math.floor(Math.max(0, limit * 0.55 - mandatorySize) / characters.length) : 0;
  if (characters.some(character => !character.facts) && characterBudget < 32) throw new Error('画面角色过多，无法在提示词上限内保留每位角色的辨识特征，请减少同框角色。');
  const characterCaptions = characters.map((character, index) => {
    const mandatory = mandatoryCaptions[index] || '';
    if (mandatory) return mandatory;
    const name = shortenProse(character.name.trim(), Math.min(80, Math.floor(characterBudget / 3)));
    const label = `character ${name}: `;
    return label + compactCaption(character.visualPrompt, characterBudget - label.length);
  });
  const reserved = characterCaptions.reduce((sum, value) => sum + value.length + 2, 0);
  // Album finalization can run after tokenizer compaction. Remove our exact
  // protected blocks first so they are not reintroduced as duplicate base tags.
  const baseText = mandatoryCaptions.filter(Boolean).reduce((value, caption) => value.replaceAll(caption, ''), input.prompt);
  const base = compactCaption(baseText, limit - reserved);
  const prompt = [base, ...characterCaptions].filter(Boolean).join(', ');
  const negative = compactCaption([input.negative, ...characters.map(character => character.negativePrompt)].filter(Boolean).join(', '), input.negativeLimit ?? limit, false);
  return { prompt, negative, compacted: prompt !== input.prompt.trim() || negative !== (input.negative || '').trim() };
}
