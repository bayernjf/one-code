import fs from 'node:fs';
import net from 'node:net';
import {
  MonitorEvent,
  MonitorSource,
  companionSocketPath,
  companionTokenPath,
  serializeEventFrame,
} from '@ai-watchdog/core';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_MS = 30000;

/**
 * 伴侣客户端（阶段 4a）
 *
 * 把扩展在宿主内部拿到的深度信号经本地 socket 上报给桌面守护进程。
 * 守护进程未启动时静默退避重连，不弹任何提示——扩展浅层监控照常工作。
 *
 * 只做上报，不做状态判断：判断/防抖/通知全在守护进程侧。
 */
export class CompanionClient {
  private socket: net.Socket | undefined;
  private connected = false;
  private disposed = false;
  private backoff = RECONNECT_MIN_MS;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(
    private socketPath: string = companionSocketPath(),
    private tokenPath: string = companionTokenPath()
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.disposed || this.socket) {
      return;
    }

    let token: string;
    try {
      token = fs.readFileSync(this.tokenPath, 'utf-8').trim();
    } catch {
      // 守护进程从未启动过，token 文件还不存在
      this.scheduleReconnect();
      return;
    }
    if (!token) {
      this.scheduleReconnect();
      return;
    }

    const socket = net.createConnection(this.socketPath);
    this.socket = socket;

    socket.on('connect', () => {
      this.connected = true;
      this.backoff = RECONNECT_MIN_MS;
      socket.write(`${JSON.stringify({ kind: 'auth', token })}\n`);
      this.startHeartbeat();
      console.log('[AI Watchdog] 伴侣模式已连接守护进程');
    });

    // 守护进程未运行属常态，静默处理
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.connected = false;
      this.socket = undefined;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
    // 服务端回包（pong）无需处理，读掉即可避免背压
    socket.resume();
  }

  /** 上报一条深度信号；未连接时直接丢弃，避免堆积陈旧信号 */
  report(event: MonitorEvent): void {
    if (!this.connected || !this.socket) {
      return;
    }
    this.socket.write(
      serializeEventFrame({ ...event, source: MonitorSource.VSCodeCompanion })
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.destroy();
    this.socket = undefined;
    this.connected = false;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.socket?.write('{"kind":"ping"}\n');
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
