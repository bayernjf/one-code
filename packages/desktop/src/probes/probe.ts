import { MonitorEvent, MonitorSource } from '@ai-watchdog/core';

/**
 * 探针接口（桌面应用宿主无关）
 *
 * 与 VS Code 扩展侧 IMonitor 语义一致，但不依赖 vscode，
 * 事件通过 Node EventEmitter 派发。
 */
export interface Probe {
  readonly source: MonitorSource;
  /** 启动探针 */
  start(): void;
  /** 停止探针 */
  stop(): void;
  /** 活动事件回调（由聚合引擎订阅） */
  onEvent(callback: (event: MonitorEvent) => void): void;
}
