const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 18);
if (!supported) {
  console.error(`[check-node-version] 本项目要求 Node.js >= 22.18.0（当前 ${process.version}）。`);
  console.error('请使用 nvm / fnm 安装 Node 22.18 或更高版本后重试，避免类型擦除脚本在旧 Node 下失效。');
  process.exit(1);
}
console.log(`[check-node-version] Node ${process.version} OK`);
