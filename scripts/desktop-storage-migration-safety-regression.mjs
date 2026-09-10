import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const storage = fs.readFileSync('components/features/Settings/StorageManager.tsx', 'utf8');
assert(lib.includes('fn migrate_storage_root'), 'Rust must implement storage root migration.');
assert(lib.includes('已存在同名条目') || lib.includes('conflicts'), 'migration must detect target conflicts before any deletion.');
assert(!lib.includes('fn move_path'), 'destructive move_path helper must be removed.');
assert(lib.includes('rollback_copied_entries'), 'migration must roll back copied entries on failure.');
assert(lib.includes('复制校验未通过'), 'migration must verify copied entries before deleting source.');
const fnStart = lib.indexOf('fn migrate_storage_root');
const fnEnd = lib.indexOf('fn rollback_copied_entries', fnStart);
const fn = lib.slice(fnStart, fnEnd);
const deleteIndex = fn.indexOf('remove_dir_all');
const conflictIndex = fn.indexOf('已存在同名条目');
assert(conflictIndex >= 0 && (deleteIndex < 0 || conflictIndex < deleteIndex), 'conflict check must precede any deletion.');
assert(storage.includes('setDesktopError'), 'storage UI must surface migration errors.');
console.log('desktop storage migration safety regression ok');
