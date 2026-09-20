import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const storage = fs.readFileSync('components/features/Settings/StorageManager.tsx', 'utf8');
assert(lib.includes('fn migrate_storage_roots_transactionally'), 'Rust must implement storage root migration.');
assert(lib.includes('已存在同名条目') || lib.includes('conflicts'), 'migration must detect target conflicts before any deletion.');
assert(!lib.includes('fn move_path'), 'destructive move_path helper must be removed.');
assert(lib.includes('rollback_copied_entries'), 'migration must roll back copied entries on failure.');
assert(lib.includes('复制校验未通过'), 'migration must verify copied entries before deleting source.');

// 迁移: 旧 `slice(fn migrate_storage_root .. fn rollback_copied_entries)` 内比 indexOf 位置
//   -> 新 编排函数 migrate_storage_roots_transactionally + 预检函数 prepare_storage_root_migration 的双函数契约。
//   理由: 迁移已拆分为「编排（校验计划 -> 逐个 prepare -> commit -> 清理源）」与「预检（冲突检查 -> 只复制 -> 校验）」
//   两个函数，冲突检查与源目录删除不再同处一个文本区间，跨函数比 indexOf 位置已失去意义。
//   安全意图不变且更严格：冲突预检必须先于任何删除执行，且删除只能发生在配置提交成功之后、prepare 全程无删除。
const orchestrator = lib.slice(
  lib.indexOf('fn migrate_storage_roots_transactionally'),
  lib.indexOf('\nfn validate_storage_migration_plan', lib.indexOf('fn migrate_storage_roots_transactionally')),
);
const prepareFn = lib.slice(
  lib.indexOf('fn prepare_storage_root_migration'),
  lib.indexOf('\nfn rollback_prepared_migrations', lib.indexOf('fn prepare_storage_root_migration')),
);

const conflictIndex = prepareFn.indexOf('已存在同名条目');
const conflictGuardIndex = prepareFn.indexOf('if !conflicts.is_empty()');
const prepareCallIndex = orchestrator.indexOf('prepare_storage_root_migration(from, to)');
const commitIndex = orchestrator.indexOf('commit()');
const deleteIndex = orchestrator.indexOf('remove_dir_all');

assert(conflictIndex >= 0 && conflictGuardIndex >= 0, 'conflict check must precede any deletion.');
assert(
  prepareCallIndex >= 0 && (deleteIndex < 0 || prepareCallIndex < deleteIndex),
  'conflict check must precede any deletion.',
);
assert(
  commitIndex >= 0 && (deleteIndex < 0 || commitIndex < deleteIndex),
  'conflict check must precede any deletion.',
);
assert(
  !prepareFn.includes('remove_dir_all') && !prepareFn.includes('remove_file'),
  'conflict check must precede any deletion.',
);
assert(storage.includes('setDesktopError'), 'storage UI must surface migration errors.');
console.log('desktop storage migration safety regression ok');
