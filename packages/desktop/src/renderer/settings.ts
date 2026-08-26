/**
 * 设置窗口渲染进程逻辑
 *
 * 通过 preload 暴露的 window.settingsAPI 读取/保存配置。
 * 本文件在浏览器环境运行（ESM），不依赖 Node/Electron 主进程。
 */

/** 与主进程 config.ts 保持一致的配置类型（渲染进程侧独立声明，避免跨包 import） */
interface WatchTarget {
  id: string;
  name: string;
  watchDirs: string[];
  processPatterns: string[];
  enabled: boolean;
  notifyEnabled: boolean;
}

interface DesktopConfig {
  targets: WatchTarget[];
  windowSize: number;
  activityThreshold: number;
  silenceTimeout: number;
  minWorkDuration: number;
  autoStart: boolean;
  globalShortcut: string;
  notifyOnlyOnBlur: boolean;
  dnd: {
    enabled: boolean;
    scheduleEnabled: boolean;
    scheduleStart: string;
    scheduleEnd: string;
    onlyWaiting: boolean;
  };
  remoteNotify: {
    webhookUrl: string;
    ntfyTopic: string;
    ntfyServer: string;
  };
  companion: { enabled: boolean; socketPath: string };
}

interface UpdaterStatus {
  currentVersion: string;
  downloadInProgress: boolean;
  updateReady: boolean;
  devMode: boolean;
}

type UpdaterCheckResult =
  | { ok: false; reason: string; message?: string }
  | { ok: true; currentVersion: string; latestVersion: string | null; hasUpdate: boolean };

interface Window {
  settingsAPI: {
    getConfig: () => Promise<DesktopConfig>;
    saveConfig: (config: DesktopConfig) => Promise<boolean>;
    checkForUpdates: () => Promise<UpdaterCheckResult>;
    getUpdaterStatus: () => Promise<UpdaterStatus>;
    quitAndInstall: () => Promise<{ ok: boolean; reason?: string }>;
  };
}

let config: DesktopConfig;

const targetsEl = document.getElementById('targets')!;
const windowSizeEl = document.getElementById('windowSize') as HTMLInputElement;
const activityThresholdEl = document.getElementById('activityThreshold') as HTMLInputElement;
const silenceTimeoutEl = document.getElementById('silenceTimeout') as HTMLInputElement;
const minWorkDurationEl = document.getElementById('minWorkDuration') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const companionEnabledEl = document.getElementById('companionEnabled') as HTMLInputElement;
const companionSocketEl = document.getElementById('companionSocket')!;
const autoStartEl = document.getElementById('autoStart') as HTMLInputElement;
const globalShortcutEl = document.getElementById('globalShortcut') as HTMLInputElement;
const notifyOnlyOnBlurEl = document.getElementById('notifyOnlyOnBlur') as HTMLInputElement;
const dndEnabledEl = document.getElementById('dndEnabled') as HTMLInputElement;
const dndScheduleEnabledEl = document.getElementById('dndScheduleEnabled') as HTMLInputElement;
const dndStartEl = document.getElementById('dndStart') as HTMLInputElement;
const dndEndEl = document.getElementById('dndEnd') as HTMLInputElement;
const dndOnlyWaitingEl = document.getElementById('dndOnlyWaiting') as HTMLInputElement;
const webhookUrlEl = document.getElementById('webhookUrl') as HTMLInputElement;
const ntfyTopicEl = document.getElementById('ntfyTopic') as HTMLInputElement;
const ntfyServerEl = document.getElementById('ntfyServer') as HTMLInputElement;

/** 内置目标 id（不可删除） */
const BUILTIN_TARGET_IDS = new Set(['vscode', 'cursor', 'claude', 'codex', 'terminal']);

// 自定义目标表单
const customFormEl = document.getElementById('custom-form')!;
const showCustomFormBtn = document.getElementById('show-custom-form')!;
const customAddBtn = document.getElementById('custom-add') as HTMLButtonElement;
const customCancelBtn = document.getElementById('custom-cancel') as HTMLButtonElement;
const customNameEl = document.getElementById('custom-name') as HTMLInputElement;
const customProcessEl = document.getElementById('custom-process') as HTMLInputElement;
const customDirEl = document.getElementById('custom-dir') as HTMLInputElement;

