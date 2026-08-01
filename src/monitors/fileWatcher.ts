import * as vscode from 'vscode';
import { IMonitor, MonitorEvent, MonitorSource } from './types';
import { getConfig } from '../config';

/**
 * 文件系统监控器 - 通用 AI 活动检测核心
 * 
 * 原理：AI 编码工具在工作时会快速连续修改多个文件，
 * 通过滑动窗口检测文件变更频率来判定 AI 是否在工作中。
 */
export class FileWatcherMonitor implements IMonitor {
  readonly source = MonitorSource.FileWatcher;

  private _onActivity = new vscode.EventEmitter<MonitorEvent>();
  readonly onActivity = this._onActivity.event;

  private watchers: vscode.FileSystemWatcher[] = [];
  private changeTimestamps: number[] = [];
  private silenceTimer: NodeJS.Timeout | undefined;
  private isWorking = false;
  private recentFiles: Set<string> = new Set();
  private disposables: vscode.Disposable[] = [];

  start(): void {
    const config = getConfig();
    this.createWatchers(config.watchPatterns);
  }

  stop(): void {
    this.disposeWatchers();
    this.clearSilenceTimer();
    this.isWorking = false;
    this.changeTimestamps = [];
    this.recentFiles.clear();
  }

  dispose(): void {
    this.stop();
    this._onActivity.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private createWatchers(patterns: string[]): void {
    this.disposeWatchers();

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange((uri) => this.handleFileChange(uri), this, this.disposables);
      watcher.onDidCreate((uri) => this.handleFileChange(uri), this, this.disposables);
      watcher.onDidDelete((uri) => this.handleFileChange(uri), this, this.disposables);

      this.watchers.push(watcher);
    }

    // 同时监控文档保存事件（更精确）
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.handleFileChange(doc.uri);
      })
    );
  }

  private handleFileChange(uri: vscode.Uri): void {
    const config = getConfig();
    if (!config.enabled) {
      return;
    }

    // 过滤忽略模式
    if (this.shouldIgnore(uri, config.ignorePatterns)) {
      return;
    }

    const now = Date.now();
    this.changeTimestamps.push(now);
    this.recentFiles.add(this.getRelativePath(uri));

    // 清理窗口外的时间戳
    const windowMs = config.windowSize * 1000;
    this.changeTimestamps = this.changeTimestamps.filter((t) => now - t < windowMs);

    // 判定是否进入 working 状态
    if (this.changeTimestamps.length >= config.activityThreshold && !this.isWorking) {
      this.isWorking = true;
      this._onActivity.fire({
        source: this.source,
        type: 'activity',
        files: Array.from(this.recentFiles),
        message: `检测到 AI 活动：${this.changeTimestamps.length} 个文件变更`,
      });
    }

    // 重置静默计时器
    this.resetSilenceTimer(config.silenceTimeout);
  }

  private resetSilenceTimer(timeoutSec: number): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.isWorking = false;
        const files = Array.from(this.recentFiles);
        this._onActivity.fire({
          source: this.source,
          type: 'done',
          files,
          message: `AI 活动已停止，涉及 ${files.length} 个文件`,
        });
        this.recentFiles.clear();
        this.changeTimestamps = [];
      }
    }, timeoutSec * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private shouldIgnore(uri: vscode.Uri, ignorePatterns: string[]): boolean {
    const path = uri.fsPath;
    for (const pattern of ignorePatterns) {
      // 简单的路径匹配
      const cleanPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
      if (path.includes(cleanPattern.replace(/\//g, ''))) {
        return true;
      }
      // 更精确的目录匹配
      const dirPattern = pattern.replace(/\*\*\//g, '').replace(/\/\*\*/g, '');
      if (path.includes(dirPattern)) {
        return true;
      }
    }
    return false;
  }

  private getRelativePath(uri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      return uri.fsPath.replace(workspaceFolder.uri.fsPath + '/', '');
    }
    return uri.fsPath;
  }

  private disposeWatchers(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
