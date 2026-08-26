import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { NotificationLog } from './notificationLog';

/**
 * 通知日志窗口：展示最近弹出的系统通知记录
 */
export class NotificationWindow {
  private win: BrowserWindow | undefined;

  constructor(private log: NotificationLog) {
    ipcMain.handle('notifications:get', () => this.log.getRecords());
    ipcMain.handle('notifications:clear', () => {
      this.log.clear();
      return true;
    });
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return;
    }

    this.win = new BrowserWindow({
      width: 560,
      height: 600,
      title: 'AI Watchdog — 通知日志',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.win.loadFile(path.join(__dirname, 'renderer', 'notifications.html'));
    this.win.on('closed', () => {
      this.win = undefined;
    });
  }
}
