import type { WatchdogConfig } from './config';

/**
 * 配置变更 → 动作计划（评审 P2-3 抽层，纯函数便于 node:test 单测）。
 *
 * 此前 onConfigChange 只处理 companion.enabled 与 enabled 两个开关，
 * 改 watchPatterns / ignorePatterns / monitors.* / companion.socketPath 后
 * 运行中的扩展不重建 watcher、不重连 socket，必须 reload window 才生效。
 * 这里把"哪些变更需要哪些重建动作"的判定收敛为一个纯函数。
 */
export interface ConfigChangePlan {
  /** 全局开关翻转（true→false 或反向），由调用方决定 start/stopMonitors。 */
  enabledToggled: boolean;
  /** 伴侣客户端：从无到有。 */
  startCompanion: boolean;
  /** 伴侣客户端：从有到无。 */
  stopCompanion: boolean;
  /** 伴侣保持启用但 socketPath 变了：dispose 后按新路径重建。 */
  reconnectCompanion: boolean;
  /** 监控相关参数变了：运行中时应 stopMonitors()+startMonitors() 重建。 */
  restartMonitors: boolean;
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function planConfigChange(prev: WatchdogConfig, next: WatchdogConfig): ConfigChangePlan {
  const startCompanion = !prev.companion.enabled && next.companion.enabled;
  const stopCompanion = prev.companion.enabled && !next.companion.enabled;
  const reconnectCompanion =
    prev.companion.enabled &&
    next.companion.enabled &&
    prev.companion.socketPath !== next.companion.socketPath;

  const restartMonitors =
    !sameStringArray(prev.watchPatterns, next.watchPatterns) ||
    !sameStringArray(prev.ignorePatterns, next.ignorePatterns) ||
    prev.monitors.copilot !== next.monitors.copilot ||
    prev.monitors.cline !== next.monitors.cline ||
    prev.monitors.terminal !== next.monitors.terminal ||
    prev.windowSize !== next.windowSize ||
    prev.activityThreshold !== next.activityThreshold ||
    prev.silenceTimeout !== next.silenceTimeout;

  return {
    enabledToggled: prev.enabled !== next.enabled,
    startCompanion,
    stopCompanion,
    reconnectCompanion,
    restartMonitors,
  };
}
