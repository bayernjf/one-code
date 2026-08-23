import { EventEmitter } from 'node:events';
import { execFile as execFileImpl } from 'node:child_process';
import { MonitorSource, MonitorEvent } from '@ai-watchdog/core';
import { Probe } from './probe';

/** execFile 签名（便于测试注入 mock） */
type ExecFileFn = (
  cmd: string,
  args: string[],
  options: { maxBuffer: number },
  callback: (err: Error | null, stdout: string) => void
) => void;

/**
 * 进程探针 - 检测目标应用进程是否活跃
 *
 * 这是「弱信号」探针：仅用于辅助仲裁（例如目标 App 已退出时
 * 立即判定 done），不单独触发「工作中」状态转移。
 *
 * macOS 实现用 `ps -axo comm` 轮询；后续按平台扩展。
 */
export class ProcessProbe implements Probe {
  readonly source = MonitorSource.Terminal;

  private emitter = new EventEmitter();
  private timer: NodeJS.Timeout | undefined;
  private lastActive = false;

  constructor(
    private processPatterns: string[],
    private intervalMs: number = 3000,
    private execFile: ExecFileFn = execFileImpl
  ) {}

  start(): void {
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /** 当前是否有目标进程在运行（供外部查询） */
  isActive(): boolean {
    return this.lastActive;
  }

  private poll(): void {
    this.execFile('ps', ['-axo', 'comm'], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        return;
      }
      const active = this.processPatterns.some((pattern) => {
        const re = new RegExp(pattern, 'i');
        return stdout.split('\n').some((line) => re.test(line));
      });

      if (active !== this.lastActive) {
        this.lastActive = active;
        // 仅当从「活跃」变为「不活跃」时，发出一个提示事件（弱信号，供仲裁）
        if (!active) {
          this.fire({
            source: this.source,
            type: 'done',
            message: 'Target application exited',
          });
        }
      }
    });
  }

  private fire(event: MonitorEvent): void {
    this.emitter.emit('event', event);
  }
}
