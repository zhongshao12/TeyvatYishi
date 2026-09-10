import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const groups = [
  [5, 'Anemo', ['Chasca', 'Jean', 'Kaedehara Kazuha', 'Varka', 'Venti', 'Wanderer', 'Xianyun', 'Xiao', 'Yumemizuki Mizuki']],
  [5, 'Cryo', ['Aloy', 'Citlali', 'Escoffier', 'Eula', 'Ganyu', 'Kamisato Ayaka', 'Lohen', 'Odette', 'Qiqi', 'Sandrone', 'Shenhe', 'Skirk', 'Wriothesley']],
  [5, 'Dendro', ['Alhaitham', 'Baizhu', 'Emilie', 'Kinich', 'Lauma', 'Nahida', 'Nefer', 'Tighnari']],
  [5, 'Electro', ['Clorinde', 'Cyno', 'Flins', 'Ineffa', 'Keqing', 'Raiden Shogun', 'Varesa', 'Yae Miko']],
  [5, 'Geo', ['Albedo', 'Arataki Itto', 'Chiori', 'Linnea', 'Navia', 'Xilonen', 'Zhongli', 'Zibai']],
  [5, 'Hydro', ['Columbina', 'Furina', 'Kamisato Ayato', 'Mona', 'Mualani', 'Neuvillette', 'Nilou', 'Sangonomiya Kokomi', 'Sigewinne', 'Tartaglia', 'Yelan']],
  [5, 'None', ['Traveler', 'Wonderland Manekin']],
  [5, 'Pyro', ['Arlecchino', 'Dehya', 'Diluc', 'Durin', 'Hu Tao', 'Klee', 'Lyney', 'Mavuika', 'Nicole', 'Yoimiya']],
  [4, 'Anemo', ['Faruzan', 'Ifa', 'Jahoda', 'Lan Yan', 'Lynette', 'Prune', 'Sayu', 'Shikanoin Heizou', 'Sucrose']],
  [4, 'Cryo', ['Charlotte', 'Chongyun', 'Diona', 'Freminet', 'Kaeya', 'Layla', 'Mika', 'Rosaria']],
  [4, 'Dendro', ['Collei', 'Kaveh', 'Kirara', 'Yaoyao']],
  [4, 'Electro', ['Alyosha', 'Beidou', 'Dori', 'Fischl', 'Iansan', 'Kujou Sara', 'Kuki Shinobu', 'Lisa', 'Ororon', 'Razor', 'Sethos']],
  [4, 'Geo', ['Gorou', 'Illuga', 'Kachina', 'Ningguang', 'Noelle', 'Yun Jin']],
  [4, 'Hydro', ['Aino', 'Barbara', 'Candace', 'Dahlia', 'Xingqiu']],
  [4, 'Pyro', ['Amber', 'Bennett', 'Chevreuse', 'Gaming', 'Thoma', 'Xiangling', 'Xinyan', 'Yanfei']],
];

export const slugifyTeyvatAvatarName = (name) => name
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

export const teyvatAvatarRoster = groups.flatMap(([rarity, element, names]) => names.map((name) => {
  const slug = slugifyTeyvatAvatarName(name);
  return {
    id: slug,
    name,
    rarity,
    element,
    path: `/assets/teyvat-avatars/characters/${rarity}-star/${slug}.webp`,
    status: slug === 'amber' ? 'ready' : 'pending',
  };
}));

const counts = teyvatAvatarRoster.reduce((result, item) => {
  result.total += 1;
  result[`${item.rarity}Star`] += 1;
  return result;
}, { total: 0, '5Star': 0, '4Star': 0 });

if (counts.total !== 120 || counts['5Star'] !== 69 || counts['4Star'] !== 51) {
  throw new Error(`Invalid Teyvat avatar roster counts: ${JSON.stringify(counts)}`);
}

if (new Set(teyvatAvatarRoster.map((item) => item.id)).size !== teyvatAvatarRoster.length) {
  throw new Error('Duplicate Teyvat avatar slug detected.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const outputPath = resolve('public/assets/teyvat-avatars/roster.json');
  const payload = {
    version: 1,
    generatedAt: '2026-09-01',
    source: {
      name: 'GachaTracker Genshin Characters',
      url: 'https://gachatracker.app/games/genshin/characters/',
      sourceUpdatedAt: '2026-08-19',
    },
    counts,
    characters: teyvatAvatarRoster,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${counts.total} entries to ${outputPath}`);
}
