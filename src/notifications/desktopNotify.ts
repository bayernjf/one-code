import * as vscode from 'vscode';
import { getConfig } from '../config';

/**
 * 桌面级通知
 * 
 * 当 VS Code 不在前台时，发送系统级桌面通知。
 * 使用 node-notifier 实现跨平台支持。
 */
export class DesktopNotifier {
  private notifier: any = undefined;

  constructor() {
    this.loadNotifier();
  }

  private loadNotifier(): void {
    try {
      // 动态加载 node-notifier，避免打包问题
      this.notifier = require('node-notifier');
    } catch {
      // node-notifier 不可用时静默降级
      this.notifier = undefined;
    }
  }

  /** AI 完成桌面通知 */
  notifyDone(sourceName: string, duration?: string): void {
    const config = getConfig();
    if (!config.desktopNotify.enabled || !this.notifier) {
      return;
    }

    // 只在 VS Code 不在前台时发送桌面通知
    if (vscode.window.state.focused) {
      return;
    }

    const durationText = duration ? `\n耗时: ${duration}` : '';
    this.send({
      title: 'AI Watchdog - 编码完成',
      message: `AI 编码已完成！来源: ${sourceName}${durationText}`,
      sound: false, // 声音由 SoundPlayer 单独管理
    });
  }

  /** AI 等待输入桌面通知 */
  notifyWaiting(sourceName: string): void {
    const config = getConfig();
    if (!config.desktopNotify.enabled || !this.notifier) {
      return;
    }

    if (vscode.window.state.focused) {
      return;
    }

    this.send({
      title: 'AI Watchdog - 需要你的输入',
      message: `AI 正在等待你的确认/输入！\n来源: ${sourceName}`,
      sound: false,
    });
  }

  private send(options: { title: string; message: string; sound: boolean }): void {
    if (!this.notifier) {
      return;
    }

    try {
      this.notifier.notify(
        {
          title: options.title,
          message: options.message,
          sound: options.sound,
          timeout: 10,
          // macOS 特有
          subtitle: 'VS Code',
          // 点击通知时聚焦 VS Code
          actions: ['查看'],
        },
        (err: any, response: string) => {
          if (!err && response === 'activate') {
            // 用户点击了通知，聚焦 VS Code
            vscode.commands.executeCommand('workbench.action.focusWindow');
          }
        }
      );
    } catch {
      // 静默失败
    }
  }

  dispose(): void {
    this.notifier = undefined;
  }
}
