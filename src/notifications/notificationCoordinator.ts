import { MonitorSource } from '../monitors/types';
import { Notifier } from './notifier';
import { SoundPlayer } from './soundPlayer';
import { DesktopNotifier } from './desktopNotify';
import { formatDuration } from '../util/format';
import { getSourceName } from '../state/activityLog';

/**
 * 通知协调器
 *
 * 多个监控器（文件 / 终端 / Copilot / Cline）会在 AI 完成或等待输入时
 * 几乎同时触发 done / waiting 事件。若不做处理，短时间内可能弹出多条
 * 重复通知、播放多次提示音。本协调器对同类事件做防抖合并：在防抖窗口内
 * 的重复事件只产生一条通知，避免打扰用户。
 */
export class NotificationCoordinator {
  private notifier: Notifier;
  private soundPlayer: SoundPlayer;
  private desktopNotifier: DesktopNotifier;

  /** done 防抖窗口（毫秒）：窗口内多次 done 合并为一条 */
  private static readonly DONE_DEBOUNCE_MS = 1500;
  /** waiting 防抖窗口（毫秒）：窗口内多次 waiting 合并为一条 */
  private static readonly WAITING_DEBOUNCE_MS = 1500;

  private lastDoneAt = 0;
  private lastWaitingAt = 0;

  constructor(notifier: Notifier, soundPlayer: SoundPlayer, desktopNotifier: DesktopNotifier) {
    this.notifier = notifier;
    this.soundPlayer = soundPlayer;
    this.desktopNotifier = desktopNotifier;
  }

  /** AI 完成通知（带防抖合并） */
  notifyDone(source: MonitorSource, durationMs: number): void {
    const now = Date.now();
    if (now - this.lastDoneAt < NotificationCoordinator.DONE_DEBOUNCE_MS) {
      // 窗口内已发过 done 通知，合并跳过
      return;
    }
    this.lastDoneAt = now;

    const durationText = formatDuration(durationMs);
    this.notifier.notifyDone(source, durationText);
    this.soundPlayer.playDone();
    this.desktopNotifier.notifyDone(getSourceName(source), durationText);
  }

  /** AI 等待输入通知（带防抖合并） */
  notifyWaiting(source: MonitorSource): void {
    const now = Date.now();
    if (now - this.lastWaitingAt < NotificationCoordinator.WAITING_DEBOUNCE_MS) {
      return;
    }
    this.lastWaitingAt = now;

    this.notifier.notifyWaiting(source);
    this.soundPlayer.playWaiting();
    this.desktopNotifier.notifyWaiting(getSourceName(source));
  }

  dispose(): void {
    // 无资源需释放，保留接口以便后续扩展
  }
}
