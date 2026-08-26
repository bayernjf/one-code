/**
 * 通知日志渲染进程
 */

interface NotificationRecord {
  id: string;
  timestamp: number;
  type: 'done' | 'waiting';
  source: string;
  title: string;
  body: string;
}

declare global {
  interface Window {
    notificationAPI: {
      getRecords: () => Promise<NotificationRecord[]>;
      clear: () => Promise<boolean>;
    };
  }
}

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

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function render(records: NotificationRecord[]): void {
  countEl.textContent = `${records.length} 条`;

  if (records.length === 0) {
    listEl.innerHTML = '<div class="empty">暂无通知记录<br />弹出的系统通知会出现在这里</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const r of records) {
    const div = document.createElement('div');
    div.className = 'record';

    const head = document.createElement('div');
    head.className = 'head';

    const badge = document.createElement('span');
    badge.className = `badge ${r.type}`;
    badge.textContent = r.type === 'done' ? '已完成' : '等待输入';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = r.title;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(r.timestamp);

    head.appendChild(badge);
    head.appendChild(title);
    head.appendChild(time);

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = `${SOURCE_NAMES[r.source] ?? r.source} · ${r.body}`;

    div.appendChild(head);
    div.appendChild(body);
    listEl.appendChild(div);
  }
}

async function load(): Promise<void> {
  const records = await window.notificationAPI.getRecords();
  render(records);
}

refreshBtn.addEventListener('click', load);

clearBtn.addEventListener('click', async () => {
  if (!confirm('确定要清空通知日志吗？')) return;
  await window.notificationAPI.clear();
  load();
});

load();

export {};
