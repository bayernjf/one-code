/**
 * 跨平台复制渲染进程静态资源（html）到 dist/renderer/
 * 替代 build 脚本里的 Unix `cp`，兼容 Windows cmd.exe。
 */
const fs = require('node:fs');
const path = require('node:path');

const files = ['settings.html', 'history.html', 'stats.html', 'notifications.html'];
const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const distDir = path.join(__dirname, '..', 'dist', 'renderer');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

for (const f of files) {
  const src = path.join(srcDir, f);
  const dest = path.join(distDir, f);
  fs.copyFileSync(src, dest);
  console.log(`copied ${f}`);
}
