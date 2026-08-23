/**
 * electron-builder afterPack 钩子：对打包后的 .app 做 ad-hoc 签名，
 * 使产物在未配置 Apple Developer 证书时也能通过 Gatekeeper 本机运行。
 *
 * 参考 soft-desk 的同名脚本。
 */
const { execSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function (context) {
  const productName = context.packager.appInfo.productName;
  const appPath = path.join(context.appOutDir, `${productName}.app`);

  console.log(`[ad-hoc-sign] Signing: ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('[ad-hoc-sign] Done.');
  } catch (err) {
    console.error('[ad-hoc-sign] Failed:', err.message);
    // 不阻断构建流程
  }
};
