/**
 * 活动历史窗口渲染进程逻辑
 */

interface ActivityRecord {
  id: string;
  timestamp: number;
  type: 'done' | 'waiting';
  source: string;
  durationMs: number;
}

declare global {
  interface Window {
    historyAPI: {
      getRecords: () => Promise<ActivityRecord[]>;
      clear: () => Promise<boolean>;
    };
  }
}

/** 与 core 包 sourceName.ts 保持一致的映射（渲染进程无法 import node 包） */
const SOURCE_NAMES: Record<string, string> = {
  'file-watcher': '文件监控',
  'terminal': '终端',
  'copilot': 'Copilot',
  'cline': 'Cline/Roo',
  'shell-hook': 'Shell Hook',
  'claude': 'Claude',
  'codex': 'ChatGPT / Codex',
  'vscode-companion': 'VS Code 伴侣',
};

const listEl = document.getElementById('list')!;
const countEl = document.getElementById('count')!;
const refreshBtn = document.getElementById('refresh')!;
const clearBtn = document.getElementById('clear')!;
const sourceFilterEl = document.getElementById('source-filter') as HTMLSelectElement;

let allRecords: ActivityRecord[] = [];

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}分${sec}秒`;
  return `${sec}秒`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function populateSourceFilter(records: ActivityRecord[]): void {
  const sources = Array.from(new Set(records.map((r) => r.source))).sort();
  // 保留"全部"，重建其余选项
  sourceFilterEl.innerHTML = '<option value="all">全部</option>';
  for (const src of sources) {
    const opt = document.createElement('option');
    opt.value = src;
    opt.textContent = SOURCE_NAMES[src] ?? src;
    sourceFilterEl.appendChild(opt);
  }
}

function render(): void {
  const filter = sourceFilterEl.value;
  const records = filter === 'all' ? allRecords : allRecords.filter((r) => r.source === filter);

  countEl.textContent = `${records.length} 条记录`;

  if (records.length === 0) {
    listEl.innerHTML = '<div class="empty">暂无活动记录<br />AI 完成任务或等待输入时会自动记录</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const r of records) {
    const div = document.createElement('div');
    div.className = 'record';

    const badge = document.createElement('span');
    badge.className = `badge ${r.type}`;
    badge.textContent = r.type === 'done' ? '已完成' : '等待输入';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const source = document.createElement('div');
    source.className = 'source';
    source.textContent = SOURCE_NAMES[r.source] ?? r.source;
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = formatTime(r.timestamp);
    meta.appendChild(source);
    meta.appendChild(time);

    const duration = document.createElement('div');
    duration.className = 'duration';
    duration.textContent = `用时 ${formatDuration(r.durationMs)}`;

    div.appendChild(badge);
    div.appendChild(meta);
    div.appendChild(duration);
    listEl.appendChild(div);
  }
}

async function load(): Promise<void> {
  allRecords = await window.historyAPI.getRecords();
  populateSourceFilter(allRecords);
  render();
}

refreshBtn.addEventListener('click', load);

sourceFilterEl.addEventListener('change', render);

clearBtn.addEventListener('click', async () => {
  if (!confirm('确定要清空所有活动历史吗？')) return;
  await window.historyAPI.clear();
  load();
});

load();

export {};
