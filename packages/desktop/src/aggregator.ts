import { EventEmitter } from 'node:events';
import { AIStatus, MonitorEvent, MonitorSource, computeNextStatus } from '@ai-watchdog/core';

/**
 * 单个信号来源的会话状态
 */
interface SessionState {
  status: AIStatus;
  workingSince: Date | undefined;
  lastDoneAt: number;
  lastWaitingAt: number;
}

/**
 * 状态聚合引擎（宿主无关）
 *
 * 每个 MonitorSource 维护独立状态机，全局状态由子状态聚合得出。
 * done/waiting 按来源独立防抖、独立计算最短工作时长门槛。
 *
 * 另有一条仲裁规则：session 级探针（见 `SignalAuthority`）工作期间，
 * heuristic 探针的 done 被丢弃。
 */
export class Aggregator {
  private minWorkDurationMs = 30_000;
  private static readonly DEBOUNCE_MS = 1500;

  private sessions = new Map<MonitorSource, SessionState>();
  private globalStatus: AIStatus = AIStatus.Idle;
  private emitter = new EventEmitter();

  /** 正在工作的 session 级探针（其 done 才是权威的） */
  private activeSessions = new Set<MonitorSource>();

  /** 设置最短工作时长门槛（秒）；0 表示不设门槛 */
  setMinWorkDuration(seconds: number): void {
    this.minWorkDurationMs = Math.max(0, seconds) * 1000;
  }

  get currentStatus(): AIStatus {
    return this.globalStatus;
  }

  /** 所有 working session 中最长的时长（最老的 workingSince） */
  get workingDuration(): number {
    let oldest: Date | undefined;
    for (const s of this.sessions.values()) {
      if (s.status === AIStatus.Working && s.workingSince) {
        if (!oldest || s.workingSince < oldest) {
          oldest = s.workingSince;
        }
      }
    }
    return oldest ? Date.now() - oldest.getTime() : 0;
  }

  /** 获取所有非 idle 的会话（用于托盘展示） */
  getActiveSessions(): Array<{ source: MonitorSource; status: AIStatus; durationMs: number }> {
    const result: Array<{ source: MonitorSource; status: AIStatus; durationMs: number }> = [];
    for (const [source, s] of this.sessions) {
      if (s.status !== AIStatus.Idle) {
        result.push({
          source,
          status: s.status,
          durationMs: s.workingSince ? Date.now() - s.workingSince.getTime() : 0,
        });
      }
    }
    return result;
  }

  onStatusChange(callback: (status: AIStatus) => void): void {
    this.emitter.on('status', callback);
  }

  onNotify(callback: (payload: { type: 'done' | 'waiting'; source: MonitorSource; files?: string[] }) => void): void {
    this.emitter.on('notify', callback);
  }

  handleEvent(event: MonitorEvent): void {
    const isSession = event.authority === 'session';
    let suppressNotify = false;

    // 信号权威性仲裁：heuristic 的 done 在 session 工作期间被压制（不通知），
    // 但状态仍正常转移——文件探针确实静默了，只是不抢在 session 前面发通知。
    if (isSession) {
      if (event.type === 'activity') {
        this.activeSessions.add(event.source);
      } else {
        this.activeSessions.delete(event.source);
      }
    } else if (event.type === 'done' && this.activeSessions.size > 0) {
      suppressNotify = true;
    }

    const session = this.getOrCreateSession(event.source);
    const next = computeNextStatus(session.status, event.type);
    if (next === null) {
      return;
    }

    const workedMs = session.workingSince
      ? Date.now() - session.workingSince.getTime()
      : undefined;

    session.status = next;
    if (event.type === 'activity') {
      session.workingSince = new Date();
    } else if (event.type === 'idle') {
      session.workingSince = undefined;
    }

    this.recomputeGlobalStatus();

    if (suppressNotify) {
      return;
    }

    // 按 session 独立防抖 + 最短工作时长门槛
    if (event.type === 'done') {
      const now = Date.now();
      if (now - session.lastDoneAt < Aggregator.DEBOUNCE_MS) {
        return;
      }
      if (workedMs !== undefined && workedMs < this.minWorkDurationMs) {
        return;
      }
      session.lastDoneAt = now;
      this.emitter.emit('notify', { type: 'done' as const, source: event.source, files: event.files });
    } else if (event.type === 'waiting') {
      const now = Date.now();
      if (now - session.lastWaitingAt < Aggregator.DEBOUNCE_MS) {
        return;
      }
      session.lastWaitingAt = now;
      this.emitter.emit('notify', { type: 'waiting' as const, source: event.source, files: event.files });
    }
  }

  /** 清除所有 done/waiting 状态的 session，回到 idle */
  acknowledge(): void {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.status === AIStatus.Done || s.status === AIStatus.Waiting) {
        s.status = AIStatus.Idle;
        s.workingSince = undefined;
        changed = true;
      }
    }
    if (changed) {
      this.recomputeGlobalStatus();
    }
  }

  private getOrCreateSession(source: MonitorSource): SessionState {
    let session = this.sessions.get(source);
    if (!session) {
      session = {
        status: AIStatus.Idle,
        workingSince: undefined,
        lastDoneAt: 0,
        lastWaitingAt: 0,
      };
      this.sessions.set(source, session);
    }
    return session;
  }

  /** 聚合所有 session 状态，若全局状态变化则 emit */
  private recomputeGlobalStatus(): void {
    const prev = this.globalStatus;
    let hasWorking = false;
    let hasWaiting = false;
    let hasDone = false;

    for (const s of this.sessions.values()) {
      if (s.status === AIStatus.Working) hasWorking = true;
      else if (s.status === AIStatus.Waiting) hasWaiting = true;
      else if (s.status === AIStatus.Done) hasDone = true;
    }

    if (hasWaiting) {
      this.globalStatus = AIStatus.Waiting;
    } else if (hasWorking) {
      this.globalStatus = AIStatus.Working;
    } else if (hasDone) {
      this.globalStatus = AIStatus.Done;
    } else {
      this.globalStatus = AIStatus.Idle;
    }

    if (this.globalStatus !== prev) {
      this.emitter.emit('status', this.globalStatus);
    }
  }
}
