import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const script = fs.readFileSync('scripts/desktop-sign-updater.mjs', 'utf8');
assert(script.includes('TAURI_SIGNING_PRIVATE_KEY_PASSWORD'), 'sign script must use the password env var.');
assert(!script.includes('--password=${'), 'sign script must not put the password into argv.');
assert(!/args\.push\(['"]--password=/.test(script), 'sign script must not push --password= into argv.');
console.log('desktop sign password regression ok');
