/** AI 工作状态 */
export enum AIStatus {
  /** 无 AI 活动 */
  Idle = 'idle',
  /** AI 正在工作 */
  Working = 'working',
  /** AI 已完成任务 */
  Done = 'done',
  /** AI 等待用户输入 */
  Waiting = 'waiting',
}

/** 监控器来源 */
export enum MonitorSource {
  FileWatcher = 'file-watcher',
  Terminal = 'terminal',
  Copilot = 'copilot',
  Cline = 'cline',
  /** zsh Shell Hook（precmd/preexec 写状态文件），精确终端信号 */
  ShellHook = 'shell-hook',
  /** Claude Desktop/Code 会话 jsonl（~/.claude/projects/*.jsonl 追加检测） */
  Claude = 'claude',
}

/** 活动事件 */
export interface ActivityEvent {
  id: string;
  timestamp: Date;
  status: AIStatus;
  source: MonitorSource;
  /** 涉及的文件列表 */
  files: string[];
  /** 持续时长（毫秒） */
  duration?: number;
  /** 附加信息 */
  message?: string;
}

/** 监控器发出的事件 */
export interface MonitorEvent {
  source: MonitorSource;
  type: 'activity' | 'done' | 'waiting' | 'idle';
  files?: string[];
  message?: string;
}

/** 状态变更事件 */
export interface StatusChangeEvent {
  previous: AIStatus;
  current: AIStatus;
  source: MonitorSource;
  timestamp: Date;
}
