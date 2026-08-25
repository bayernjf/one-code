import { EventEmitter } from 'node:events';
import { AIStatus, MonitorEvent, MonitorSource, computeNextStatus } from '@ai-watchdog/core';

/**
 * 状态聚合引擎（宿主无关）
 *
 * 订阅多个探针的事件，用 core 的状态机转移规则驱动全局状态，
 * 并对 done/waiting 做防抖合并，避免多探针同时触发造成重复通知。
 *
 * 另有一条仲裁规则：session 级探针（见 `SignalAuthority`）工作期间，
 * heuristic 探针的 done 被丢弃。
 */
export class Aggregator {
  /**
   * 短于此时长的任务不发完成通知（状态照常流转）。
   *
   * 真实 Codex rollout 回放显示大量 turn 在 4~15 秒内完成，一个会话文件能产生
   * 50 次 task_complete。这么短你还没离开屏幕，通知纯属噪音；通知的价值只在
   * 「你已经走开了」的场景。
   */
  private minWorkDurationMs = 30_000;

  /** 设置最短工作时长门槛（秒）；0 表示不设门槛。配置变更时可随时调整 */
  setMinWorkDuration(seconds: number): void {
    this.minWorkDurationMs = Math.max(0, seconds) * 1000;
  }

  private status: AIStatus = AIStatus.Idle;
  private workingSince: Date | undefined;
  private emitter = new EventEmitter();

  private lastDoneAt = 0;
  private lastWaitingAt = 0;
  private static readonly DEBOUNCE_MS = 1500;

  /** 正在工作的 session 级探针（其 done 才是权威的） */
  private activeSessions = new Set<MonitorSource>();

  get currentStatus(): AIStatus {
    return this.status;
  }

  get workingDuration(): number {
    return this.workingSince ? Date.now() - this.workingSince.getTime() : 0;
  }

  onStatusChange(callback: (status: AIStatus) => void): void {
    this.emitter.on('status', callback);
  }

  handleEvent(event: MonitorEvent): void {
    const isSession = event.authority === 'session';

    if (isSession) {
      if (event.type === 'activity') {
        this.activeSessions.add(event.source);
      } else {
        this.activeSessions.delete(event.source);
      }
    } else if (event.type === 'done' && this.activeSessions.size > 0) {
      // 会话探针明确还在工作：静默超时之类的推断性 done 是误报，丢掉。
      // 否则它会抢先把状态推到 Done，让随后真正的 task_complete 无处可去。
      return;
    }

    const next = computeNextStatus(this.status, event.type);
    if (next === null) {
      return;
    }

    const workedMs = this.workingSince ? Date.now() - this.workingSince.getTime() : undefined;

    this.status = next;
    if (event.type === 'activity') {
      this.workingSince = new Date();
    } else if (event.type === 'idle') {
      this.workingSince = undefined;
    }

    this.emitter.emit('status', this.status);

    // 防抖合并：done / waiting 只触发一次通知
    if (event.type === 'done') {
      const now = Date.now();
      if (now - this.lastDoneAt < Aggregator.DEBOUNCE_MS) {
        return;
      }
      // workingSince 为空说明没观察到起点（探针刚重启等），时长未知则照常通知
      if (workedMs !== undefined && workedMs < this.minWorkDurationMs) {
        return;
      }
      this.lastDoneAt = now;
      this.emitter.emit('notify', { type: 'done' as const, source: event.source });
    } else if (event.type === 'waiting') {
      const now = Date.now();
      if (now - this.lastWaitingAt < Aggregator.DEBOUNCE_MS) {
        return;
      }
      this.lastWaitingAt = now;
      this.emitter.emit('notify', { type: 'waiting' as const, source: event.source });
    }
  }

  /** 订阅通知事件（done/waiting 已防抖） */
  onNotify(callback: (payload: { type: 'done' | 'waiting'; source: MonitorSource }) => void): void {
    this.emitter.on('notify', callback);
  }

  acknowledge(): void {
    if (this.status === AIStatus.Done || this.status === AIStatus.Waiting) {
      this.status = AIStatus.Idle;
      this.workingSince = undefined;
      this.emitter.emit('status', this.status);
    }
  }
}
