import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { MonitorSource, MonitorEvent } from '@ai-watchdog/core';
import { Probe } from './probe';

/** Claude 会话 jsonl 单行内容结构（格式未官方承诺，宽松解析） */
export interface ClaudeJsonlEntry {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
}

/** 追加内容分类结果 */
export type ClaudeSignal = 'activity' | 'waiting' | 'none';

/** 提问/等待确认 的文本弱信号（命中即判 waiting） */
const CLAUDE_WAITING_PATTERNS = [
  /should i /i,
  /shall i /i,
  /may i /i,
  /would you like me to/i,
  /do you want me to/i,
  /does this look correct/i,
  /approve|reject/i,
  /proceed\?/i,
  /confirm/i,
  /确认|是否|可以吗|好吗|同意/i,
];

/** 解析单行 jsonl，失败返回 null */
export function parseClaudeLine(line: string): ClaudeJsonlEntry | null {
  try {
    const entry = JSON.parse(line) as ClaudeJsonlEntry;
    if (entry && typeof entry === 'object') {
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

/** 拼接消息正文文本（text 块） */
export function extractClaudeText(entry: ClaudeJsonlEntry): string {
  const content = entry.message?.content;
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((c) => c && typeof c.text === 'string')
    .map((c) => c.text ?? '')
    .join('\n');
}

/** 文本是否像「提问/等待确认」 */
export function isClaudeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/[?？]\s*$/.test(trimmed)) {
    return true;
  }
  return CLAUDE_WAITING_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * 对追加的行进行分类（纯函数，便于单测）。
 *
 * 规则（取最后一条非 none 信号，按时间顺序）：
 * - assistant：有文本且以提问结尾 -> waiting；否则有 content -> activity
 * - user：tool_result 是自动回填不视为工作；真实输入 -> activity
 * - system/summary：自动写入，不算工作信号
 */
export function classifyClaudeAppend(lines: string[]): ClaudeSignal {
  let result: ClaudeSignal = 'none';
  for (const line of lines) {
    const entry = parseClaudeLine(line);
    if (!entry) {
      continue;
    }
    if (entry.type === 'assistant') {
      const text = extractClaudeText(entry);
      if (text && isClaudeQuestion(text)) {
        result = 'waiting';
      } else if (entry.message?.content?.length) {
        result = 'activity';
      }
    } else if (entry.type === 'user') {
      const content = entry.message?.content;
      const hasToolResult = Array.isArray(content) && content.some((c) => c?.type === 'tool_result');
      if (!hasToolResult) {
        result = 'activity';
      }
    }
  }
  return result;
}

/**
 * Claude Desktop/Code 会话探针 - 强信号
 *
 * 监听 ~/.claude/projects/*.jsonl：文件追加 = Claude 正在生成（activity），
 * 静默超时 = 完成（done），出现「提问」= 等待输入（waiting）。
 * jsonl 格式未官方承诺，解析全部宽松容错。
 */
export class ClaudeSessionProbe implements Probe {
  readonly source = MonitorSource.Claude;

  private emitter = new EventEmitter();
  private watcher: chokidar.FSWatcher | undefined;
  private silenceTimer: NodeJS.Timeout | undefined;
  private isWorking = false;
  /** 每个会话文件已消费的字节偏移 */
  private offsets = new Map<string, number>();

  constructor(private projectsDir: string, private silenceTimeoutSec: number) {}

  start(): void {
    this.watcher = chokidar.watch(this.projectsDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 3,
    });
    this.watcher.on('add', (p) => this.handleAdd(p));
    this.watcher.on('change', (p) => this.handleChange(p));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.clearSilenceTimer();
    this.isWorking = false;
    this.offsets.clear();
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /** 当前是否判定为工作中的会话 */
  isActive(): boolean {
    return this.isWorking;
  }

  private isSessionFile(p: string): boolean {
    return p.endsWith('.jsonl');
  }

  private handleAdd(filePath: string): void {
    if (!this.isSessionFile(filePath)) {
      return;
    }
    // 新会话文件创建 = 对话开始，立即上报 activity
    this.offsets.set(filePath, 0);
    this.beginWorking(`Claude 会话开始: ${path.basename(filePath)}`);
  }

  private handleChange(filePath: string): void {
    if (!this.isSessionFile(filePath)) {
      return;
    }
    const delta = this.readDelta(filePath);
    if (delta === null) {
      return;
    }
    const lines = delta.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) {
      return;
    }

    const signal = classifyClaudeAppend(lines);
    if (signal === 'waiting') {
      this.isWorking = false;
      this.clearSilenceTimer();
      this.fire({
        source: this.source,
        type: 'waiting',
        message: 'Claude 正在等待你的确认或输入',
      });
    } else if (signal === 'activity') {
      this.beginWorking(`Claude 正在生成: ${path.basename(filePath)}`);
    }
  }

  /** 标记为工作中并（仅在状态转移时）上报 activity，同时重置静默定时器 */
  private beginWorking(message: string): void {
    const first = !this.isWorking;
    this.isWorking = true;
    this.resetSilenceTimer();
    if (first) {
      this.fire({ source: this.source, type: 'activity', message });
    }
  }

  /** 读取文件自上次偏移以来的完整行（不完整行留到下次），返回文本或 null */
  private readDelta(filePath: string): string | null {
    let fd: number | undefined;
    try {
      fd = fs.openSync(filePath, 'r');
      const size = fs.fstatSync(fd).size;
      const last = this.offsets.get(filePath) ?? 0;
      if (size < last) {
        // 文件被截断/重写：从头开始，本轮不产出
        this.offsets.set(filePath, size);
        return null;
      }
      if (size === last) {
        return null;
      }
      const len = size - last;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, last);
      // 只消费以换行结尾的完整行，避免读到半截写入
      const nl = buf.lastIndexOf(0x0a);
      if (nl === -1) {
        return null;
      }
      const complete = buf.subarray(0, nl + 1);
      this.offsets.set(filePath, last + complete.length);
      return complete.toString('utf-8');
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.isWorking) {
        this.isWorking = false;
        this.fire({
          source: this.source,
          type: 'done',
          message: 'Claude 活动已停止',
        });
      }
    }, this.silenceTimeoutSec * 1000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private fire(event: MonitorEvent): void {
    this.emitter.emit('event', event);
  }
}
