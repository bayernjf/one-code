/**
 * Shell Hook 公共定义（zsh / bash / fish 共用）
 *
 * 三种 shell 的 hook 片段各不相同，但捕获的命令集合、包裹标记和状态文件
 * 格式必须一致 —— ShellHookProbe 只认一个状态文件。
 */

/** 需要精确捕获的终端 AI CLI 命令名（与 config.DEFAULT_SHELL_TOOLS 保持一致） */
export const SHELL_TOOLS = [
  'claude',
  'claude-code',
  'codex',
  'opencode',
  'aider',
  'gemini',
  'qwen',
  'codebuddy',
] as const;

/** case 匹配模式（zsh / bash 用 `|` 分隔，fish 用空格分隔） */
export const SHELL_TOOLS_PATTERN = SHELL_TOOLS.join('|');

/** 状态文件内容结构（shell hook 写入，ShellHookProbe 解析） */
export interface ShellSessionState {
  active: boolean;
  tool?: string;
  pid?: number;
  startedAt?: number;
  updatedAt?: number;
}

/** 包裹标记：插入 rc 文件时用于定位整段，便于幂等安装 / 卸载（三种 shell 都以 # 注释） */
export const SHELL_HOOK_BEGIN = '# >>> AI Watchdog shell hook >>>';
export const SHELL_HOOK_END = '# <<< AI Watchdog shell hook <<<';
