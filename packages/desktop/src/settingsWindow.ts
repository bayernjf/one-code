import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { DesktopConfig } from './config';
import { ConfigStore } from './configStore';
import { saveConfigWithValidation, SaveValidation } from './patternValidation';

/**
 * 设置窗口
 *
 * 打开一个独立的设置界面，支持勾选监控目标、查看/编辑监听目录、
 * 调整灵敏度参数。通过 IPC 与主进程交换配置。
 */
export class SettingsWindow {
  private win: BrowserWindow | undefined;

  constructor(
    private configStore: ConfigStore,
    /** 配置变更回调（用于主进程重启探针） */
    private onChange: (config: DesktopConfig) => void
  ) {
    this.registerIpc();
  }

  /** 打开（或聚焦已打开的）设置窗口 */
  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return;
    }

    this.win = new BrowserWindow({
      width: 640,
      height: 720,
      title: 'AI Watchdog 设置',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.win.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
    this.win.on('closed', () => {
      this.win = undefined;
    });
  }

  private registerIpc(): void {
    // 渲染进程请求当前配置
    ipcMain.handle('settings:get', () => this.configStore.load());

    // 渲染进程提交新配置。写入侧校验（2026-11-02 评审 P1-1）：先逐条编译
    // processPatterns，非法即整体拒绝并返回可读错误，不落盘、不触发探针
    // 重建——脏配置一旦落盘，重启后探针会再次加载它（崩溃循环的根因）。
    ipcMain.handle('settings:save', (_event, config: DesktopConfig): SaveValidation =>
      saveConfigWithValidation(
        config,
        (valid) => this.configStore.save(valid),
        (valid) => this.onChange(valid)
      )
    );
  }
}
