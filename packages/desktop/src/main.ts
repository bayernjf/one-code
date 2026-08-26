import { app, Tray, Menu, nativeImage, Notification, globalShortcut } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { AIStatus, MonitorSource, companionTokenPath, getSourceName } from '@ai-watchdog/core';
import { DesktopConfig } from './config';
import { ConfigStore } from './configStore';
import { discoverWorkspaces } from './workspaceDiscovery';
import { SettingsWindow } from './settingsWindow';
import { HistoryWindow } from './historyWindow';
import { StatsWindow } from './statsWindow';
import { NotificationLog } from './notificationLog';
import { NotificationWindow } from './notificationWindow';
import { ActivityLog } from './activityLog';
import { focusAppForSource, getAppNameForSource } from './focusApp';
import { sendWebhook } from './notifiers/webhook';
import { sendNtfy } from './notifiers/ntfy';
import { startAutoUpdater, stopAutoUpdater } from './updater';
import { FileProbe } from './probes/fileProbe';
import { ProcessProbe } from './probes/processProbe';
import { ShellHookProbe } from './probes/shellHookProbe';
import { ClaudeSessionProbe } from './probes/claudeSessionProbe';
import { CodexSessionProbe } from './probes/codexSessionProbe';
import { Probe } from './probes/probe';
import { CompanionServer } from './companion/server';
import { ensureToken } from './companion/token';
import { Aggregator } from './aggregator';
import {
  ShellHookManager,
  hookSourceFor,
  rcPathFor,
  shellsForPlatform,
} from './shellHook/manager';

let tray: Tray | undefined;
const aggregator = new Aggregator();
let configStore: ConfigStore;
let activityLog: ActivityLog;
let settingsWindow: SettingsWindow;
let historyWindow: HistoryWindow;
let statsWindow: StatsWindow;
let notificationLog: NotificationLog;
let notificationWindow: NotificationWindow;
let probes: Probe[] = [];
let shellHookManager = new ShellHookManager();
/** 当前注册的全局快捷键（用于配置变更时重新注册） */
let registeredShortcut: string | undefined;
/** 当前生效的配置（供 showNotification 等独立函数读取） */
let currentConfig: DesktopConfig;

/** 为未显式配置监听目录的目标，自动填充最近活跃的工作区 */
function fillWatchDirs(config: DesktopConfig): void {
  const discovered = discoverWorkspaces();
  for (const target of config.targets) {
    if (!target.enabled) {
      continue;
    }
    if (target.watchDirs.length === 0) {
      target.watchDirs = [...discovered];
    }
  }
}

function buildProbes(config: DesktopConfig): Probe[] {
  const probes: Probe[] = [];
  // 收集所有启用目标的工作区目录（文件探针共享一个 watcher 列表）
  const watchDirs = new Set<string>();
  const processPatterns = new Set<string>();

  for (const target of config.targets) {
    if (!target.enabled) {
      continue;
    }
    target.watchDirs.forEach((d) => watchDirs.add(d));
    target.processPatterns.forEach((p) => processPatterns.add(p));
  }

  if (watchDirs.size > 0) {
    probes.push(
      new FileProbe(
        Array.from(watchDirs),
        config.windowSize * 1000,
        config.activityThreshold,
        config.silenceTimeout
      )
    );
  }

  if (processPatterns.size > 0) {
    probes.push(new ProcessProbe(Array.from(processPatterns)));
  }

  if (config.shellHook.enabled) {
    probes.push(new ShellHookProbe(config.shellHook.stateFile));
    console.log(`[shell-hook] watching state file: ${config.shellHook.stateFile}`);
  }

  // Claude 会话 jsonl 探针：跟随「Claude」监控目标勾选状态
  const claudeTarget = config.targets.find((t) => t.id === 'claude');
  if (claudeTarget?.enabled) {
    probes.push(new ClaudeSessionProbe(config.claude.projectsDir, config.silenceTimeout));
    console.log(`[claude] watching sessions dir: ${config.claude.projectsDir}`);
  }

  // Codex 会话探针：跟随「ChatGPT / Codex」监控目标勾选状态
  const codexTarget = config.targets.find((t) => t.id === 'codex');
  if (codexTarget?.enabled) {
    probes.push(new CodexSessionProbe(config.codex.sessionsDir, config.codex.maxTurnMinutes));
    console.log(`[codex] watching sessions dir: ${config.codex.sessionsDir}`);
  }

  if (config.companion.enabled) {
    const token = ensureToken(companionTokenPath());
    probes.push(new CompanionServer(config.companion.socketPath, token));
  }

  return probes;
}

