import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { MonitorSource, MonitorEvent } from '@ai-watchdog/core';
import { Probe } from './probe';
import { ShellSessionState } from '../shellHook/zsh';

/** 状态转移结果：'activity' | 'done'，无变化时为 null */
export type ShellTransition = 'activity' | 'done' | null;

/**
 * 依据上次活跃态与当前状态，计算应发出的转移（纯函数，便于单测）。
 * 状态文件不存在 / 解析失败（state 为 null）不判定 done，避免启动时误报。
 */
export function evaluateShellState(
  prevActive: boolean,
  state: ShellSessionState | null
): ShellTransition {
  const active = !!state?.active;
  if (active === prevActive) {
    return null;
  }
  if (active) {
    return 'activity';
  }
  // 只有明确写入 active:false 才算会话结束
  return state ? 'done' : null;
}

/**
 * Shell Hook 探针 - 精确终端信号
 *
 * 消费 zsh hook 写入的状态文件：AI CLI 开始 -> activity（working），
 * 结束 -> done。这是强信号，可独立触发状态转移。
 */
export class ShellHookProbe implements Probe {
  readonly source = MonitorSource.ShellHook;

  private emitter = new EventEmitter();
  private watcher: chokidar.FSWatcher | undefined;
  private lastActive = false;

  constructor(private stateFilePath: string) {}

  start(): void {
    // 先读一遍当前状态（若已有活跃会话则立即上报），再监听后续变化
    this.readAndEmit();
    this.watcher = chokidar.watch(this.stateFilePath, {
      ignoreInitial: true,
      persistent: true,
    });
    this.watcher.on('change', () => this.readAndEmit());
    this.watcher.on('add', () => this.readAndEmit());
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.lastActive = false;
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /** 当前状态文件是否标记为活跃会话 */
  isActive(): boolean {
    return this.lastActive;
  }

  private readAndEmit(): void {
    let state: ShellSessionState | null = null;
    try {
      state = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf-8')) as ShellSessionState;
    } catch {
      // 文件不存在或缺省 / 解析失败：视为无会话，不做 done 判定
    }

    const transition = evaluateShellState(this.lastActive, state);
    if (transition === null) {
      return;
    }
    this.lastActive = !!state?.active;

    if (transition === 'activity') {
      this.fire({
        source: this.source,
        type: 'activity',
        message: `AI CLI session started: ${state?.tool ?? 'unknown'}`,
      });
    } else {
      this.fire({
        source: this.source,
        type: 'done',
        message: `AI CLI session ended: ${state?.tool ?? 'unknown'}`,
      });
    }
  }

  /** precmd/preexec 是宿主告知的确定性生命周期，属 session 级 */
  private fire(event: MonitorEvent): void {
    this.emitter.emit('event', { ...event, authority: 'session' });
  }
}