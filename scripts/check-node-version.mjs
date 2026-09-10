const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`[check-node-version] 本项目要求 Node.js >= 22（当前 ${process.version}）。`);
  console.error('请使用 nvm / fnm 安装 Node 22 后重试，避免在旧 Node 下得到误导性构建与测试结果。');
  process.exit(1);
}
console.log(`[check-node-version] Node ${process.version} OK`);
