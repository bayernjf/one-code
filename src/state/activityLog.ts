import * as vscode from 'vscode';
import { ActivityEvent, AIStatus, MonitorSource } from '../monitors/types';

let eventCounter = 0;

/**
 * 活动日志 - 记录所有 AI 活动历史
 */
export class ActivityLog {
  private events: ActivityEvent[] = [];
  private maxEvents = 100;

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** 添加活动记录 */
  addEvent(
    status: AIStatus,
    source: MonitorSource,
    files: string[] = [],
    duration?: number,
    message?: string
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: `evt-${Date.now()}-${++eventCounter}`,
      timestamp: new Date(),
      status,
      source,
      files,
      duration,
      message,
    };

    this.events.unshift(event); // 最新的在前面

    // 限制历史记录数量
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(0, this.maxEvents);
    }

    this._onDidChange.fire();
    return event;
  }

  /** 获取所有事件 */
  getEvents(): ActivityEvent[] {
    return [...this.events];
  }

  /** 获取最近 N 条事件 */
  getRecentEvents(count: number): ActivityEvent[] {
    return this.events.slice(0, count);
  }

  /** 清除所有历史 */
  clear(): void {
    this.events = [];
    this._onDidChange.fire();
  }

  /** 获取统计信息 */
  getStats(): {
    totalSessions: number;
    totalDuration: number;
    lastActivity?: Date;
  } {
    const doneEvents = this.events.filter((e) => e.status === AIStatus.Done);
    const totalDuration = doneEvents.reduce((sum, e) => sum + (e.duration || 0), 0);

    return {
      totalSessions: doneEvents.length,
      totalDuration,
      lastActivity: this.events[0]?.timestamp,
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/** 格式化持续时长 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/** 格式化时间戳 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** 获取状态对应的图标 */
export function getStatusIcon(status: AIStatus): string {
  switch (status) {
    case AIStatus.Idle:
      return '$(circle-outline)';
    case AIStatus.Working:
      return '$(sync~spin)';
    case AIStatus.Done:
      return '$(check)';
    case AIStatus.Waiting:
      return '$(comment-discussion)';
  }
}

/** 获取来源的显示名称 */
export function getSourceName(source: MonitorSource): string {
  switch (source) {
    case MonitorSource.FileWatcher:
      return '文件监控';
    case MonitorSource.Terminal:
      return '终端';
    case MonitorSource.Copilot:
      return 'Copilot';
    case MonitorSource.Cline:
      return 'Cline/Roo';
  }
}
