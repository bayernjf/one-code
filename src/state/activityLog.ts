import * as vscode from 'vscode';
import { ActivityEvent, AIStatus, MonitorSource } from '../monitors/types';

let eventCounter = 0;

const STORAGE_KEY = 'aiWatchdog.activityLog';
const MAX_EVENTS = 100;

/** 全局持久化用的序列化结构（timestamp 存为毫秒数） */
interface SerializedEvent {
  id: string;
  timestamp: number;
  status: AIStatus;
  source: MonitorSource;
  files: string[];
  duration?: number;
  message?: string;
}

/**
 * 活动日志 - 记录所有 AI 活动历史
 *
 * 日志通过 vscode globalState 跨会话持久化，重启 VS Code 后仍可查看历史。
 */
export class ActivityLog {
  private events: ActivityEvent[] = [];
  private context?: vscode.ExtensionContext;

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    this.load();
  }

  /** 从 globalState 加载历史 */
  private load(): void {
    if (!this.context) {
      return;
    }
    const raw = this.context.globalState.get<SerializedEvent[]>(STORAGE_KEY, []);
    this.events = raw
      .map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }))
      .filter((e) => e.timestamp instanceof Date && !isNaN(e.timestamp.getTime()));
  }

  /** 持久化到 globalState */
  private save(): void {
    if (!this.context) {
      return;
    }
    const raw: SerializedEvent[] = this.events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.getTime(),
      status: e.status,
      source: e.source,
      files: e.files,
      duration: e.duration,
      message: e.message,
    }));
    this.context.globalState.update(STORAGE_KEY, raw);
  }

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
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(0, MAX_EVENTS);
    }

    this.save();
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
    this.save();
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