/** 停止并重建探针（配置变更后调用） */
function restartProbes(config: DesktopConfig): void {
  probes.forEach((p) => p.stop());
  probes = buildProbes(config);
  for (const probe of probes) {
    probe.onEvent((event) => {
      console.log(`[probe] ${event.source} -> ${event.type}`, event.message ?? '');
      aggregator.handleEvent(event);
    });
    probe.start();
    console.log(`[probe] started: ${probe.source}`);
  }
}

/** 格式化时长为可读字符串 */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}分${sec}秒`;
  return `${sec}秒`;
}

function showNotification(payload: { type: 'done' | 'waiting'; source: MonitorSource; files?: string[] }): void {
  const sourceName = getSourceName(payload.source);
  const title = payload.type === 'done' ? `${sourceName} 已完成任务` : `${sourceName} 等待你的输入`;

  const parts: string[] = [];
  if (payload.type === 'done') {
    parts.push('活动已停止，可以回来接管了');
    const duration = aggregator.workingDuration;
    if (duration > 0) parts.push(`用时 ${formatDuration(duration)}`);
    if (payload.files && payload.files.length > 0) {
      parts.push(`修改 ${payload.files.length} 个文件`);
    }
  } else {
    parts.push('需要你确认或输入');
  }
  const body = parts.join(' · ');

  notificationLog.record(payload.type, payload.source, title, body);

  console.log(`[notify] ${payload.type} (source: ${payload.source})`);
  // 不同状态用不同系统声音（macOS）；Windows/Linux 忽略 sound 选项回退默认
  const sound = payload.type === 'done' ? 'Glass' : 'Hero';
  const notification = new Notification({ title, body, silent: false, sound });
  // 点击通知 → 聚焦对应 AI 工具窗口
  notification.on('click', () => {
    focusAppForSource(payload.source);
  });
  notification.show();
}

function updateTray(status: AIStatus): void {
  console.log(`[status] -> ${status}`);
  if (!tray) {
    return;
  }
  let label = {
    [AIStatus.Idle]: '● 空闲',
    [AIStatus.Working]: '◐ 工作中',
    [AIStatus.Done]: '✓ 已完成',
    [AIStatus.Waiting]: '? 等待输入',
  }[status];
  if (status === AIStatus.Working) {
    const workingCount = aggregator.getActiveSessions().filter((s) => s.status === AIStatus.Working).length;
    if (workingCount > 1) {
      label += ` (${workingCount})`;
    }
  }
  tray.setTitle(` AI Watchdog · ${label}`);
  tray.setToolTip(`AI Watchdog — ${label}`);
}

/** 构建活跃会话子菜单项 */
function buildActiveSessionItems(): Electron.MenuItemConstructorOptions[] {
  const sessions = aggregator.getActiveSessions();
  if (sessions.length === 0) {
    return [{ label: '无活跃会话', enabled: false }];
  }
  const statusLabel: Record<AIStatus, string> = {
    [AIStatus.Working]: '工作中',
    [AIStatus.Done]: '已完成',
    [AIStatus.Waiting]: '等待输入',
    [AIStatus.Idle]: '空闲',
  };
  return sessions.map((s) => ({
    label: `${getSourceName(s.source)} · ${statusLabel[s.status]} · ${formatDuration(s.durationMs)}`,
    click: () => focusAppForSource(s.source),
  }));
}

function rebuildTrayMenu(config: DesktopConfig): void {
  if (!tray) {
    return;
  }
  const menu = Menu.buildFromTemplate([
    {
      label: '监控目标',
      submenu: config.targets.map((t) => ({
        label: t.name,
        type: 'checkbox',
        checked: t.enabled,
        click: () => {
          t.enabled = !t.enabled;
          configStore.save(config);
          restartProbes(config);
          rebuildTrayMenu(config);
        },
      })),
    },
    { type: 'separator' },
    {
      label: '终端 Shell Hook',
      type: 'submenu',
      submenu: shellsForPlatform(process.platform).map((kind) => {
        const rcPath = rcPathFor(kind, os.homedir());
        const installed = shellHookManager.installed(rcPath);
        return {
          label: `${installed ? '卸载' : '安装'} ${kind} Hook（${rcPath}）`,
          click: () => {
            if (shellHookManager.installed(rcPath)) {
              shellHookManager.uninstall(rcPath);
            } else {
              shellHookManager.install(rcPath, hookSourceFor(kind));
            }
            rebuildTrayMenu(config);
          },
        };
      }),
    },
    { type: 'separator' },
    {
      label: '活跃会话',
      submenu: buildActiveSessionItems(),
    },
    { type: 'separator' },
    {
      label: '勿扰模式',
      type: 'checkbox',
      checked: config.dnd.enabled,
      click: () => {
        config.dnd.enabled = !config.dnd.enabled;
        currentConfig = config;
        configStore.save(config);
        rebuildTrayMenu(config);
      },
    },
    {
      label: '活动历史',
      click: () => historyWindow.open(),
    },
    {
      label: '通知日志',
      click: () => notificationWindow.open(),
    },
    {
      label: '统计',
      click: () => statsWindow.open(),
    },
    {
      label: '打开设置',
      click: () => settingsWindow.open(),
    },
    {
      label: '查看状态',
      click: () => {
        const s = aggregator.currentStatus;
        new Notification({ title: '当前状态', body: `状态: ${s}，已工作 ${Math.round(aggregator.workingDuration / 1000)}s` }).show();
      },
    },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

/** 注册或更新全局快捷键 */
function applyGlobalShortcut(shortcut: string): void {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = undefined;
  }
  if (!shortcut || shortcut.trim() === '') {
    return;
  }
  const ok = globalShortcut.register(shortcut, () => {
    const s = aggregator.currentStatus;
    const duration = Math.round(aggregator.workingDuration / 1000);
    new Notification({
      title: 'AI Watchdog 状态',
      body: `状态: ${s}，已工作 ${duration}s`,
    }).show();
  });
  if (ok) {
    registeredShortcut = shortcut;
    console.log(`[shortcut] registered: ${shortcut}`);
  } else {
    console.error(`[shortcut] failed to register: ${shortcut}`);
  }
}

/** 应用开机自启设置 */
function applyAutoStart(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

/** 判断当前是否处于勿扰时段 */
function isDndActive(): boolean {
  const dnd = currentConfig.dnd;
  if (dnd.enabled) return true;
  if (!dnd.scheduleEnabled) return false;

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const parseTime = (s: string): number => {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start = parseTime(dnd.scheduleStart);
  const end = parseTime(dnd.scheduleEnd);

  if (start <= end) {
    return current >= start && current < end;
  }
  // 跨午夜（如 22:00 - 08:00）
  return current >= start || current < end;
}

/** 获取当前前台应用名（macOS） */
function getFrontmostApp(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve('');
      return;
    }
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
      (err, stdout) => {
        if (err) resolve('');
        else resolve(stdout.trim());
      }
    );
  });
}

/** 信号来源 → 监控目标 ID（用于按目标开关通知） */
const SOURCE_TO_TARGET_ID: Partial<Record<MonitorSource, string>> = {
  [MonitorSource.Codex]: 'codex',
  [MonitorSource.Claude]: 'claude',
  [MonitorSource.VSCodeCompanion]: 'vscode',
  [MonitorSource.ShellHook]: 'terminal',
  [MonitorSource.Copilot]: 'vscode',
  [MonitorSource.Cline]: 'vscode',
};

function createTray(config: DesktopConfig): void {
  // 加载托盘图标（彩色产品 logo；文件名不带 Template 后缀，避免 macOS 强制单色模板图）
  const iconPath = path.join(__dirname, '..', 'resources', 'tray', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  updateTray(aggregator.currentStatus);
  rebuildTrayMenu(config);
}

app.whenReady().then(() => {
  startAutoUpdater();

  configStore = new ConfigStore();
  activityLog = new ActivityLog();
  const config = configStore.load();
  currentConfig = config;
  aggregator.setMinWorkDuration(config.minWorkDuration);
  fillWatchDirs(config);

  restartProbes(config);

  // 设置窗口：保存配置后重启探针 + 应用自启/快捷键
  settingsWindow = new SettingsWindow(configStore, (savedConfig) => {
    currentConfig = savedConfig;
    aggregator.setMinWorkDuration(savedConfig.minWorkDuration);
    applyAutoStart(savedConfig.autoStart);
    applyGlobalShortcut(savedConfig.globalShortcut);
    fillWatchDirs(savedConfig);
    restartProbes(savedConfig);
    rebuildTrayMenu(savedConfig);
  });

  historyWindow = new HistoryWindow(activityLog);
  statsWindow = new StatsWindow(activityLog);
  notificationLog = new NotificationLog();
  notificationWindow = new NotificationWindow(notificationLog);

  aggregator.onStatusChange((status) => {
    updateTray(status);
    rebuildTrayMenu(currentConfig);
  });
  aggregator.onNotify(async (payload) => {
    // 勿扰模式检查
    if (isDndActive()) {
      if (!(currentConfig.dnd.onlyWaiting && payload.type === 'waiting')) {
        console.log(`[notify] suppressed by DND: ${payload.type}`);
        return;
      }
    }

    // 按目标开关通知
    const targetId = SOURCE_TO_TARGET_ID[payload.source];
    if (targetId) {
      const target = currentConfig.targets.find((t) => t.id === targetId);
      if (target && !target.notifyEnabled) {
        console.log(`[notify] suppressed by target toggle: ${targetId}`);
        return;
      }
    }

    // 仅失焦时通知
    if (currentConfig.notifyOnlyOnBlur) {
      const frontmost = await getFrontmostApp();
      const targetApp = getAppNameForSource(payload.source);
      if (targetApp && frontmost.toLowerCase().includes(targetApp.toLowerCase())) {
        console.log(`[notify] suppressed: ${targetApp} in focus`);
        return;
      }
    }

    showNotification(payload);
    // 记录活动历史（耗时从聚合引擎取）
    activityLog.record(payload.type, payload.source, aggregator.workingDuration);

    // 远程通知（异步，不阻塞）
    const sourceName = getSourceName(payload.source);
    const title = payload.type === 'done' ? `${sourceName} 已完成任务` : `${sourceName} 等待你的输入`;
    const bodyParts: string[] = [];
    if (payload.type === 'done') {
      bodyParts.push('活动已停止');
      const duration = aggregator.workingDuration;
      if (duration > 0) bodyParts.push(`用时 ${formatDuration(duration)}`);
      if (payload.files && payload.files.length > 0) bodyParts.push(`修改 ${payload.files.length} 个文件`);
    } else {
      bodyParts.push('需要你确认或输入');
    }
    const rn = currentConfig.remoteNotify;
    if (rn.webhookUrl) {
      sendWebhook(rn.webhookUrl, {
        type: payload.type,
        source: payload.source,
        timestamp: Date.now(),
        durationMs: aggregator.workingDuration,
        fileCount: payload.files?.length ?? 0,
        title,
        body: bodyParts.join(' · '),
      });
    }
    if (rn.ntfyTopic) {
      sendNtfy(rn.ntfyTopic, title, bodyParts.join(' · '), payload.type, rn.ntfyServer);
    }
  });

  applyAutoStart(config.autoStart);
  applyGlobalShortcut(config.globalShortcut);

  createTray(config);

  // macOS 常驻：点击 Dock 图标不退出
  app.on('activate', () => {
    // 保持后台运行
  });
});

// 所有窗口关闭时不退出（纯托盘应用）
app.on('window-all-closed', () => {
  // 不退出，托盘常驻
});

app.on('will-quit', () => {
  probes.forEach((p) => p.stop());
  globalShortcut.unregisterAll();
  stopAutoUpdater();
});
