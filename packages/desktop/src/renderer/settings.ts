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
}

interface DesktopConfig {
  targets: WatchTarget[];
  windowSize: number;
  activityThreshold: number;
  silenceTimeout: number;
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
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;

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

    row.appendChild(checkbox);
    row.appendChild(name);
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
}

function collect(): DesktopConfig {
  return {
    ...config,
    windowSize: Number(windowSizeEl.value),
    activityThreshold: Number(activityThresholdEl.value),
    silenceTimeout: Number(silenceTimeoutEl.value),
  };
}

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
  renderUpdater();
}

init();
