import { EventEmitter } from 'node:events';
import { RapidEditDetector, shouldIgnorePath, MonitorSource, MonitorEvent } from '@ai-watchdog/core';
import chokidar, { FSWatcher } from 'chokidar';
import { Probe } from './probe';

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/target/**',
];

/**
 * 文件探针 - 通用 AI 活动检测核心
 *
 * 复用 core 的滑动窗口检测器：在固定时间窗口内统计文件变更次数，
 * 达到阈值判定「AI 正在批量修改文件」，静默超时判定「完成」。
 * 这是跨产品通用的强信号，不依赖任何具体 AI 工具。
 */
export class FileProbe implements Probe {
  readonly source = MonitorSource.FileWatcher;

  private emitter = new EventEmitter();
  private watchers: FSWatcher[] = [];
  private detector: RapidEditDetector | undefined;
  private silenceTimer: NodeJS.Timeout | undefined;
  private isWorking = false;
  private recentFiles: Set<string> = new Set();

  constructor(
    private watchDirs: string[],
    private windowMs: number,
    private threshold: number,
    private silenceTimeoutSec: number,
    private ignorePatterns: string[] = DEFAULT_IGNORE
  ) {}

  start(): void {
    this.detector = new RapidEditDetector(this.windowMs, this.threshold);
    for (const dir of this.watchDirs) {
      const watcher = chokidar.watch(dir, {
        ignored: this.ignorePatterns,
        ignoreInitial: true,
        persistent: true,
      });
      watcher.on('add', (p) => this.handleChange(p));
      watcher.on('change', (p) => this.handleChange(p));
      watcher.on('unlink', (p) => this.handleChange(p));
      this.watchers.push(watcher);
    }
  }

  stop(): void {
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    this.clearSilenceTimer();
    this.isWorking = false;
    this.detector?.reset();
    this.recentFiles.clear();
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  private handleChange(filePath: string): void {
    if (shouldIgnorePath(filePath, this.ignorePatterns)) {
      return;
    }
    const now = Date.now();
    this.recentFiles.add(filePath);

    const triggered = this.detector ? this.detector.record(now) : false;
    if (triggered && !this.isWorking) {
      this.isWorking = true;
      this.fire({
        source: this.source,
        type: 'activity',
        files: Array.from(this.recentFiles),
        message: `Detected AI activity: ${this.detector?.count ?? 0} file changes`,
      });
    }
    this.resetSilenceTimer();
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.isWorking = false;
        const files = Array.from(this.recentFiles);
        this.fire({
          source: this.source,
          type: 'done',
          files,
          message: `AI activity stopped, ${files.length} files touched`,
        });
        this.recentFiles.clear();
        this.detector?.reset();
      }
    }, this.silenceTimeoutSec * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private fire(event: MonitorEvent): void {
    this.emitter.emit('event', event);
  }
}
