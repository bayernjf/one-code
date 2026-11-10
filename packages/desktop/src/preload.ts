import { contextBridge, ipcRenderer } from 'electron';
import { DesktopConfig } from './config';
import type { UpdaterCheckResult, UpdaterStatus } from './updater';
import type { ActivityRecord } from './activityLog';
import type { StatsData } from './statsWindow';
import type { NotificationRecord } from './notificationLog';

/**
 * 预加载脚本：通过 contextBridge 暴露最小化的 IPC 接口给渲染进程
 */
contextBridge.exposeInMainWorld('settingsAPI', {
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke('settings:get'),
  // 保存结果：ok=false 时带可读的非法模式错误列表，配置未落盘
  saveConfig: (config: DesktopConfig): Promise<{ ok: boolean; errors?: string[] }> =>
    ipcRenderer.invoke('settings:save', config),

  // 更新相关
  checkForUpdates: (): Promise<UpdaterCheckResult> => ipcRenderer.invoke('updater:check'),
  getUpdaterStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:getStatus'),
  quitAndInstall: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('updater:quitAndInstall'),
});

contextBridge.exposeInMainWorld('historyAPI', {
  getRecords: (): Promise<ActivityRecord[]> => ipcRenderer.invoke('history:get'),
  clear: (): Promise<boolean> => ipcRenderer.invoke('history:clear'),
});

contextBridge.exposeInMainWorld('statsAPI', {
  getStats: (): Promise<StatsData> => ipcRenderer.invoke('stats:get'),
  exportCsv: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('stats:exportCsv'),
  exportJson: (): Promise<{ ok: boolean; path?: string }> => ipcRenderer.invoke('stats:exportJson'),
});

contextBridge.exposeInMainWorld('notificationAPI', {
  getRecords: (): Promise<NotificationRecord[]> => ipcRenderer.invoke('notifications:get'),
  clear: (): Promise<boolean> => ipcRenderer.invoke('notifications:clear'),
});
