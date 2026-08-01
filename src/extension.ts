import * as vscode from 'vscode';
import { getConfig, onConfigChange } from './config';
import { AIStatus, MonitorEvent, MonitorSource } from './monitors/types';
import { FileWatcherMonitor } from './monitors/fileWatcher';
import { TerminalWatcherMonitor } from './monitors/terminalWatcher';
import { CopilotWatcherMonitor } from './monitors/copilotWatcher';
import { ClineWatcherMonitor } from './monitors/clineWatcher';
import { AIStateMachine } from './state/aiStateMachine';
import { ActivityLog, formatDuration } from './state/activityLog';
import { StatusBarIndicator } from './notifications/statusBar';
import { Notifier } from './notifications/notifier';
import { SoundPlayer } from './notifications/soundPlayer';
import { DesktopNotifier } from './notifications/desktopNotify';
import { NotificationCoordinator } from './notifications/notificationCoordinator';
import { ActivityPanel } from './views/activityPanel';

let monitors: { start(): void; stop(): void; dispose(): void }[] = [];
let stateMachine: AIStateMachine;
let activityLog: ActivityLog;
let statusBar: StatusBarIndicator;
let notifier: Notifier;
let soundPlayer: SoundPlayer;
let desktopNotifier: DesktopNotifier;
let notificationCoordinator: NotificationCoordinator;
let activityPanel: ActivityPanel;
let enabled = true;

export function activate(context: vscode.ExtensionContext): void {
  const config = getConfig();
  enabled = config.enabled;

  // 初始化核心组件
  stateMachine = new AIStateMachine();
  activityLog = new ActivityLog();
  statusBar = new StatusBarIndicator();
  notifier = new Notifier();
  soundPlayer = new SoundPlayer();
  desktopNotifier = new DesktopNotifier();
  notificationCoordinator = new NotificationCoordinator(notifier, soundPlayer, desktopNotifier);
  activityPanel = new ActivityPanel(activityLog);

  // 注册侧边栏视图
  const treeView = vscode.window.createTreeView('aiWatchdogActivity', {
    treeDataProvider: activityPanel,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // 初始化监控器
  initMonitors(context);

  // 监听状态机变化 → 触发通知
  context.subscriptions.push(
    stateMachine.onStatusChange((event) => {
      statusBar.update(event.current, stateMachine.workingSince);

      // 记录活动日志
      if (event.current === AIStatus.Working) {
        activityLog.addEvent(AIStatus.Working, event.source, [], undefined, 'AI 开始工作');
      } else if (event.current === AIStatus.Done) {
        const duration = stateMachine.workingDuration;
        activityLog.addEvent(
          AIStatus.Done,
          event.source,
          [],
          duration,
          `AI 完成工作，耗时 ${formatDuration(duration)}`
        );
        // 触发通知（经协调器防抖合并）
        notificationCoordinator.notifyDone(event.source, duration);
        statusBar.flash();
      } else if (event.current === AIStatus.Waiting) {
        activityLog.addEvent(AIStatus.Waiting, event.source, [], undefined, 'AI 等待用户输入');
        notificationCoordinator.notifyWaiting(event.source);
        statusBar.flash(5);
      }
    })
  );

  // 注册命令
  registerCommands(context);

  // 监听配置变更
  context.subscriptions.push(
    onConfigChange((newConfig) => {
      if (newConfig.enabled !== enabled) {
        enabled = newConfig.enabled;
        if (enabled) {
          startMonitors();
          notifier.notifyToggle(true);
        } else {
          stopMonitors();
          notifier.notifyToggle(false);
          stateMachine.reset();
        }
      }
    })
  );

  // 注册所有组件到 subscriptions
  context.subscriptions.push(
    stateMachine,
    activityLog,
    statusBar,
    soundPlayer,
    desktopNotifier,
    notificationCoordinator,
    activityPanel
  );

  // 初始状态
  statusBar.update(AIStatus.Idle);

  console.log('[AI Watchdog] 插件已激活');
}

function initMonitors(context: vscode.ExtensionContext): void {
  const fileWatcher = new FileWatcherMonitor();
  const terminalWatcher = new TerminalWatcherMonitor();
  const copilotWatcher = new CopilotWatcherMonitor();
  const clineWatcher = new ClineWatcherMonitor();

  monitors = [fileWatcher, terminalWatcher, copilotWatcher, clineWatcher];

  // 连接监控器事件到状态机
  for (const monitor of monitors) {
    const m = monitor as any;
    if (m.onActivity) {
      context.subscriptions.push(
        m.onActivity((event: MonitorEvent) => {
          if (enabled) {
            stateMachine.handleEvent(event);
          }
        })
      );
    }
    context.subscriptions.push(monitor as any);
  }

  // 启动监控
  if (enabled) {
    startMonitors();
  }
}

function startMonitors(): void {
  for (const monitor of monitors) {
    monitor.start();
  }
}

function stopMonitors(): void {
  for (const monitor of monitors) {
    monitor.stop();
  }
}

function registerCommands(context: vscode.ExtensionContext): void {
  // 开关监控
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWatchdog.toggle', () => {
      enabled = !enabled;
      if (enabled) {
        startMonitors();
        notifier.notifyToggle(true);
      } else {
        stopMonitors();
        notifier.notifyToggle(false);
        stateMachine.reset();
      }
      statusBar.update(stateMachine.status, stateMachine.workingSince);
    })
  );

  // 跳转到 AI 对话面板
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWatchdog.jumpToChat', () => {
      stateMachine.acknowledge();
      jumpToAIChat();
    })
  );

  // 清除历史
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWatchdog.clearHistory', () => {
      activityLog.clear();
      activityPanel.refresh();
      vscode.window.showInformationMessage('AI Watchdog: 活动历史已清除');
    })
  );

  // 显示状态
  context.subscriptions.push(
    vscode.commands.registerCommand('aiWatchdog.showStatus', () => {
      const status = stateMachine.status;
      const stats = activityLog.getStats();
      const statusText = getStatusText(status);
      const duration = stateMachine.workingSince
        ? formatDuration(stateMachine.workingDuration)
        : 'N/A';

      vscode.window.showInformationMessage(
        `AI Watchdog 状态: ${statusText}\n` +
          `当前持续: ${duration}\n` +
          `历史会话: ${stats.totalSessions} 次\n` +
          `监控状态: ${enabled ? '开启' : '关闭'}`
      );
    })
  );
}

/** 智能跳转到 AI 对话面板 */
function jumpToAIChat(): void {
  const source = stateMachine.lastSource;

  // 根据来源尝试打开对应的面板
  if (source === MonitorSource.Copilot) {
    vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    return;
  }

  if (source === MonitorSource.Cline) {
    // 尝试聚焦 Cline 面板
    vscode.commands.executeCommand('claude-dev.SidebarProvider.focus');
    return;
  }

  // 默认：尝试打开 Copilot Chat，失败则打开命令面板
  vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus').then(undefined, () => {
    // Copilot 不可用，尝试其他方式
    vscode.commands.executeCommand('workbench.action.chat.open');
  });
}

function getStatusText(status: AIStatus): string {
  switch (status) {
    case AIStatus.Idle:
      return '空闲';
    case AIStatus.Working:
      return '工作中';
    case AIStatus.Done:
      return '已完成';
    case AIStatus.Waiting:
      return '等待输入';
  }
}

export function deactivate(): void {
  stopMonitors();
  console.log('[AI Watchdog] 插件已停用');
}
