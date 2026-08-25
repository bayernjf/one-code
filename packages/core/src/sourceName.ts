import { MonitorSource } from './types';

/**
 * 信号来源的展示名（扩展与守护进程共用）
 *
 * 放在 core 是为了单一来源：这份映射曾两次因为新增 MonitorSource 而漏改，
 * 集中到一处后新增枚举成员会直接触发编译期穷尽性检查。
 */
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
    case MonitorSource.ShellHook:
      return 'Shell Hook';
    case MonitorSource.Claude:
      return 'Claude';
    case MonitorSource.Codex:
      return 'ChatGPT / Codex';
    case MonitorSource.VSCodeCompanion:
      return 'VS Code 伴侣';
  }
}
