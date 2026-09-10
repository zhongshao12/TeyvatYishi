import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const view = fs.readFileSync('utils/saveTreeView.ts', 'utf8');
const modal = fs.readFileSync('components/features/SaveLoad/SaveLoadModal.tsx', 'utf8');
assert(view.includes('buildSaveTreeTimeline'), 'save tree view must build timelines.');
assert(view.includes('isBranchPoint'), 'timeline must mark branch points.');
assert(view.includes('对比存档节点'), 'save tree view must compare nodes.');
assert(view.includes('before') && view.includes('after'), 'compare must return field differences.');
assert(modal.includes('buildSaveTreeTimeline'), 'SaveLoadModal must render timelines.');
console.log('save tree visualization regression ok');
