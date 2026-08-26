/**
 * 统计仪表盘渲染进程逻辑
 */

interface SourceStat {
  source: string;
  name: string;
  durationMs: number;
  count: number;
}

interface DayStat {
  date: string;
  durationMs: number;
  count: number;
}

interface StatsData {
  todayDurationMs: number;
  todayCount: number;
  weekDurationMs: number;
  weekCount: number;
  totalDurationMs: number;
  totalCount: number;
  bySource: SourceStat[];
  last7Days: DayStat[];
}

declare global {
  interface Window {
    statsAPI: {
      getStats: () => Promise<StatsData>;
      exportCsv: () => Promise<{ ok: boolean; path?: string }>;
      exportJson: () => Promise<{ ok: boolean; path?: string }>;
    };
  }
}

const contentEl = document.getElementById('content')!;
const rangeEl = document.getElementById('range')!;
const refreshBtn = document.getElementById('refresh')!;
const exportCsvBtn = document.getElementById('export-csv')!;
const exportJsonBtn = document.getElementById('export-json')!;

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} 分钟`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} 小时 ${m} 分`;
}

function render(data: StatsData): void {
  if (data.totalCount === 0) {
    contentEl.innerHTML = '<div class="empty">暂无统计数据<br />AI 完成任务后会自动记录</div>';
    rangeEl.textContent = '';
    return;
  }

  const maxDay = Math.max(...data.last7Days.map((d) => d.durationMs), 1);
  const maxSource = Math.max(...data.bySource.map((s) => s.durationMs), 1);

  const bars = data.last7Days
    .map((d) => {
      const h = Math.round((d.durationMs / maxDay) * 80);
      const label = d.date.slice(5); // MM-DD
      return `<div class="bar-col"><div class="bar" style="height:${h}px" title="${formatDuration(d.durationMs)} · ${d.count} 次"></div><span class="bar-label">${label}</span></div>`;
    })
    .join('');

  const sources = data.bySource
    .map((s) => {
      const w = Math.round((s.durationMs / maxSource) * 100);
      return `<div class="source-row"><span class="source-name">${s.name}</span><div class="source-bar-bg"><div class="source-bar" style="width:${w}%"></div></div><span class="source-val">${formatDuration(s.durationMs)} · ${s.count}次</span></div>`;
    })
    .join('');

  contentEl.innerHTML = `
    <section>
      <h2>概览</h2>
      <div class="cards">
        <div class="card">
          <div class="label">今日</div>
          <div class="value">${formatDuration(data.todayDurationMs)}</div>
          <div class="sub">${data.todayCount} 次完成</div>
        </div>
        <div class="card">
          <div class="label">本周</div>
          <div class="value">${formatDuration(data.weekDurationMs)}</div>
          <div class="sub">${data.weekCount} 次完成</div>
        </div>
        <div class="card">
          <div class="label">累计</div>
          <div class="value">${formatDuration(data.totalDurationMs)}</div>
          <div class="sub">${data.totalCount} 次完成</div>
        </div>
      </div>
    </section>
    <section>
      <h2>最近 7 天</h2>
      <div class="bar-chart">${bars}</div>
    </section>
    <section>
      <h2>工具分布</h2>
      ${sources || '<div class="empty" style="padding:10px;">暂无数据</div>'}
    </section>
  `;

  const first = data.last7Days[0]?.date ?? '';
  const last = data.last7Days[data.last7Days.length - 1]?.date ?? '';
  rangeEl.textContent = `${first} ~ ${last}`;
}

async function load(): Promise<void> {
  const data = await window.statsAPI.getStats();
  render(data);
}

refreshBtn.addEventListener('click', load);
exportCsvBtn.addEventListener('click', async () => {
  const r = await window.statsAPI.exportCsv();
  if (r.ok && r.path) exportCsvBtn.textContent = '已导出';
  setTimeout(() => (exportCsvBtn.textContent = '导出 CSV'), 1500);
});
exportJsonBtn.addEventListener('click', async () => {
  const r = await window.statsAPI.exportJson();
  if (r.ok && r.path) exportJsonBtn.textContent = '已导出';
  setTimeout(() => (exportJsonBtn.textContent = '导出 JSON'), 1500);
});

load();

export {};
