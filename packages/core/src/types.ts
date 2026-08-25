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
  /** Codex 会话 rollout jsonl（~/.codex/sessions 追加检测，覆盖 ChatGPT 桌面端 / VS Code 扩展 / CLI） */
  Codex = 'codex',
  /** VS Code 扩展伴侣经本地 socket 上报的宿主内部深度信号 */
  VSCodeCompanion = 'vscode-companion',
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
/**
 * 信号权威性（分级留在信号源侧，探针自己声明）
 *
 * - `session`：宿主给出的确定性会话生命周期信号（Codex `task_complete`、
 *   Shell Hook 的 precmd/preexec）。「结束」是被告知的，不是猜的。
 * - `heuristic`：靠静默超时、频率窗口、文本模式推断出来的信号。
 *
 * 唯一用途：`session` 探针处于工作中时，压制 `heuristic` 的 done —— 否则文件
 * 探针的静默超时会抢在 Codex 真正完成前误报，并把真通知吞掉。
 */
export type SignalAuthority = 'session' | 'heuristic';

export interface MonitorEvent {
  source: MonitorSource;
  type: 'activity' | 'done' | 'waiting' | 'idle';
  files?: string[];
  message?: string;
  /** 缺省视为 heuristic：不声明就按「猜的」处理，也让伴侣无法经 socket 自称 session */
  authority?: SignalAuthority;
}

/** 状态变更事件 */
export interface StatusChangeEvent {
  previous: AIStatus;
  current: AIStatus;
  source: MonitorSource;
  timestamp: Date;
}
