import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const allowlistPath = path.join(scriptDir, 'config', 'teyvat-language-allowlist.json');

const runtimeRoots = [
  'App.tsx',
  'components',
  'hooks',
  'models',
  'prompts',
  'services',
  'utils',
  'data',
  'public',
];

const runtimeExtensions = new Set(['.ts', '.tsx', '.json', '.css', '.html']);
const excludedSegments = new Set([
  'tests',
  'stories',
  'scripts/fixtures',
  'dist',
  'coverage',
  'storybook-static',
  'node_modules',
  'src-tauri/target',
]);

const bannedPatterns = [
  /崩坏[：:]\s*星穹铁道/giu,
  /崩铁/gu,
  /\bHSR\b/gu,
  /\bHonkai\b/giu,
  /\bStar\s+Rail\b/giu,
  /(?<![A-Za-z0-9])herta(?:[A-Z][A-Za-z0-9]*|_[a-z0-9_]+)?(?![A-Za-z0-9])/giu,
  /(?<![A-Za-z0-9])aeons?(?:[A-Z][A-Za-z0-9]*|_[a-z0-9_]+)?(?![A-Za-z0-9])/giu,
  /(?<![A-Za-z0-9])stellarons?(?:[A-Z][A-Za-z0-9]*|_[a-z0-9_]+)?(?![A-Za-z0-9])/giu,
  /(?<![A-Za-z0-9])ipc(?:_[a-z0-9_]+)?(?![A-Za-z0-9])/giu,
  /(?<![A-Za-z0-9])(?:express_nameless|WORLDVIEW_EXPRESS_NAMELESS)(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])(?:pompom|pom_pom|welt|himeko|march7th?|dan_?heng|silverwolf)(?![A-Za-z0-9])/giu,
  /(?<![A-Za-z0-9])(?:amphoreus|genius_society|jarilo(?:_vi)?|penacony|xianzhou(?:_alliance|_luofu)?|luofu)(?![A-Za-z0-9])/giu,
  /黑塔空间站/gu,
  /星穹列车/gu,
  /帕姆/gu,
  /三月七/gu,
  /丹恒/gu,
  /史瓦罗/gu,
  /星核/gu,
  /命途/gu,
  /光锥/gu,
  /开拓者/gu,
  /星际/gu,
  /星海/gu,
  /舰队/gu,
  /跃迁/gu,
  /舱门/gu,
  /舱内/gu,
  // ── 语义根词 ──
  // 上面按复合词与标识符封堵，会漏掉语义根词本身。
  // 例：封了「开拓者」却漏了「开拓天数」，导致提瓦特运行时里长期残留崩铁纪年与字段。
  // 以下一律按根词封堵，不给复合词留绕过空间。
  // 「开拓」作普通动词（如官方图鉴原文"开拓属血气者的未来"）是合法中文，只封崩铁复合词。
  /开拓(?:者|天数|记录|纪录|轶事|精神)/gu,
  // 只封崩铁纪年「琥珀纪 / 琥珀历」。裸「琥珀」会误伤 CSS 颜色名 amber（琥珀色），不放行。
  /琥珀(?:纪|历)/gu,
  /星尘/gu,
  /以太/gu,
  /裂隙(?:风)?/gu,
  /能量雨/gu,
  /科幻/gu,
  /新闻(?:系统|模块|面板|频道|推送|摘要|状态|条目|源|流|模板|世界书|API|设置|更新时间)/gu,
  /忆庭/gu,
  /轶庭/gu,
  /智库/gu,
  // ── 崩铁专名补漏 ──
  // 「星轨」是星穹铁道英文名（Star Rail）直译，且在提瓦特语境无必要保留；
  /星轨/gu,
  /匹诺康尼/gu,
  /模拟宇宙/gu,
  /天才俱乐部/gu,
  /博识学会/gu,
  /阮·梅/gu,
  /螺丝咕姆/gu,
  /真理医生/gu,
  /列车长/gu,
  /观景车厢/gu,
  /仙舟/gu,
  /罗浮/gu,
  /贝洛伯格/gu,
  /雅利洛/gu,
  /(?<![A-Za-z0-9])(?:News[A-Z][A-Za-z0-9]*|news[A-Z][A-Za-z0-9]*|news_(?:system|worldbook|entries?|status|feed))(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])(?:Yiting[A-Za-z0-9]*|yiting_(?:system|runtime|archive|memory))(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])(?:Zhiku[A-Za-z0-9]*|zhiku[A-Z][A-Za-z0-9]*|zhiku-(?:v2|design)|zhiku_(?:system|runtime|preset|entry|entries|identity|governance|character|knowledge|stage|official|design))(?![A-Za-z0-9])/gu,
];

const normalizePath = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

const loadAllowlist = () => JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));

const isExcluded = (relativePath) => {
  const normalized = normalizePath(relativePath);
  return [...excludedSegments].some(
    (segment) => normalized === segment || normalized.startsWith(`${segment}/`) || normalized.includes(`/${segment}/`),
  );
};

