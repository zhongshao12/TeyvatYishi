import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargoMatch = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m);
const cargoLockMatch = fs.readFileSync('src-tauri/Cargo.lock', 'utf8').match(/\[\[package\]\]\s+name = "kaituoyishi-desktop"\s+version = "([^"]+)"/m);
const landing = fs.readFileSync('components/layout/LandingPage.tsx', 'utf8');
const vite = fs.readFileSync('vite.config.ts', 'utf8');
assert(cargoMatch, 'Cargo.toml must declare a version.');
assert(cargoLockMatch, 'Cargo.lock must contain the desktop root package.');
assert(tauri.version === pkg.version, 'tauri.conf.json version ' + tauri.version + ' != package.json ' + pkg.version);
assert(cargoMatch[1] === pkg.version, 'Cargo.toml version ' + cargoMatch[1] + ' != package.json ' + pkg.version);
assert(cargoLockMatch[1] === pkg.version, 'Cargo.lock root version ' + cargoLockMatch[1] + ' != package.json ' + pkg.version);
assert(vite.includes('__APP_VERSION__') && vite.includes("readFileSync(path.resolve(__dirname, 'package.json')"), 'vite must inject version from package.json.');
assert(landing.includes('__APP_VERSION__'), 'LandingPage must render the injected version.');
assert(!landing.includes('v1.2.2'), 'LandingPage must not hardcode v1.2.2.');
console.log('version consistency regression ok');
