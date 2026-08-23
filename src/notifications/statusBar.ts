import * as vscode from 'vscode';
import { AIStatus } from '../monitors/types';
import { formatDuration } from '@ai-watchdog/core';

/**
 * 状态栏指示器
 * 
 * 在 VS Code 底部状态栏显示 AI 工作状态
 */
export class StatusBarIndicator {
  private statusBarItem: vscode.StatusBarItem;
  private timerInterval: NodeJS.Timeout | undefined;
  private workingSince: Date | undefined;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'aiWatchdog.showStatus';
    this.setIdle();
    this.statusBarItem.show();
  }

  /** 更新状态显示 */
  update(status: AIStatus, workingSince?: Date): void {
    this.workingSince = workingSince;
    this.clearTimer();

    switch (status) {
      case AIStatus.Idle:
        this.setIdle();
        break;
      case AIStatus.Working:
        this.setWorking();
        this.startTimer();
        break;
      case AIStatus.Done:
        this.setDone();
        break;
      case AIStatus.Waiting:
        this.setWaiting();
        break;
    }
  }

  private setIdle(): void {
    this.statusBarItem.text = '$(eye) AI Watchdog';
    this.statusBarItem.tooltip = 'AI Watchdog: 监控中，无 AI 活动';
    this.statusBarItem.backgroundColor = undefined;
  }

  private setWorking(): void {
    this.statusBarItem.text = '$(sync~spin) AI 工作中...';
    this.statusBarItem.tooltip = 'AI Watchdog: 检测到 AI 正在工作';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
  }

  private setDone(): void {
    const duration = this.workingSince
      ? formatDuration(Date.now() - this.workingSince.getTime())
      : '';
    this.statusBarItem.text = `$(check) AI 已完成${duration ? ` (${duration})` : ''}`;
    this.statusBarItem.tooltip = 'AI Watchdog: AI 已完成工作，点击查看';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
    this.statusBarItem.command = 'aiWatchdog.jumpToChat';
  }

  private setWaiting(): void {
    this.statusBarItem.text = '$(comment-discussion) AI 等待输入';
    this.statusBarItem.tooltip = 'AI Watchdog: AI 正在等待你的输入，点击跳转';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    this.statusBarItem.command = 'aiWatchdog.jumpToChat';
  }

  private startTimer(): void {
    this.timerInterval = setInterval(() => {
      if (this.workingSince) {
        const duration = formatDuration(Date.now() - this.workingSince.getTime());
        this.statusBarItem.text = `$(sync~spin) AI 工作中 ${duration}`;
      }
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  /** 闪烁提醒 */
  flash(times: number = 3): void {
    let count = 0;
    const originalText = this.statusBarItem.text;
    const interval = setInterval(() => {
      if (count >= times * 2) {
        clearInterval(interval);
        this.statusBarItem.text = originalText;
        return;
      }
      this.statusBarItem.text = count % 2 === 0 ? '⚡ ' + originalText : originalText;
      count++;
    }, 500);
  }

  dispose(): void {
    this.clearTimer();
    this.statusBarItem.dispose();
  }
}
