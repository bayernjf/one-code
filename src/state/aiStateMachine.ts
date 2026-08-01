import * as vscode from 'vscode';
import { AIStatus, MonitorEvent, MonitorSource, StatusChangeEvent } from '../monitors/types';

/**
 * AI 状态机
 * 
 * 管理 AI 工作状态转换：
 * idle → working → done → idle
 *               ↘ waiting → idle
 */
export class AIStateMachine {
  private _status: AIStatus = AIStatus.Idle;
  private _workingSince: Date | undefined;
  private _lastSource: MonitorSource | undefined;

  private _onStatusChange = new vscode.EventEmitter<StatusChangeEvent>();
  readonly onStatusChange = this._onStatusChange.event;

  get status(): AIStatus {
    return this._status;
  }

  get workingSince(): Date | undefined {
    return this._workingSince;
  }

  get workingDuration(): number {
    if (!this._workingSince) {
      return 0;
    }
    return Date.now() - this._workingSince.getTime();
  }

  get lastSource(): MonitorSource | undefined {
    return this._lastSource;
  }

  /** 处理监控器事件，驱动状态转换 */
  handleEvent(event: MonitorEvent): void {
    const previous = this._status;

    switch (event.type) {
      case 'activity':
        if (this._status !== AIStatus.Working) {
          this._status = AIStatus.Working;
          this._workingSince = new Date();
          this._lastSource = event.source;
          this.emitChange(previous);
        }
        break;

      case 'done':
        if (this._status === AIStatus.Working) {
          this._status = AIStatus.Done;
          this._lastSource = event.source;
          this.emitChange(previous);
          // done 状态持续一段时间后自动回到 idle
          setTimeout(() => {
            if (this._status === AIStatus.Done) {
              const prev = this._status;
              this._status = AIStatus.Idle;
              this._workingSince = undefined;
              this.emitChange(prev);
            }
          }, 30000); // 30秒后自动回到 idle
        }
        break;

      case 'waiting':
        if (this._status === AIStatus.Working || this._status === AIStatus.Idle) {
          this._status = AIStatus.Waiting;
          this._lastSource = event.source;
          this.emitChange(previous);
        }
        break;

      case 'idle':
        if (this._status !== AIStatus.Idle) {
          const prev = this._status;
          this._status = AIStatus.Idle;
          this._workingSince = undefined;
          this.emitChange(prev);
        }
        break;
    }
  }

  /** 手动重置状态 */
  reset(): void {
    const previous = this._status;
    this._status = AIStatus.Idle;
    this._workingSince = undefined;
    this._lastSource = undefined;
    if (previous !== AIStatus.Idle) {
      this.emitChange(previous);
    }
  }

  /** 用户确认已查看（从 done/waiting 回到 idle） */
  acknowledge(): void {
    if (this._status === AIStatus.Done || this._status === AIStatus.Waiting) {
      const previous = this._status;
      this._status = AIStatus.Idle;
      this._workingSince = undefined;
      this.emitChange(previous);
    }
  }

  private emitChange(previous: AIStatus): void {
    this._onStatusChange.fire({
      previous,
      current: this._status,
      source: this._lastSource || MonitorSource.FileWatcher,
      timestamp: new Date(),
    });
  }

  dispose(): void {
    this._onStatusChange.dispose();
  }
}