function renderTargets(): void {
  targetsEl.innerHTML = '';
  for (const target of config.targets) {
    const div = document.createElement('div');
    div.className = 'target';

    const row = document.createElement('div');
    row.className = 'target-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = target.enabled;
    checkbox.addEventListener('change', () => {
      target.enabled = checkbox.checked;
    });

    const name = document.createElement('span');
    name.className = 'target-name';
    name.textContent = target.name;

    const notifyLabel = document.createElement('span');
    notifyLabel.style.cssText = 'margin-left:auto;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;';
    notifyLabel.appendChild(document.createTextNode('通知'));
    const notifyCheckbox = document.createElement('input');
    notifyCheckbox.type = 'checkbox';
    notifyCheckbox.checked = target.notifyEnabled;
    notifyCheckbox.style.cssText = 'width:13px;height:13px;accent-color:var(--accent);';
    notifyCheckbox.addEventListener('change', () => {
      target.notifyEnabled = notifyCheckbox.checked;
    });
    notifyLabel.appendChild(notifyCheckbox);

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(notifyLabel);

    // 自定义目标显示删除按钮
    if (!BUILTIN_TARGET_IDS.has(target.id)) {
      const delBtn = document.createElement('button');
      delBtn.textContent = '删除';
      delBtn.style.cssText = 'background:transparent;border:1px solid var(--border);color:#ef4444;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;';
      delBtn.addEventListener('click', () => {
        config.targets = config.targets.filter((t) => t.id !== target.id);
        renderTargets();
      });
      row.appendChild(delBtn);
    }

    div.appendChild(row);

    if (target.watchDirs.length > 0) {
      const dirs = document.createElement('div');
      dirs.className = 'target-dirs';
      dirs.textContent = `监听: ${target.watchDirs.join('、')}`;
      div.appendChild(dirs);
    }

    targetsEl.appendChild(div);
  }
}

function renderSensitivity(): void {
  windowSizeEl.value = String(config.windowSize);
  activityThresholdEl.value = String(config.activityThreshold);
  silenceTimeoutEl.value = String(config.silenceTimeout);
  minWorkDurationEl.value = String(config.minWorkDuration);
}

function renderCompanion(): void {
  companionEnabledEl.checked = config.companion.enabled;
  companionSocketEl.textContent = `socket: ${config.companion.socketPath}`;
}

function renderGeneral(): void {
  autoStartEl.checked = config.autoStart;
  globalShortcutEl.value = config.globalShortcut;
  notifyOnlyOnBlurEl.checked = config.notifyOnlyOnBlur;
}

function renderDnd(): void {
  dndEnabledEl.checked = config.dnd.enabled;
  dndScheduleEnabledEl.checked = config.dnd.scheduleEnabled;
  dndStartEl.value = config.dnd.scheduleStart;
  dndEndEl.value = config.dnd.scheduleEnd;
  dndOnlyWaitingEl.checked = config.dnd.onlyWaiting;
}

function renderRemoteNotify(): void {
  webhookUrlEl.value = config.remoteNotify.webhookUrl;
  ntfyTopicEl.value = config.remoteNotify.ntfyTopic;
  ntfyServerEl.value = config.remoteNotify.ntfyServer;
}

function collect(): DesktopConfig {
  return {
    ...config,
    windowSize: Number(windowSizeEl.value),
    activityThreshold: Number(activityThresholdEl.value),
    silenceTimeout: Number(silenceTimeoutEl.value),
    minWorkDuration: Number(minWorkDurationEl.value),
    autoStart: autoStartEl.checked,
    globalShortcut: globalShortcutEl.value.trim(),
    notifyOnlyOnBlur: notifyOnlyOnBlurEl.checked,
    dnd: {
      enabled: dndEnabledEl.checked,
      scheduleEnabled: dndScheduleEnabledEl.checked,
      scheduleStart: dndStartEl.value.trim() || '22:00',
      scheduleEnd: dndEndEl.value.trim() || '08:00',
      onlyWaiting: dndOnlyWaitingEl.checked,
    },
    remoteNotify: {
      webhookUrl: webhookUrlEl.value.trim(),
      ntfyTopic: ntfyTopicEl.value.trim(),
      ntfyServer: ntfyServerEl.value.trim() || 'https://ntfy.sh',
    },
    companion: { ...config.companion, enabled: companionEnabledEl.checked },
  };
}

