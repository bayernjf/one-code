import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { MonitorEvent, MonitorSource, parseCompanionLine } from '@ai-watchdog/core';
import { Probe } from '../probes/probe';

/** 单行上限，防止畸形客户端无限撑大缓冲区 */
const MAX_LINE_BYTES = 64 * 1024;

function tokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 伴侣 socket 服务端（阶段 4a）
 *
 * 监听本地 Unix domain socket（Windows 为命名管道），接收宿主内部伴侣
 * （VS Code 扩展等）上报的深度信号。连接后第一行必须是 auth 帧且 token
 * 匹配，否则立即断开。事件保留帧内 source，喂给聚合引擎与其他探针同等处理。
 *
 * 信号分级（design.md §4）留在信号源侧：伴侣只上报自认为够强的信号。
 */
export class CompanionServer implements Probe {
  readonly source = MonitorSource.VSCodeCompanion;

  private emitter = new EventEmitter();
  private server: net.Server | undefined;
  private connections = new Set<net.Socket>();

  constructor(
    private socketPath: string,
    private token: string
  ) {}

  start(): void {
    // 清理上次异常退出留下的 socket 文件（命名管道无需处理）
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // 不存在即可
      }
      fs.mkdirSync(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (err) => {
      console.error('[companion] server error:', err.message);
    });
    this.server.listen(this.socketPath, () => {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch {
          // 权限设置失败不阻断，token 鉴权仍在
        }
      }
      console.log(`[companion] listening on ${this.socketPath}`);
    });
  }

  stop(): void {
    this.connections.forEach((s) => s.destroy());
    this.connections.clear();
    this.server?.close();
    this.server = undefined;
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // 已被清理
      }
    }
  }

  onEvent(callback: (event: MonitorEvent) => void): void {
    this.emitter.on('event', callback);
  }

  /** 当前已鉴权连接数（供设置页/托盘展示） */
  get connectionCount(): number {
    return this.connections.size;
  }

  private handleConnection(socket: net.Socket): void {
    let authed = false;
    let buffer = '';

    const close = (reason: string): void => {
      console.log(`[companion] connection closed: ${reason}`);
      socket.destroy();
    };

    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.connections.delete(socket));

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      if (buffer.length > MAX_LINE_BYTES) {
        close('line too long');
        return;
      }

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (line.length > 0) {
          const frame = parseCompanionLine(line);

          if (!authed) {
            if (frame?.kind !== 'auth' || !tokenMatches(this.token, frame.token)) {
              close('authentication failed');
              return;
            }
            authed = true;
            this.connections.add(socket);
            console.log('[companion] client authenticated');
          } else if (frame?.kind === 'ping') {
            socket.write('{"kind":"pong"}\n');
          } else if (frame?.kind === 'event') {
            this.emitter.emit('event', frame.event);
          }
          // frame 为 null 或重复 auth：忽略该行，不断开（伴侣版本可能更新）
        }

        newline = buffer.indexOf('\n');
      }
    });
  }
}