const isAllowlisted = (relativePath, allowlist) => {
  const normalized = normalizePath(relativePath);
  return (
    allowlist.files.includes(normalized) ||
    allowlist.pathPrefixes.some((prefix) => normalized.startsWith(prefix))
  );
};

// 精确豁免：`${file}:${term}`，用于有意保留的向后兼容代码（旧存档字段读取等）。
// 只豁免指定文件里的指定术语，不放过同一文件里的其他新泄漏。
const isAllowlistedHit = (relativePath, term, allowlist) => {
  const entries = Array.isArray(allowlist?.allowHits) ? allowlist.allowHits : [];
  return entries.includes(`${normalizePath(relativePath)}:${term}`);
};

const collectFiles = (entryPath) => {
  const absolute = path.resolve(repoRoot, entryPath);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return runtimeExtensions.has(path.extname(absolute)) ? [absolute] : [];

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    const relative = normalizePath(path.relative(repoRoot, child));
    if (isExcluded(relative)) continue;
    if (entry.isDirectory()) files.push(...collectFiles(relative));
    else if (entry.isFile() && runtimeExtensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
};

const collectMatches = (text) => {
  const matches = [];
  for (const pattern of bannedPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      matches.push({ index: match.index ?? 0, term: match[0] });
    }
  }
  return matches.sort((left, right) => left.index - right.index || left.term.localeCompare(right.term));
};

const scanFiles = (absoluteFiles, allowlist, { ignoreExclusions = false } = {}) => {
  const findings = [];
  for (const absoluteFile of absoluteFiles.sort()) {
    const relativePath = normalizePath(path.relative(repoRoot, absoluteFile));
    if ((!ignoreExclusions && isExcluded(relativePath)) || isAllowlisted(relativePath, allowlist)) continue;

    for (const match of collectMatches(relativePath)) {
      findings.push({
        file: relativePath,
        line: 1,
        column: match.index + 1,
        term: match.term,
        excerpt: `<path> ${relativePath}`,
      });
    }

    const lines = fs.readFileSync(absoluteFile, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const match of collectMatches(line)) {
        if (isAllowlistedHit(relativePath, match.term, allowlist)) continue;
        findings.push({
          file: relativePath,
          line: index + 1,
          column: match.index + 1,
          term: match.term,
          excerpt: line.trim().slice(0, 180),
        });
      }
    });
  }
  return findings;
};

const printFindings = (findings) => {
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} [${finding.term}] ${finding.excerpt}`,
    );
  }
};

const runSelfTest = () => {
  const allowlist = loadAllowlist();
  const fixtureRoot = path.join(scriptDir, 'fixtures', 'teyvat-language-audit');
  const scanFixture = (name) =>
    scanFiles([path.join(fixtureRoot, name)], allowlist, { ignoreExclusions: true });
  const failFindings = scanFixture('fail.ts');
  const passFindings = scanFixture('pass.ts');
  const stableContractFindings = scanFixture('pass-stable-contract.ts');
  const failLines = fs.readFileSync(path.join(fixtureRoot, 'fail.ts'), 'utf8').split(/\r?\n/u);
  const expectedFailLines = failLines
    .map((line, index) => (line.includes('audit-reject') ? index + 1 : 0))
    .filter(Boolean);
  const rejectedLines = new Set(failFindings.map((finding) => finding.line));
  const missedFailLines = expectedFailLines.filter((line) => !rejectedLines.has(line));

  if (expectedFailLines.length === 0 || missedFailLines.length > 0) {
    console.error(
      `FAIL teyvat runtime language audit self-test: ${missedFailLines.length} annotated rejection case(s) were missed`,
    );
    for (const line of missedFailLines) console.error(`fail.ts:${line} ${failLines[line - 1].trim()}`);
    return 1;
  }
  if (passFindings.length !== 0) {
    console.error('FAIL teyvat runtime language audit self-test: pass fixture was rejected');
    printFindings(passFindings);
    return 1;
  }
  if (stableContractFindings.length !== 0) {
    console.error('FAIL teyvat runtime language audit self-test: classified stable internal values were rejected');
    printFindings(stableContractFindings);
    return 1;
  }

  console.log(
    `PASS teyvat runtime language audit self-test (${expectedFailLines.length}/${expectedFailLines.length} annotated cases rejected, 0 false positives)`,
  );
  return 0;
};

const runRuntimeAudit = () => {
  const allowlist = loadAllowlist();
  const files = runtimeRoots.flatMap(collectFiles);
  const findings = scanFiles(files, allowlist);
  if (findings.length > 0) {
    console.error(`FAIL Teyvat runtime language audit: ${findings.length} non-allowlisted hit(s)`);
    printFindings(findings);
    return 1;
  }
  console.log(`PASS Teyvat runtime language audit: ${files.length} runtime files, 0 non-allowlisted hits`);
  return 0;
};

process.exitCode = process.argv.includes('--self-test') ? runSelfTest() : runRuntimeAudit();
