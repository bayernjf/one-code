import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { ActivityLog } from './activityLog';

/**
 * 活动历史窗口
 *
 * 展示最近的 AI 活动记录（完成 / 等待输入），按时间倒序排列。
 */
export class HistoryWindow {
  private win: BrowserWindow | undefined;

  constructor(private activityLog: ActivityLog) {
    this.registerIpc();
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return;
    }

    this.win = new BrowserWindow({
      width: 560,
      height: 600,
      title: 'AI Watchdog — 活动历史',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.win.loadFile(path.join(__dirname, 'renderer', 'history.html'));
    this.win.on('closed', () => {
      this.win = undefined;
    });
  }

  private registerIpc(): void {
    ipcMain.handle('history:get', () => this.activityLog.getRecords());
    ipcMain.handle('history:clear', () => {
      this.activityLog.clear();
      return true;
    });
  }
}
