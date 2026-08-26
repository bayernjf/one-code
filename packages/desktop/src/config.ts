/**
 * 桌面应用配置
 *
 * 阶段 1b 先用内存默认值 + 简单 JSON 文件持久化（后续接入设置 UI）。
 */
import os from 'node:os';
import path from 'node:path';
import { companionSocketPath } from '@ai-watchdog/core';
export interface WatchTarget {
  id: string;
  name: string;
  /** 监听目录（文件探针） */
  watchDirs: string[];
  /** 进程名匹配（进程探针，支持正则子串） */
  processPatterns: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 是否启用该目标的通知 */
  notifyEnabled: boolean;
}

/** Shell Hook 配置（精确终端监控） */
export interface ShellHookConfig {
  /** 是否启用 Shell Hook 探针 */
  enabled: boolean;
  /** zsh hook 写入的状态文件路径 */
  stateFile: string;
  /** 需要精确捕获的终端 AI CLI 命令名 */
  tools: string[];
}

/** Claude Desktop/Code 会话探针配置 */
export interface ClaudeConfig {
  /** 会话 jsonl 所在目录（~/.claude/projects） */
  projectsDir: string;
}

/** Codex 会话探针配置（覆盖 ChatGPT 桌面端 / VS Code 扩展 / CLI） */
export interface CodexConfig {
  /** rollout jsonl 根目录（~/.codex/sessions） */
  sessionsDir: string;
  /** turn 超过该时长仍未结束则视为宿主异常退出，清理掉 */
  maxTurnMinutes: number;
}

/** 伴侣深度信号配置（VS Code 扩展经本地 socket 上报） */
export interface CompanionConfig {
  /** 是否监听伴侣 socket */
  enabled: boolean;
  /** socket 路径（Windows 为命名管道） */
  socketPath: string;
}

/** 勿扰模式配置 */
export interface DndConfig {
  /** 手动开关（优先级最高） */
  enabled: boolean;
  /** 是否启用定时时段 */
  scheduleEnabled: boolean;
  /** 时段开始（HH:MM） */
  scheduleStart: string;
  /** 时段结束（HH:MM），可跨午夜 */
  scheduleEnd: string;
  /** 勿扰期间是否仍通知 waiting（等待输入可能阻塞 AI，比 done 更紧急） */
  onlyWaiting: boolean;
}

/** 远程通知配置 */
export interface RemoteNotifyConfig {
  /** Webhook URL（留空禁用） */
  webhookUrl: string;
  /** ntfy topic（留空禁用） */
  ntfyTopic: string;
  /** ntfy 服务器地址（默认 https://ntfy.sh） */
  ntfyServer: string;
}

export interface DesktopConfig {
  targets: WatchTarget[];
  /** 灵敏度（与扩展侧语义一致） */
  windowSize: number;
  activityThreshold: number;
  silenceTimeout: number;
  /** 短于此时长的任务不发完成通知（秒）；0 表示不设门槛 */
  minWorkDuration: number;
  /** 开机自启 */
  autoStart: boolean;
  /** 全局快捷键（显示当前状态），空字符串表示不注册 */
  globalShortcut: string;
  /** 仅在 AI 工具失焦时通知（工具在前台时不弹通知） */
  notifyOnlyOnBlur: boolean;
  /** Shell Hook 精确终端信号 */
  shellHook: ShellHookConfig;
  /** Claude 会话 jsonl 探针 */
  claude: ClaudeConfig;
  /** Codex 会话 rollout 探针 */
  codex: CodexConfig;
  /** 伴侣深度信号 */
  companion: CompanionConfig;
  /** 勿扰模式 */
  dnd: DndConfig;
  /** 远程通知 */
  remoteNotify: RemoteNotifyConfig;
}

/** 默认精确捕获的终端 AI CLI 命令名（与 zsh 片段保持一致） */
export const DEFAULT_SHELL_TOOLS = [
  'claude',
  'claude-code',
  'codex',
  'opencode',
  'aider',
  'gemini',
  'qwen',
  'codebuddy',
];

export const DEFAULT_TARGETS: WatchTarget[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    watchDirs: [],
    processPatterns: ['Visual Studio Code', 'Code Helper', 'code'],
    enabled: true,
    notifyEnabled: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    watchDirs: [],
    processPatterns: ['Cursor', 'cursor'],
    enabled: true,
    notifyEnabled: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    watchDirs: [],
    processPatterns: ['Claude', 'claude'],
    enabled: true,
    notifyEnabled: true,
  },
  {
    // 进程名不参与判定：ChatGPT.app 常驻后台，进程存在不等于在干活，
    // 状态完全由 CodexSessionProbe 的 rollout 事件给出
    id: 'codex',
    name: 'ChatGPT / Codex',
    watchDirs: [],
    processPatterns: [],
    enabled: true,
    notifyEnabled: true,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    watchDirs: [],
    processPatterns: ['Terminal', 'iTerm', 'alacritty', 'kitty'],
    enabled: true,
    notifyEnabled: true,
  },
];

export function getDefaultConfig(): DesktopConfig {
  return {
    targets: DEFAULT_TARGETS.map((t) => ({ ...t, watchDirs: [...t.watchDirs], processPatterns: [...t.processPatterns], notifyEnabled: t.notifyEnabled })),
    windowSize: 3,
    activityThreshold: 3,
    silenceTimeout: 8,
    minWorkDuration: 30,
    autoStart: false,
    globalShortcut: 'Alt+Command+W',
    notifyOnlyOnBlur: false,
    shellHook: {
      enabled: true,
      stateFile: shellHookStateFile(),
      tools: [...DEFAULT_SHELL_TOOLS],
    },
    claude: {
      projectsDir: claudeProjectsDir(),
    },
    codex: {
      sessionsDir: codexSessionsDir(),
      maxTurnMinutes: 30,
    },
    companion: {
      enabled: true,
      socketPath: companionSocketPath(),
    },
    dnd: {
      enabled: false,
      scheduleEnabled: false,
      scheduleStart: '22:00',
      scheduleEnd: '08:00',
      onlyWaiting: false,
    },
    remoteNotify: {
      webhookUrl: '',
      ntfyTopic: '',
      ntfyServer: 'https://ntfy.sh',
    },
  };
}

/** 默认 Shell Hook 状态文件路径 */
export function shellHookStateFile(homedir = os.homedir()): string {
  return path.join(homedir, '.ai-watchdog', 'terminal.json');
}

/** 默认 Claude 会话 jsonl 目录（~/.claude/projects） */
export function claudeProjectsDir(homedir = os.homedir()): string {
  return path.join(homedir, '.claude', 'projects');
}

/** 默认 Codex 会话 rollout 目录（~/.codex/sessions） */
export function codexSessionsDir(homedir = os.homedir()): string {
  return path.join(homedir, '.codex', 'sessions');
}
