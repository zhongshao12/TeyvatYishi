import fs from 'node:fs';
const retrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
// 迁移: 旧 `query.trim()` 内联在 services/codexRetrieval.ts（检索入口自己 trim 规范化 query）
//   -> 检索入口改为调用共享评分层 `buildRetrievalQueryProfile(query)`，规范化与空查询短路下沉到被调用方
//      services/retrievalScoring.ts：`const labeledContent = query.replace(QUERY_LABEL_RE, ' ').trim();`
//      + `if (!labeledContent) return null;`（空 / 纯标签 query 直接返回空召回）。
// 理由: 意图不变——检索必须由本回合 query 驱动（按 query 建画像、空 query 不召回），只是 trim 写法的
//       落点搬进了被调用方，因此把该文件并入读取源（A 类扩源），而不是放弃“query 驱动”这条约束。
const retrievalScoring = fs.readFileSync('services/retrievalScoring.ts', 'utf8');
const queryDriven = retrieval.includes('buildRetrievalQueryProfile(query)')
  && retrievalScoring.includes("const labeledContent = query.replace(QUERY_LABEL_RE, ' ').trim();")
  && retrievalScoring.includes('if (!labeledContent) return null;');
if (!retrieval.includes('retrieveCodexEntries') || !queryDriven) throw new Error('Codex retrieval mode must be query driven.');
if (retrieval.includes('智库系统') || retrieval.includes('retrieveZhiku')) throw new Error('Codex retrieval must not retain runtime aliases.');
console.log('codex retrieval mode regression ok');
