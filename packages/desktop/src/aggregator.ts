import { EventEmitter } from 'node:events';
import { AIStatus, MonitorEvent, MonitorSource, computeNextStatus } from '@ai-watchdog/core';

/**
 * 状态聚合引擎（宿主无关）
 *
 * 订阅多个探针的事件，用 core 的状态机转移规则驱动全局状态，
 * 并对 done/waiting 做防抖合并，避免多探针同时触发造成重复通知。
 */
export class Aggregator {
  private status: AIStatus = AIStatus.Idle;
  private workingSince: Date | undefined;
  private emitter = new EventEmitter();

  private lastDoneAt = 0;
  private lastWaitingAt = 0;
  private static readonly DEBOUNCE_MS = 1500;

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
    const next = computeNextStatus(this.status, event.type);
    if (next === null) {
      return;
    }

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
