import { execFile } from 'node:child_process';
import { MonitorSource } from '@ai-watchdog/core';

/**
 * 根据信号来源聚焦对应的应用窗口
 *
 * 收到通知后点击，直接切到 AI 工具所在的应用，省去手动找窗口。
 */

const SOURCE_TO_APP: Partial<Record<MonitorSource, string>> = {
  [MonitorSource.Codex]: 'ChatGPT',
  [MonitorSource.Claude]: 'Claude',
  [MonitorSource.VSCodeCompanion]: 'Visual Studio Code',
  [MonitorSource.ShellHook]: 'Terminal',
  [MonitorSource.FileWatcher]: 'Visual Studio Code',
  [MonitorSource.Terminal]: 'Terminal',
};

export function getAppNameForSource(source: MonitorSource): string | undefined {
  return SOURCE_TO_APP[source];
}

export function focusAppForSource(source: MonitorSource): void {
  const appName = SOURCE_TO_APP[source];
  if (!appName) {
    return;
  }

  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `tell application "${appName}" to activate`], (err) => {
      if (err) {
        console.error(`[focusApp] failed to activate ${appName}:`, err.message);
      }
    });
  }
  // Windows / Linux 暂未实现（需对应平台的窗口切换方案）
}
