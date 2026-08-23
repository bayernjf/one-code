import type * as vscode from 'vscode';
import { AIStatus, MonitorSource } from '@ai-watchdog/core';
import type { ActivityEvent, MonitorEvent, StatusChangeEvent } from '@ai-watchdog/core';

export { AIStatus, MonitorSource };
export type { ActivityEvent, MonitorEvent, StatusChangeEvent };

/** 监控器接口 */
export interface IMonitor extends vscode.Disposable {
  readonly source: MonitorSource;
  /** 启动监控 */
  start(): void;
  /** 停止监控 */
  stop(): void;
  /** 活动事件回调 */
  onActivity: vscode.Event<MonitorEvent>;
}
