import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error(`nsfw-archive-completion regression failed: ${message}`);
    process.exit(1);
  }
}

const variableFacts = fs.readFileSync('utils/variableFacts.ts', 'utf8');
const variableModel = fs.readFileSync('services/ai/variableModel.ts', 'utf8');

assert(variableFacts.includes('const experiences = mergeUniqueTexts(current.经历, fact.experiences)'), 'nsfw_archive fact 必须合并经历。');
assert(variableFacts.includes('archive.经历 = experiences'), 'nsfw_archive fact 必须写入经历字段。');
assert(variableFacts.includes('const currentFemale = current.女性身体档案 ?? {}'), 'nsfw_archive fact 必须读取已有女性身体档案。');
assert(variableFacts.includes('const femaleIncoming = fact.femaleBodyArchive ?? {}'), 'nsfw_archive fact 必须读取新增女性身体档案。');
assert(variableFacts.includes('女性私处: mergePreferredText(currentFemale.女性私处, femaleIncoming.女性私处)'), '女性身体档案必须合并女性私处字段。');
assert(variableFacts.includes('后庭: mergePreferredText(currentFemale.后庭, femaleIncoming.后庭)'), '女性身体档案必须合并后庭字段。');
assert(variableFacts.includes('体味: mergePreferredText(currentFemale.体味, femaleIncoming.体味)'), '女性身体档案必须合并体味字段。');
assert(variableFacts.includes('男性器: mergePreferredText(currentMale.男性器, maleIncoming.男性器)'), '男性身体档案必须合并男性器字段。');
assert(variableFacts.includes('if (pruneEmptyObject(femaleArchive)) archive.女性身体档案 = femaleArchive'), '空女性身体档案不得写成空对象。');
assert(variableFacts.includes('if (pruneEmptyObject(maleArchive)) archive.男性身体档案 = maleArchive'), '空男性身体档案不得写成空对象。');

assert(variableModel.includes('# 成人档案候选'), '变量模型必须隔离成人档案候选区。');
assert(variableModel.includes('只在可见正文存在稳定长期事实时输出 nsfw_archive；没有证据时不要补写经历或偏好。'), 'NSFW 基线必须要求正文证据且禁止编造经历。');
assert(variableModel.includes('男性身体档案未启用，不得输出男性身体字段。'), '男性档案关闭时必须显式禁止男性身体字段。');

console.log('nsfw-archive-completion regression passed.');
