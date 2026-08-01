import * as vscode from 'vscode';
import { IMonitor, MonitorEvent, MonitorSource } from './types';
import { getConfig } from '../config';

/** 终端输出中表明 AI 完成的关键词 */
const DONE_PATTERNS = [
  /task completed/i,
  /done[.!]?$/im,
  /finished successfully/i,
  /all changes applied/i,
  /✓|✔|completed/i,
  /generation complete/i,
];

/** 终端输出中表明 AI 等待输入的关键词 */
const WAITING_PATTERNS = [
  /waiting for (your )?(input|response|confirmation)/i,
  /do you want to (continue|proceed|approve)/i,
  /press (y|enter) to continue/i,
  /approve|reject|skip\?/i,
  /\(y\/n\)/i,
  /would you like/i,
  /please confirm/i,
];

/** 终端输出中表明 AI 正在工作的关键词 */
const WORKING_PATTERNS = [
  /generating/i,
  /writing (code|file)/i,
  /applying changes/i,
  /editing/i,
  /creating file/i,
  /analyzing/i,
  /thinking/i,
];

/**
 * 终端输出监控器
 * 
 * 通过监控终端输出内容检测 AI CLI 工具的状态。
 * 使用 vscode.window.onDidWriteTerminalData (需要 proposed API)
 * 备选方案：监控终端打开/关闭事件
 */
export class TerminalWatcherMonitor implements IMonitor {
  readonly source = MonitorSource.Terminal;

  private _onActivity = new vscode.EventEmitter<MonitorEvent>();
  readonly onActivity = this._onActivity.event;

  private disposables: vscode.Disposable[] = [];
  private terminalDataListener: vscode.Disposable | undefined;
  private activeTerminals: Set<string> = new Set();
  private lastActivityTime = 0;
  private silenceTimer: NodeJS.Timeout | undefined;
  private isWorking = false;

  start(): void {
    const config = getConfig();
    if (!config.monitors.terminal) {
      return;
    }

    // 尝试使用 proposed API: onDidWriteTerminalData
    this.trySetupTerminalDataListener();

    // 基础监控：终端打开/关闭
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this.activeTerminals.add(terminal.name);
      })
    );

    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.activeTerminals.delete(terminal.name);
        // 终端关闭可能意味着 AI CLI 任务完成
        if (this.isWorking) {
          this.emitDone('AI 终端已关闭');
        }
      })
    );
  }

  stop(): void {
    this.terminalDataListener?.dispose();
    this.terminalDataListener = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.activeTerminals.clear();
    this.clearSilenceTimer();
    this.isWorking = false;
  }

  dispose(): void {
    this.stop();
    this._onActivity.dispose();
  }

  private trySetupTerminalDataListener(): void {
    try {
      // onDidWriteTerminalData 是 proposed API
      const windowAny = vscode.window as any;
      if (windowAny.onDidWriteTerminalData) {
        this.terminalDataListener = windowAny.onDidWriteTerminalData(
          (e: { terminal: vscode.Terminal; data: string }) => {
            this.handleTerminalData(e.terminal, e.data);
          }
        );
      }
    } catch {
      // proposed API 不可用，使用备选方案
    }
  }

  private handleTerminalData(terminal: vscode.Terminal, data: string): void {
    const config = getConfig();
    if (!config.enabled || !config.monitors.terminal) {
      return;
    }

    // 去除 ANSI 转义序列
    const cleanData = data.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!cleanData) {
      return;
    }

    // 检测等待输入
    if (WAITING_PATTERNS.some((p) => p.test(cleanData))) {
      this.isWorking = false;
      this.clearSilenceTimer();
      this._onActivity.fire({
        source: this.source,
        type: 'waiting',
        message: `终端 [${terminal.name}] 等待输入`,
      });
      return;
    }

    // 检测完成
    if (DONE_PATTERNS.some((p) => p.test(cleanData))) {
      if (this.isWorking) {
        this.emitDone(`终端 [${terminal.name}] 任务完成`);
      }
      return;
    }

    // 检测工作中
    if (WORKING_PATTERNS.some((p) => p.test(cleanData))) {
      this.lastActivityTime = Date.now();
      if (!this.isWorking) {
        this.isWorking = true;
        this._onActivity.fire({
          source: this.source,
          type: 'activity',
          message: `终端 [${terminal.name}] 检测到 AI 活动`,
        });
      }
      this.resetSilenceTimer(config.silenceTimeout);
    }
  }

  private resetSilenceTimer(timeoutSec: number): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.emitDone('终端 AI 活动超时停止');
      }
    }, timeoutSec * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private emitDone(message: string): void {
    this.isWorking = false;
    this.clearSilenceTimer();
    this._onActivity.fire({
      source: this.source,
      type: 'done',
      message,
    });
  }
}
