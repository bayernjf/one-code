import { contextBridge, ipcRenderer } from 'electron';
import { DesktopConfig } from './config';
import type { UpdaterCheckResult, UpdaterStatus } from './updater';

/**
 * 预加载脚本：通过 contextBridge 暴露最小化的 IPC 接口给渲染进程
 */
contextBridge.exposeInMainWorld('settingsAPI', {
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke('settings:get'),
  saveConfig: (config: DesktopConfig): Promise<boolean> => ipcRenderer.invoke('settings:save', config),

  // 更新相关
  checkForUpdates: (): Promise<UpdaterCheckResult> => ipcRenderer.invoke('updater:check'),
  getUpdaterStatus: (): Promise<UpdaterStatus> => ipcRenderer.invoke('updater:getStatus'),
  quitAndInstall: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('updater:quitAndInstall'),
});
