import { AIStatus } from '../monitors/types';

export type MonitorEventType = 'activity' | 'done' | 'waiting' | 'idle';

/**
 * 状态机转移规则（纯逻辑，不依赖 vscode）
 *
 * 根据当前状态与事件类型计算下一状态；若状态不应改变，返回 null。
 * 提取为独立函数以便单元测试。
 *
 * 规则：
 * - activity: 非 Working → Working
 * - done:     仅 Working → Done
 * - waiting:  Working 或 Idle → Waiting
 * - idle:     非 Idle → Idle
 */
export function computeNextStatus(current: AIStatus, event: MonitorEventType): AIStatus | null {
  switch (event) {
    case 'activity':
      return current === AIStatus.Working ? null : AIStatus.Working;
    case 'done':
      return current === AIStatus.Working ? AIStatus.Done : null;
    case 'waiting':
      return current === AIStatus.Working || current === AIStatus.Idle
        ? AIStatus.Waiting
        : null;
    case 'idle':
      return current === AIStatus.Idle ? null : AIStatus.Idle;
  }
}
