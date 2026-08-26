import { BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { ActivityLog, ActivityRecord } from './activityLog';
import { getSourceName } from '@ai-watchdog/core';

/**
 * 统计仪表盘窗口
 *
 * 基于活动历史数据，展示日/周/月统计、工具分布、7 天趋势。
 * 纯 HTML/CSS 图表，不引入图表库。
 */

export interface SourceStat {
  source: string;
  name: string;
  durationMs: number;
  count: number;
}

export interface DayStat {
  date: string; // YYYY-MM-DD
  durationMs: number;
  count: number;
}

export interface StatsData {
  todayDurationMs: number;
  todayCount: number;
  weekDurationMs: number;
  weekCount: number;
  totalDurationMs: number;
  totalCount: number;
  bySource: SourceStat[];
  last7Days: DayStat[];
}

export class StatsWindow {
  private win: BrowserWindow | undefined;

  constructor(private activityLog: ActivityLog) {
    this.registerIpc();
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus();
      return;
    }

    this.win = new BrowserWindow({
      width: 600,
      height: 640,
      title: 'AI Watchdog — 统计',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.win.loadFile(path.join(__dirname, 'renderer', 'stats.html'));
    this.win.on('closed', () => {
      this.win = undefined;
    });
  }

  private registerIpc(): void {
    ipcMain.handle('stats:get', () => this.computeStats());
    ipcMain.handle('stats:exportCsv', async () => this.exportCsv());
    ipcMain.handle('stats:exportJson', async () => this.exportJson());
  }

  private async exportCsv(): Promise<{ ok: boolean; path?: string }> {
    const stats = this.computeStats();
    const lines = ['date,duration_ms,count'];
    for (const d of stats.last7Days) {
      lines.push(`${d.date},${d.durationMs},${d.count}`);
    }
    lines.push('');
    lines.push('source,name,duration_ms,count');
    for (const s of stats.bySource) {
      lines.push(`${s.source},"${s.name}",${s.durationMs},${s.count}`);
    }
    return this.saveFile('ai-watchdog-stats.csv', lines.join('\n'));
  }

  private async exportJson(): Promise<{ ok: boolean; path?: string }> {
    const stats = this.computeStats();
    return this.saveFile('ai-watchdog-stats.json', JSON.stringify(stats, null, 2));
  }

  private async saveFile(defaultName: string, content: string): Promise<{ ok: boolean; path?: string }> {
    const result = await dialog.showSaveDialog(this.win!, {
      defaultPath: defaultName,
      filters: [{ name: defaultName.endsWith('.csv') ? 'CSV' : 'JSON', extensions: [defaultName.endsWith('.csv') ? 'csv' : 'json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false };
    }
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { ok: true, path: result.filePath };
  }

  private computeStats(): StatsData {
    const records = this.activityLog.getRecords();
    const doneRecords = records.filter((r) => r.type === 'done');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - ((now.getDay() + 6) % 7) * 86400000; // 周一为一周开始

    let todayDurationMs = 0, todayCount = 0;
    let weekDurationMs = 0, weekCount = 0;
    let totalDurationMs = 0, totalCount = 0;

    const sourceMap = new Map<string, { durationMs: number; count: number }>();
    const dayMap = new Map<string, { durationMs: number; count: number }>();

    // 初始化最近 7 天
    const last7Days: DayStat[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayMap.set(key, { durationMs: 0, count: 0 });
      last7Days.push({ date: key, durationMs: 0, count: 0 });
    }

    for (const r of doneRecords) {
      totalDurationMs += r.durationMs;
      totalCount++;

      if (r.timestamp >= todayStart) {
        todayDurationMs += r.durationMs;
        todayCount++;
      }
      if (r.timestamp >= weekStart) {
        weekDurationMs += r.durationMs;
        weekCount++;
      }

      // 按来源统计
      const s = sourceMap.get(r.source) ?? { durationMs: 0, count: 0 };
      s.durationMs += r.durationMs;
      s.count++;
      sourceMap.set(r.source, s);

      // 按天统计
      const d = new Date(r.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const day = dayMap.get(key);
      if (day) {
        day.durationMs += r.durationMs;
        day.count++;
      }
    }

    // 回填 7 天数据
    for (const day of last7Days) {
      const data = dayMap.get(day.date);
      if (data) {
        day.durationMs = data.durationMs;
        day.count = data.count;
      }
    }

    const bySource: SourceStat[] = Array.from(sourceMap.entries())
      .map(([source, v]) => ({
        source,
        name: getSourceName(source as any),
        durationMs: v.durationMs,
        count: v.count,
      }))
      .sort((a, b) => b.durationMs - a.durationMs);

    return {
      todayDurationMs,
      todayCount,
      weekDurationMs,
      weekCount,
      totalDurationMs,
      totalCount,
      bySource,
      last7Days,
    };
  }
}
