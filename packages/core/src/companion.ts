import os from 'node:os';
import path from 'node:path';
import { MonitorEvent, MonitorSource } from './types';

/** 伴侣上报的来源白名单（宿主内部深度信号） */
const COMPANION_SOURCES: string[] = [MonitorSource.VSCodeCompanion];

const EVENT_TYPES: MonitorEvent['type'][] = ['activity', 'done', 'waiting', 'idle'];

/** 鉴权帧：连接后必须发送的第一行 */
export interface AuthFrame {
  kind: 'auth';
  token: string;
}

/** 心跳帧 */
export interface PingFrame {
  kind: 'ping';
}

/** 事件帧：复用 MonitorEvent 语义 */
export interface EventFrame {
  kind: 'event';
  event: MonitorEvent;
}

export type CompanionFrame = AuthFrame | PingFrame | EventFrame;

/** 伴侣 socket 路径（Windows 用命名管道） */
export function companionSocketPath(homedir = os.homedir()): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\ai-watchdog-companion';
  }
  return path.join(homedir, '.ai-watchdog', 'companion.sock');
}

/** 伴侣鉴权 token 文件路径 */
export function companionTokenPath(homedir = os.homedir()): string {
  return path.join(homedir, '.ai-watchdog', 'companion-token');
}

/**
 * 解析一行 JSON lines 协议帧（纯函数，两侧共用）。
 * 任何非法输入返回 null——由调用方决定断连还是忽略。
 */
export function parseCompanionLine(line: string): CompanionFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  if (obj.kind === 'auth') {
    return typeof obj.token === 'string' && obj.token.length > 0
      ? { kind: 'auth', token: obj.token }
      : null;
  }

  if (obj.kind === 'ping') {
    return { kind: 'ping' };
  }

  if (obj.kind === 'event') {
    const source = obj.source;
    const type = obj.type;
    if (typeof source !== 'string' || !COMPANION_SOURCES.includes(source)) {
      return null;
    }
    if (typeof type !== 'string' || !EVENT_TYPES.includes(type as MonitorEvent['type'])) {
      return null;
    }
    const event: MonitorEvent = {
      source: source as MonitorSource,
      type: type as MonitorEvent['type'],
    };
    if (Array.isArray(obj.files) && obj.files.every((f) => typeof f === 'string')) {
      event.files = obj.files as string[];
    }
    if (typeof obj.message === 'string') {
      event.message = obj.message;
    }
    return { kind: 'event', event };
  }

  return null;
}

/** 序列化事件帧为一行（伴侣侧发送用） */
export function serializeEventFrame(event: MonitorEvent): string {
  return `${JSON.stringify({ kind: 'event', ...event })}\n`;
}