// ---- 自定义目标表单 ----
showCustomFormBtn.addEventListener('click', () => {
  customFormEl.style.display = 'block';
  showCustomFormBtn.style.display = 'none';
  customNameEl.focus();
});

customCancelBtn.addEventListener('click', () => {
  customFormEl.style.display = 'none';
  showCustomFormBtn.style.display = 'block';
  customNameEl.value = '';
  customProcessEl.value = '';
  customDirEl.value = '';
});

customAddBtn.addEventListener('click', () => {
  const name = customNameEl.value.trim();
  if (!name) {
    customNameEl.style.borderColor = '#ef4444';
    return;
  }
  const processStr = customProcessEl.value.trim();
  const dirStr = customDirEl.value.trim();
  const newTarget: WatchTarget = {
    id: `custom-${Date.now()}`,
    name,
    watchDirs: dirStr ? dirStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    processPatterns: processStr ? processStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
    enabled: true,
    notifyEnabled: true,
  };
  config.targets.push(newTarget);
  renderTargets();
  customFormEl.style.display = 'none';
  showCustomFormBtn.style.display = 'block';
  customNameEl.value = '';
  customProcessEl.value = '';
  customDirEl.value = '';
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  config = collect();
  await window.settingsAPI.saveConfig(config);
  saveBtn.disabled = false;
  saveBtn.textContent = '已保存';
  setTimeout(() => (saveBtn.textContent = '保存'), 1200);
});

resetBtn.addEventListener('click', async () => {
  config = await window.settingsAPI.getConfig();
  renderTargets();
  renderSensitivity();
  renderCompanion();
  renderGeneral();
  renderDnd();
  renderRemoteNotify();
});

// ---- 关于 / 更新 ----
const versionEl = document.getElementById('version')!;
const updateStatusEl = document.getElementById('update-status')!;
const checkUpdateBtn = document.getElementById('check-update') as HTMLButtonElement;
const installUpdateBtn = document.getElementById('install-update') as HTMLButtonElement;

async function renderUpdater(): Promise<void> {
  const status = await window.settingsAPI.getUpdaterStatus();
  versionEl.textContent = status.devMode ? `${status.currentVersion} (开发模式)` : `v${status.currentVersion}`;
  installUpdateBtn.disabled = !status.updateReady;

  if (status.updateReady) {
    updateStatusEl.textContent = '新版本已下载，可重启安装';
  } else if (status.downloadInProgress) {
    updateStatusEl.textContent = '正在下载更新…';
  } else {
    updateStatusEl.textContent = '';
  }
}

checkUpdateBtn.addEventListener('click', async () => {
  checkUpdateBtn.disabled = true;
  updateStatusEl.textContent = '正在检查更新…';
  const result = await window.settingsAPI.checkForUpdates();

  if (result.ok) {
    if (result.hasUpdate) {
      updateStatusEl.textContent = `发现新版本 ${result.latestVersion}，开始下载…`;
    } else {
      updateStatusEl.textContent = `已是最新版本 (v${result.currentVersion})`;
    }
  } else if (result.reason === 'dev-mode') {
    updateStatusEl.textContent = '开发模式下不检查更新';
  } else {
    updateStatusEl.textContent = `检查更新失败：${result.message ?? result.reason}`;
  }
  checkUpdateBtn.disabled = false;
});

installUpdateBtn.addEventListener('click', async () => {
  await window.settingsAPI.quitAndInstall();
});

async function init(): Promise<void> {
  config = await window.settingsAPI.getConfig();
  renderTargets();
  renderSensitivity();
  renderCompanion();
  renderGeneral();
  renderDnd();
  renderRemoteNotify();
  renderUpdater();
}

init();
