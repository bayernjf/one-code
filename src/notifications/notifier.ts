import * as vscode from 'vscode';
import { AIStatus, MonitorSource } from '../monitors/types';
import { getSourceName } from '../state/activityLog';

/**
 * VS Code 系统通知
 * 
 * 当 AI 完成或等待输入时弹出通知
 */
export class Notifier {
  /** AI 完成通知 */
  notifyDone(source: MonitorSource, duration?: string): void {
    const sourceName = getSourceName(source);
    const durationText = duration ? `，耗时 ${duration}` : '';

    vscode.window
      .showInformationMessage(
        `🎉 AI 编码完成！来源: ${sourceName}${durationText}`,
        '查看对话',
        '查看变更',
        '忽略'
      )
      .then((action) => {
        switch (action) {
          case '查看对话':
            vscode.commands.executeCommand('aiWatchdog.jumpToChat');
            break;
          case '查看变更':
            vscode.commands.executeCommand('aiwatchdog.takeover'); // 一键接管：定位最近改动
            break;
        }
      });
  }

  /** AI 等待输入通知 */
  notifyWaiting(source: MonitorSource, message?: string): void {
    const sourceName = getSourceName(source);
    const detail = message ? `\n${message}` : '';

    vscode.window
      .showWarningMessage(
        `⏳ AI 等待你的输入！来源: ${sourceName}${detail}`,
        '立即查看',
        '稍后处理'
      )
      .then((action) => {
        if (action === '立即查看') {
          vscode.commands.executeCommand('aiWatchdog.jumpToChat');
        }
      });
  }

  /** 状态变更通知（仅重要变更） */
  notifyStatusChange(status: AIStatus): void {
    // 只在关键状态变更时通知
    if (status === AIStatus.Done || status === AIStatus.Waiting) {
      return; // 这两个有专门的通知方法
    }
  }

  /** 监控开关通知 */
  notifyToggle(enabled: boolean): void {
    if (enabled) {
      vscode.window.showInformationMessage('👁️ AI Watchdog 已开启监控');
    } else {
      vscode.window.showInformationMessage('😴 AI Watchdog 已暂停监控');
    }
  }
}
