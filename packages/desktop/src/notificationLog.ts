import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { MonitorSource } from '@ai-watchdog/core';

/**
 * 通知日志
 *
 * 记录每一条实际弹出的系统通知（标题、正文、来源、时间），
 * 与活动历史（activityLog）的区别：活动历史记录状态事件，
 * 通知日志记录用户实际看到过的通知内容，便于回溯"刚才弹了什么"。
 */
export interface NotificationRecord {
  id: string;
  timestamp: number;
  type: 'done' | 'waiting';
  source: MonitorSource;
  title: string;
  body: string;
}

const MAX_RECORDS = 200;

export class NotificationLog {
  private filePath: string;
  private records: NotificationRecord[] = [];

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'notifications.json');
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
      console.error('[notificationLog] failed to save:', err);
    }
  }

  record(type: 'done' | 'waiting', source: MonitorSource, title: string, body: string): void {
    const record: NotificationRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type,
      source,
      title,
      body,
    };
    this.records.unshift(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(0, MAX_RECORDS);
    }
    this.save();
  }

  getRecords(): NotificationRecord[] {
    return this.records;
  }

  clear(): void {
    this.records = [];
    this.save();
  }
}
