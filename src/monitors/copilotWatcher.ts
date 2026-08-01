import * as vscode from 'vscode';
import { IMonitor, MonitorEvent, MonitorSource } from './types';
import { getConfig } from '../config';

/**
 * GitHub Copilot Chat 监控器
 * 
 * 通过以下方式检测 Copilot 活动：
 * 1. 检测 github.copilot / github.copilot-chat 扩展状态
 * 2. 监控 Copilot 输出通道
 * 3. 监控 Copilot 相关的临时文件变更
 */
export class CopilotWatcherMonitor implements IMonitor {
  readonly source = MonitorSource.Copilot;

  private _onActivity = new vscode.EventEmitter<MonitorEvent>();
  readonly onActivity = this._onActivity.event;

  private disposables: vscode.Disposable[] = [];
  private outputChannelWatcher: vscode.FileSystemWatcher | undefined;
  private isWorking = false;
  private silenceTimer: NodeJS.Timeout | undefined;
  private progressToken: vscode.Disposable | undefined;

  start(): void {
    const config = getConfig();
    if (!config.monitors.copilot) {
      return;
    }

    this.setupCopilotDetection();
  }

  stop(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.outputChannelWatcher?.dispose();
    this.progressToken?.dispose();
    this.clearSilenceTimer();
    this.isWorking = false;
  }

  dispose(): void {
    this.stop();
    this._onActivity.dispose();
  }

  private setupCopilotDetection(): void {
    // 方法1: 监控 Copilot 扩展的激活状态
    const copilotExt = vscode.extensions.getExtension('github.copilot');
    const copilotChatExt = vscode.extensions.getExtension('github.copilot-chat');

    if (copilotExt || copilotChatExt) {
      this.setupProgressMonitoring();
    }

    // 方法2: 监控 Copilot 的 ghost text / inline completion 活动
    // 通过 vscode.languages 相关事件间接检测
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        // Copilot 在工作时通常会触发选区变化
        this.checkCopilotActivity();
      })
    );

    // 方法3: 尝试使用 vscode.lm API (Language Model API)
    this.trySetupLmApi();

    // 方法4: 监控 Copilot Chat 面板的可见性变化
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.checkCopilotActivity();
      })
    );
  }

  private setupProgressMonitoring(): void {
    // 使用 withProgress 检测机制：
    // 当 Copilot 在生成代码时，VS Code 会显示进度条
    // 我们通过定期检查来间接判断
    const interval = setInterval(() => {
      this.checkCopilotActivity();
    }, 2000);

    this.disposables.push(new vscode.Disposable(() => clearInterval(interval)));
  }

  private trySetupLmApi(): void {
    try {
      const lm = (vscode as any).lm;
      if (lm && lm.onDidChangeChatModels) {
        this.disposables.push(
          lm.onDidChangeChatModels(() => {
            this._onActivity.fire({
              source: this.source,
              type: 'activity',
              message: 'Copilot 模型活动检测',
            });
          })
        );
      }
    } catch {
      // lm API 不可用
    }
  }

  private checkCopilotActivity(): void {
    const config = getConfig();
    if (!config.enabled || !config.monitors.copilot) {
      return;
    }

    // 检查 Copilot 扩展是否正在活跃
    const copilotChatExt = vscode.extensions.getExtension('github.copilot-chat');
    if (copilotChatExt?.isActive) {
      // 检查是否有活跃的 chat session
      // 通过检测最近的文件编辑模式来判断
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        // 如果编辑器在最近几秒内有大量变更，可能是 Copilot 在工作
        this.detectRapidEdits();
      }
    }
  }

  private lastEditCount = 0;
  private editCheckTimer: NodeJS.Timeout | undefined;

  private detectRapidEdits(): void {
    // 通过 document version 变化检测
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const currentVersion = editor.document.version;
    if (currentVersion > this.lastEditCount + 2) {
      // 短时间内版本跳跃较大，可能是 AI 在工作
      if (!this.isWorking) {
        this.isWorking = true;
        this._onActivity.fire({
          source: this.source,
          type: 'activity',
          files: [editor.document.fileName],
          message: 'Copilot 可能正在生成代码',
        });
      }
      this.resetSilenceTimer();
    }
    this.lastEditCount = currentVersion;
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    const config = getConfig();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.isWorking = false;
        this._onActivity.fire({
          source: this.source,
          type: 'done',
          message: 'Copilot 活动已停止',
        });
      }
    }, config.silenceTimeout * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }
}
