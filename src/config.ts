import * as vscode from 'vscode';

export interface WatchdogConfig {
  enabled: boolean;
  silenceTimeout: number;
  activityThreshold: number;
  windowSize: number;
  sound: {
    enabled: boolean;
    volume: number;
  };
  desktopNotify: {
    enabled: boolean;
  };
  watchPatterns: string[];
  ignorePatterns: string[];
  monitors: {
    copilot: boolean;
    cline: boolean;
    terminal: boolean;
  };
  companion: {
    enabled: boolean;
    /** 空串表示使用 core 默认 socket 路径 */
    socketPath: string;
  };
}

export function getConfig(): WatchdogConfig {
  const cfg = vscode.workspace.getConfiguration('aiWatchdog');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    silenceTimeout: cfg.get<number>('silenceTimeout', 8),
    activityThreshold: cfg.get<number>('activityThreshold', 3),
    windowSize: cfg.get<number>('windowSize', 3),
    sound: {
      enabled: cfg.get<boolean>('sound.enabled', true),
      volume: cfg.get<number>('sound.volume', 0.7),
    },
    desktopNotify: {
      enabled: cfg.get<boolean>('desktopNotify.enabled', true),
    },
    watchPatterns: cfg.get<string[]>('watchPatterns', [
      '**/*.{ts,tsx,js,jsx,py,go,rs,java,vue,css,scss,html,json,md,yaml,yml,toml}',
    ]),
    ignorePatterns: cfg.get<string[]>('ignorePatterns', [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/__pycache__/**',
      '**/target/**',
    ]),
    monitors: {
      copilot: cfg.get<boolean>('monitors.copilot', true),
      cline: cfg.get<boolean>('monitors.cline', true),
      terminal: cfg.get<boolean>('monitors.terminal', true),
    },
    companion: {
      enabled: cfg.get<boolean>('companion.enabled', true),
      socketPath: cfg.get<string>('companion.socketPath', ''),
    },
  };
}

/** 监听配置变更 */
export function onConfigChange(callback: (config: WatchdogConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('aiWatchdog')) {
      callback(getConfig());
    }
  });
}
