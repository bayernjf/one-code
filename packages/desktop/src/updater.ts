import { autoUpdater } from 'electron-updater';
import { app, dialog } from 'electron';

/**
 * 自动更新检查（参考 soft-desk 的 electron/updater.ts）
 *
 * - 仅在打包环境（存在 app-update.yml）时启用
 * - 不自动下载，检查到更新时提示用户
 * - 检查失败静默处理，不影响应用启动
 */
export function initAutoUpdater(): void {
  // 开发模式下 app.isPackaged 为 false，跳过自动更新
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `AI Watchdog ${info.version} 可用，是否下载更新？`,
      buttons: ['下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '更新已就绪，重启应用以完成更新。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[updater] check failed (non-fatal):', err.message);
  });

  // 延迟检查，避免阻塞启动
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed (non-fatal):', err?.message ?? err);
    });
  }, 10_000);
}
