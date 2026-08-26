import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { MonitorSource } from '@ai-watchdog/core';

/**
 * 活动历史记录
 *
 * 记录每一次 done / waiting 通知事件，持久化到 userData/activity.json。
 * 用于桌面端的「活动历史」窗口展示，用户可回看 AI 今天跑了几轮、每轮多久。
 */
export interface ActivityRecord {
  id: string;
  /** 事件发生时间（epoch ms） */
  timestamp: number;
  /** 事件类型：完成 / 等待输入 */
  type: 'done' | 'waiting';
  /** 信号来源 */
  source: MonitorSource;
  /** 本轮工作时长（ms）；waiting 时为从最近一次 working 到 waiting 的时长 */
  durationMs: number;
}

const MAX_RECORDS = 200;

export class ActivityLog {
  private filePath: string;
  private records: ActivityRecord[] = [];

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'activity.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = parsed;
      }
    } catch {
      this.records = [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (err) {
      console.error('[activityLog] failed to save:', err);
    }
  }

  /** 记录一条事件 */
  record(type: 'done' | 'waiting', source: MonitorSource, durationMs: number): void {
    const record: ActivityRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type,
      source,
      durationMs,
    };
    this.records.unshift(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(0, MAX_RECORDS);
    }
    this.save();
  }

  /** 获取全部记录（按时间倒序） */
  getRecords(): ActivityRecord[] {
    return this.records;
  }

  /** 清空历史 */
  clear(): void {
    this.records = [];
    this.save();
  }
}
