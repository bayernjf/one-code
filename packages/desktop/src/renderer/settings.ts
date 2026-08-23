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

interface Window {
  settingsAPI: {
    getConfig: () => Promise<DesktopConfig>;
    saveConfig: (config: DesktopConfig) => Promise<boolean>;
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

async function init(): Promise<void> {
  config = await window.settingsAPI.getConfig();
  renderTargets();
  renderSensitivity();
}

init();
