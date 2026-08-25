import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { MonitorSource, MonitorEvent } from '@ai-watchdog/core';
import { Probe } from './probe';

/** rollout jsonl 单行结构（格式未官方承诺，宽松解析） */
export interface CodexRolloutEntry {
  type?: string;
  payload?: {
    type?: string;
    turn_id?: string;
    reason?: string;
  };
}

/** 一次 turn 的生命周期转移 */
export interface CodexTurnTransition {
  kind: 'start' | 'complete' | 'abort';
  turnId: string;
}

/** 解析单行 jsonl，失败返回 null */
export function parseCodexLine(line: string): CodexRolloutEntry | null {
  try {
    const entry = JSON.parse(line) as CodexRolloutEntry;
    if (entry && typeof entry === 'object') {
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从追加的行中提取 turn 生命周期转移（纯函数，便于单测）。
 *
 * Codex 的 rollout 里有显式生命周期事件，无需像 Claude 那样靠静默超时猜测：
 * - `task_started` -> turn 开始
 * - `task_complete` -> turn 正常结束
 * - `turn_aborted` -> turn 被中断（用户已在键盘前，不该当作「完成」去打扰）
 *
 * 其余事件（token_count / agent_reasoning / item_completed 等）不影响状态，
 * 因为开始与结束已经是精确信号。
 */
export function extractCodexTransitions(lines: string[]): CodexTurnTransition[] {
  const transitions: CodexTurnTransition[] = [];
  for (const line of lines) {
    const entry = parseCodexLine(line);
    if (entry?.type !== 'event_msg') {
      continue;
    }
    const turnId = entry.payload?.turn_id;
    if (typeof turnId !== 'string' || turnId.length === 0) {
      continue;
    }
    if (entry.payload?.type === 'task_started') {
      transitions.push({ kind: 'start', turnId });
    } else if (entry.payload?.type === 'task_complete') {
      transitions.push({ kind: 'complete', turnId });
    } else if (entry.payload?.type === 'turn_aborted') {
      transitions.push({ kind: 'abort', turnId });
    }
  }
  return transitions;
}

/** 卡死 turn 的清理间隔 */
const PRUNE_INTERVAL_MS = 60 * 1000;

/**
 * Codex 会话探针 - 强信号
 *
 * 监听 `~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl`。写入方是 `codex`
 * 进程，ChatGPT 桌面端会 fork 它（`ChatGPT.app/Contents/Resources/codex app-server`），
 * VS Code 的 openai.chatgpt 扩展与终端 CLI 也写同一套文件 —— 所以这一个探针同时
 * 覆盖三个入口。
 *
 * 状态取自显式生命周期事件而非静默超时：任一 turn 开始即 working，全部 turn 结束
 * 才 done（桌面端可并发多个会话线程）。
 *
 * 局限：rollout 不落盘「等待用户批准」类事件，因此本探针不产出 waiting。
 */
export class CodexSessionProbe implements Probe {
  readonly source = MonitorSource.Codex;

  private emitter = new EventEmitter();
  private watcher: chokidar.FSWatcher | undefined;
  private pruneTimer: NodeJS.Timeout | undefined;
  /** 进行中的 turn -> 观察到开始的时刻，用于清理卡死条目 */
  private activeTurns = new Map<string, number>();
  /** 每个 rollout 文件已消费的字节偏移 */
  private offsets = new Map<string, number>();

  constructor(
    private sessionsDir: string,
    private maxTurnMinutes: number,
    private now: () => number = Date.now
  ) {}

  start(): void {
    // 年/月/日/文件 共 4 层
    this.watcher = chokidar.watch(this.sessionsDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 4,
    });
    this.watcher.on('add', (p) => this.handleAdd(p));
    this.watcher.on('change', (p) => this.handleChange(p));

    this.pruneTimer = setInterval(() => this.pruneStaleTurns(), PRUNE_INTERVAL_MS);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
    this.activeTurns.clear();
    this.offsets.clear();
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /** 当前是否有进行中的 turn */
  isActive(): boolean {
    return this.activeTurns.size > 0;
  }

  /** 监听期间新建的会话文件：从头消费（新文件很小，且 turn 开始就在其中） */
  handleAdd(filePath: string): void {
    if (!this.isRolloutFile(filePath)) {
      return;
    }
    this.offsets.set(filePath, 0);
    this.handleChange(filePath);
  }

  /** 供测试驱动的单次处理入口 */
  handleChange(filePath: string): void {
    if (!this.isRolloutFile(filePath)) {
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
    this.applyTransitions(extractCodexTransitions(lines));
  }

  private isRolloutFile(filePath: string): boolean {
    return filePath.endsWith('.jsonl');
  }

  private applyTransitions(transitions: CodexTurnTransition[]): void {
    for (const t of transitions) {
      const before = this.activeTurns.size;

      if (t.kind === 'start') {
        this.activeTurns.set(t.turnId, this.now());
        if (before === 0) {
          this.fire({ source: this.source, type: 'activity', message: 'Codex 正在处理任务' });
        }
        continue;
      }

      if (!this.activeTurns.delete(t.turnId)) {
        // 未见过其开始（探针启动前就在跑）：不推断状态
        continue;
      }
      if (this.activeTurns.size > 0) {
        continue;
      }
      if (t.kind === 'complete') {
        this.fire({ source: this.source, type: 'done', message: 'Codex 已完成任务' });
      } else {
        this.fire({ source: this.source, type: 'idle', message: 'Codex 任务已中断' });
      }
    }
  }

  /** 清理迟迟不结束的 turn（宿主崩溃后不会再有事件，否则永久卡在 working） */
  private pruneStaleTurns(): void {
    if (this.activeTurns.size === 0) {
      return;
    }
    const deadline = this.now() - this.maxTurnMinutes * 60 * 1000;
    let pruned = false;
    for (const [turnId, startedAt] of this.activeTurns) {
      if (startedAt < deadline) {
        this.activeTurns.delete(turnId);
        pruned = true;
      }
    }
    if (pruned && this.activeTurns.size === 0) {
      this.fire({ source: this.source, type: 'idle', message: 'Codex 任务超时未结束' });
    }
  }

  /**
   * 读取文件自上次偏移以来的完整行（不完整行留到下次）。
   *
   * 首次见到某文件时直接跳到当前 EOF：rollout 可达数十 MB，重放历史 turn 会造成
   * 大量假信号。
   */
  private readDelta(filePath: string): string | null {
    let fd: number | undefined;
    try {
      fd = fs.openSync(filePath, 'r');
      const size = fs.fstatSync(fd).size;
      const known = this.offsets.get(filePath);
      if (known === undefined) {
        this.offsets.set(filePath, size);
        return null;
      }
      if (size < known) {
        // 文件被截断/重写：对齐到新长度，本轮不产出
        this.offsets.set(filePath, size);
        return null;
      }
      if (size === known) {
        return null;
      }
      const len = size - known;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, known);
      const nl = buf.lastIndexOf(0x0a);
      if (nl === -1) {
        return null;
      }
      const complete = buf.subarray(0, nl + 1);
      this.offsets.set(filePath, known + complete.length);
      return complete.toString('utf-8');
    } catch {
      return null;
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
    }
  }

  /** rollout 的 task_started/task_complete 是宿主告知的确定性生命周期，属 session 级 */
  private fire(event: MonitorEvent): void {
    this.emitter.emit('event', { ...event, authority: 'session' });
  }
}
