/**
 * 桌面应用配置
 *
 * 阶段 1b 先用内存默认值 + 简单 JSON 文件持久化（后续接入设置 UI）。
 */
export interface WatchTarget {
  id: string;
  name: string;
  /** 监听目录（文件探针） */
  watchDirs: string[];
  /** 进程名匹配（进程探针，支持正则子串） */
  processPatterns: string[];
  /** 是否启用 */
  enabled: boolean;
}

export interface DesktopConfig {
  targets: WatchTarget[];
  /** 灵敏度（与扩展侧语义一致） */
  windowSize: number;
  activityThreshold: number;
  silenceTimeout: number;
}

export const DEFAULT_TARGETS: WatchTarget[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    watchDirs: [],
    processPatterns: ['Visual Studio Code', 'Code Helper', 'code'],
    enabled: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    watchDirs: [],
    processPatterns: ['Cursor', 'cursor'],
    enabled: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    watchDirs: [],
    processPatterns: ['Claude', 'claude'],
    enabled: true,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    watchDirs: [],
    processPatterns: ['Terminal', 'iTerm', 'alacritty', 'kitty'],
    enabled: true,
  },
];

export function getDefaultConfig(): DesktopConfig {
  return {
    targets: DEFAULT_TARGETS.map((t) => ({ ...t, watchDirs: [...t.watchDirs], processPatterns: [...t.processPatterns] })),
    windowSize: 3,
    activityThreshold: 3,
    silenceTimeout: 8,
  };
}
