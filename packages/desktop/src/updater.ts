import { app, ipcMain, Notification } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { autoUpdater } from 'electron-updater';

/**
 * 自动更新（对齐 soft-desk 的 electron/updater.ts 完整设计）
 *
 * - 完整事件流：checking / available / not-available / error / progress / downloaded
 * - IPC：updater:check / updater:quitAndInstall / updater:getStatus
 * - 平台差异：macOS 手动下载，Windows 自动下载
 * - 定时检查：首次 30s 后，之后每 6 小时
 * - 托盘应用无主窗口，事件通过系统通知 + 托盘状态提示用户
 */

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; releaseNotes?: string }
  | { type: 'not-available'; version: string }
  | { type: 'error'; message: string }
  | { type: 'progress'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string; releaseDate?: string; releaseNotes?: string };

export type UpdaterCheckResult =
  | { ok: false; reason: 'dev-mode' | 'unavailable' | 'error'; message?: string }
  | {
      ok: true;
      currentVersion: string;
      latestVersion: string | null;
      hasUpdate: boolean;
    };

export interface UpdaterStatus {
  currentVersion: string;
  downloadInProgress: boolean;
  updateReady: boolean;
  devMode: boolean;
}

const INITIAL_CHECK_DELAY_MS = 30 * 1000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let downloadInProgress = false;
let updateReady = false;
let recheckTimer: NodeJS.Timeout | null = null;
let ipcRegistered = false;

function isDevelopment(): boolean {
  return !app.isPackaged;
}

function toReleaseNotes(releaseNotes: unknown): string | undefined {
  return typeof releaseNotes === 'string' ? releaseNotes : undefined;
}

/** 托盘应用无主窗口，更新事件统一走系统通知 + 日志 */
function notify(title: string, body: string, onResult: 'restart' | 'none' = 'none'): void {
  if (!Notification.isSupported()) {
    return;
  }
  const notice = new Notification({ title, body, silent: false });
  if (onResult === 'restart') {
    notice.on('click', () => {
      autoUpdater.quitAndInstall(true, true);
    });
  }
  notice.show();
}

function registerIpc(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle('updater:check', async (): Promise<UpdaterCheckResult> => {
    if (isDevelopment()) {
      return { ok: false, reason: 'dev-mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        currentVersion: app.getVersion(),
        latestVersion: result?.updateInfo?.version ?? null,
        hasUpdate: !!result?.updateInfo && result.updateInfo.version !== app.getVersion(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] manual check failed:', message);
      return { ok: false, reason: 'error', message };
    }
  });

  ipcMain.handle('updater:quitAndInstall', async () => {
    if (!updateReady) {
      return { ok: false, reason: 'not-ready' as const };
    }
    // isSilent=true 让 NSIS 在 Windows 静默重启；isForceRunAfter=true 确保 Mac 重启后自动拉起
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });

  ipcMain.handle('updater:getStatus', async (): Promise<UpdaterStatus> => ({
    currentVersion: app.getVersion(),
    downloadInProgress,
    updateReady,
    devMode: isDevelopment(),
  }));
}

function ensureAutoUpdater(): AppUpdater | null {
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';

  autoUpdater.on('update-available', (info) => {
    if (process.platform !== 'darwin') {
      downloadInProgress = true;
    }
    console.log(`[updater] update available: ${info.version}`);

    // macOS 手动下载：提示用户
    if (process.platform === 'darwin') {
      notify(
        `发现新版本 ${info.version}`,
        '点击通知后需在设置中手动下载，或点击立即下载',
        'none'
      );
      // macOS 上自动下载（保持体验一致，实际用 autoDownload=false 则这里触发）
      autoUpdater.downloadUpdate().catch((err) => {
        console.warn('[updater] download failed:', err?.message ?? err);
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] no update (current ${info.version})`);
  });

  autoUpdater.on('error', (err) => {
    downloadInProgress = false;
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] error:', message);
  });

  autoUpdater.on('download-progress', (p) => {
    if (p.percent > 0 && Math.round(p.percent) % 10 === 0) {
      console.log(`[updater] download ${p.percent.toFixed(1)}%`);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadInProgress = false;
    updateReady = true;
    console.log(`[updater] downloaded ${info.version}`);
    notify(
      `AI Watchdog ${info.version} 已就绪`,
      '更新已下载完成，点击立即重启安装',
      'restart'
    );
  });

  return autoUpdater;
}

/**
 * 由 main 在 app.whenReady 之后调用一次。
 * dev 模式下只注册 IPC（让 UI 能读到 dev-mode 状态），不实际检查。
 */
export function startAutoUpdater(): void {
  registerIpc();

  if (isDevelopment()) {
    console.log('[updater] dev mode, skipping auto update check');
    return;
  }

  ensureAutoUpdater();

  const runCheck = () => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => console.warn('[updater] auto check error (non-fatal):', err));
  };

  setTimeout(runCheck, INITIAL_CHECK_DELAY_MS);
  recheckTimer = setInterval(runCheck, RECHECK_INTERVAL_MS);
}

export function stopAutoUpdater(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
}
