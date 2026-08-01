import * as vscode from 'vscode';
import { IMonitor, MonitorEvent, MonitorSource } from './types';
import { getConfig } from '../config';

/** Cline/Roo Code 完成模式 */
const CLINE_DONE_PATTERNS = [
  /task completed/i,
  /cline has completed/i,
  /roo has completed/i,
  /task finished/i,
  /<task_completed>/i,
  /result:/i,
];

/** Cline/Roo Code 等待确认模式 */
const CLINE_WAITING_PATTERNS = [
  /do you want to proceed/i,
  /approve|reject/i,
  /waiting for (your )?(approval|confirmation|response)/i,
  /<ask_followup_question>/i,
  /<attempt_completion>/i,
  /would you like me to/i,
  /shall i/i,
  /does this look correct/i,
];

/** Cline/Roo Code 工作模式 */
const CLINE_WORKING_PATTERNS = [
  /<write_to_file>/i,
  /<execute_command>/i,
  /<read_file>/i,
  /<search_files>/i,
  /<list_files>/i,
  /<replace_in_file>/i,
  /cline is working/i,
  /roo is working/i,
  /thinking\.\.\./i,
];

/**
 * Cline / Roo Code 监控器
 * 
 * 通过以下方式检测 Cline/Roo 活动：
 * 1. 监控 Cline 输出通道
 * 2. 检测 Cline 特有的 XML 标签模式
 * 3. 监控 Cline 的临时文件（.clinerules 等）
 */
export class ClineWatcherMonitor implements IMonitor {
  readonly source = MonitorSource.Cline;

  private _onActivity = new vscode.EventEmitter<MonitorEvent>();
  readonly onActivity = this._onActivity.event;

  private disposables: vscode.Disposable[] = [];
  private isWorking = false;
  private silenceTimer: NodeJS.Timeout | undefined;
  private outputChannelListener: vscode.Disposable | undefined;

  start(): void {
    const config = getConfig();
    if (!config.monitors.cline) {
      return;
    }

    this.setupClineDetection();
  }

  stop(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.outputChannelListener?.dispose();
    this.clearSilenceTimer();
    this.isWorking = false;
  }

  dispose(): void {
    this.stop();
    this._onActivity.dispose();
  }

  private setupClineDetection(): void {
    // 方法1: 检测 Cline/Roo 扩展是否存在并活跃
    const clineExt = vscode.extensions.getExtension('saoudrizwan.claude-dev');
    const rooExt = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');

    if (clineExt || rooExt) {
      this.setupOutputMonitoring();
    }

    // 方法2: 监控 Cline 相关文件的变更
    const clineWatcher = vscode.workspace.createFileSystemWatcher('**/.clinerules*');
    this.disposables.push(clineWatcher);
    clineWatcher.onDidChange(() => this.handleClineActivity('Cline 规则文件变更'));
    clineWatcher.onDidCreate(() => this.handleClineActivity('Cline 会话开始'));

    // 方法3: 监控 Cline 的 task 目录
    const taskWatcher = vscode.workspace.createFileSystemWatcher('**/.cline/**');
    this.disposables.push(taskWatcher);
    taskWatcher.onDidChange(() => this.handleClineActivity('Cline 任务文件变更'));
    taskWatcher.onDidCreate(() => this.handleClineActivity('Cline 新任务'));

    // 方法4: 监控 Roo Code 的目录
    const rooWatcher = vscode.workspace.createFileSystemWatcher('**/.roo/**');
    this.disposables.push(rooWatcher);
    rooWatcher.onDidChange(() => this.handleClineActivity('Roo Code 活动'));
    rooWatcher.onDidCreate(() => this.handleClineActivity('Roo Code 新任务'));

    // 方法5: 通过 webview 面板检测
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.checkClineWebview();
      })
    );
  }

  private setupOutputMonitoring(): void {
    // 尝试拦截 Cline 的输出通道
    // 注意：VS Code 不直接暴露其他扩展的 OutputChannel 内容
    // 我们通过文件系统间接检测

    // 定期检查 Cline 扩展状态
    const interval = setInterval(() => {
      const clineExt = vscode.extensions.getExtension('saoudrizwan.claude-dev');
      const rooExt = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');

      if (clineExt?.isActive || rooExt?.isActive) {
        this.checkClineWebview();
      }
    }, 3000);

    this.disposables.push(new vscode.Disposable(() => clearInterval(interval)));
  }

  private checkClineWebview(): void {
    // 检测当前是否有 Cline 的 webview 面板活跃
    // Cline 使用 webview 作为主要交互界面
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      // 没有活跃编辑器时，可能用户在 Cline webview 中
      // 这暗示 Cline 可能正在等待用户交互
      const clineExt = vscode.extensions.getExtension('saoudrizwan.claude-dev');
      const rooExt = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');

      if ((clineExt?.isActive || rooExt?.isActive) && this.isWorking) {
        // 如果 Cline 活跃且之前在工作中，现在没有编辑器焦点
        // 可能在等待用户确认
        this._onActivity.fire({
          source: this.source,
          type: 'waiting',
          message: 'Cline/Roo 可能在等待你的确认',
        });
        this.isWorking = false;
        this.clearSilenceTimer();
      }
    }
  }

  private handleClineActivity(message: string): void {
    const config = getConfig();
    if (!config.enabled || !config.monitors.cline) {
      return;
    }

    if (!this.isWorking) {
      this.isWorking = true;
      this._onActivity.fire({
        source: this.source,
        type: 'activity',
        message,
      });
    }

    this.resetSilenceTimer(config.silenceTimeout);
  }

  /** 供外部调用：当检测到 Cline 输出内容时 */
  handleOutput(data: string): void {
    const config = getConfig();
    if (!config.enabled || !config.monitors.cline) {
      return;
    }

    // 检测等待
    if (CLINE_WAITING_PATTERNS.some((p) => p.test(data))) {
      this.isWorking = false;
      this.clearSilenceTimer();
      this._onActivity.fire({
        source: this.source,
        type: 'waiting',
        message: 'Cline/Roo 等待你的确认',
      });
      return;
    }

    // 检测完成
    if (CLINE_DONE_PATTERNS.some((p) => p.test(data))) {
      if (this.isWorking) {
        this.isWorking = false;
        this.clearSilenceTimer();
        this._onActivity.fire({
          source: this.source,
          type: 'done',
          message: 'Cline/Roo 任务已完成',
        });
      }
      return;
    }

    // 检测工作中
    if (CLINE_WORKING_PATTERNS.some((p) => p.test(data))) {
      this.handleClineActivity('Cline/Roo 正在工作');
    }
  }

  private resetSilenceTimer(timeoutSec: number): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.isWorking = false;
        this._onActivity.fire({
          source: this.source,
          type: 'done',
          message: 'Cline/Roo 活动已停止',
        });
      }
    }, timeoutSec * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }
}
