import * as vscode from 'vscode';
import { IMonitor, MonitorEvent, MonitorSource } from './types';
import { getConfig } from '../config';
import { RapidEditDetector } from './editWindow';
import { shouldIgnorePath } from '../util/paths';

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
  private editDetector: RapidEditDetector | undefined;
  private silenceTimer: NodeJS.Timeout | undefined;
  private isWorking = false;
  private recentFiles: Set<string> = new Set();
  private disposables: vscode.Disposable[] = [];

  start(): void {
    const config = getConfig();
    this.editDetector = new RapidEditDetector(config.windowSize * 1000, config.activityThreshold);
    this.createWatchers(config.watchPatterns);
  }

  stop(): void {
    this.disposeWatchers();
    this.clearSilenceTimer();
    this.isWorking = false;
    this.editDetector?.reset();
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
    if (shouldIgnorePath(uri.fsPath, config.ignorePatterns)) {
      return;
    }

    const now = Date.now();
    // 记录最近变更的绝对路径，供「一键接管」定位
    this.recentFiles.add(uri.fsPath);

    // 滑动窗口检测是否进入 working 状态
    const triggered = this.editDetector ? this.editDetector.record(now) : false;
    if (triggered && !this.isWorking) {
      this.isWorking = true;
      this._onActivity.fire({
        source: this.source,
        type: 'activity',
        files: Array.from(this.recentFiles),
        message: `检测到 AI 活动：${this.editDetector?.count ?? 0} 个文件变更`,
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
        this.editDetector?.reset();
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
    return shouldIgnorePath(uri.fsPath, ignorePatterns);
  }

  /** 返回最近发生变更的文件（绝对路径），供「一键接管」定位 */
  getRecentFiles(): string[] {
    return Array.from(this.recentFiles);
  }

  private disposeWatchers(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
