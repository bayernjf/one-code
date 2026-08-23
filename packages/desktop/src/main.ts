import { app, Tray, Menu, nativeImage, Notification } from 'electron';
import path from 'node:path';
import { AIStatus, MonitorSource } from '@ai-watchdog/core';
import { DesktopConfig } from './config';
import { ConfigStore } from './configStore';
import { discoverWorkspaces } from './workspaceDiscovery';
import { SettingsWindow } from './settingsWindow';
import { initAutoUpdater } from './updater';
import { FileProbe } from './probes/fileProbe';
import { ProcessProbe } from './probes/processProbe';
import { Probe } from './probes/probe';
import { Aggregator } from './aggregator';

let tray: Tray | undefined;
const aggregator = new Aggregator();
let configStore: ConfigStore;
let settingsWindow: SettingsWindow;
let probes: Probe[] = [];

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

function showNotification(payload: { type: 'done' | 'waiting'; source: MonitorSource }): void {
  const title = payload.type === 'done' ? 'AI 已完成任务' : 'AI 等待你的输入';
  const body = payload.type === 'done' ? 'AI 活动已停止，可以回来接管了' : 'AI 需要你确认或输入';
  console.log(`[notify] ${payload.type} (source: ${payload.source})`);
  new Notification({ title, body, silent: false }).show();
}

function updateTray(status: AIStatus): void {
  console.log(`[status] -> ${status}`);
  if (!tray) {
    return;
  }
  const label = {
    [AIStatus.Idle]: '● 空闲',
    [AIStatus.Working]: '◐ 工作中',
    [AIStatus.Done]: '✓ 已完成',
    [AIStatus.Waiting]: '? 等待输入',
  }[status];
  tray.setTitle(` AI Watchdog · ${label}`);
  tray.setToolTip(`AI Watchdog — ${label}`);
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
  initAutoUpdater();

  configStore = new ConfigStore();
  const config = configStore.load();
  fillWatchDirs(config);

  restartProbes(config);

  // 设置窗口：保存配置后重启探针
  settingsWindow = new SettingsWindow(configStore, (savedConfig) => {
    fillWatchDirs(savedConfig);
    restartProbes(savedConfig);
    rebuildTrayMenu(savedConfig);
  });

  aggregator.onStatusChange((status) => updateTray(status));
  aggregator.onNotify((payload) => showNotification(payload));

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
});
