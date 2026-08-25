import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { MonitorEvent, MonitorSource, serializeEventFrame } from '@ai-watchdog/core';
import { CompanionServer } from '../src/companion/server';
import { ensureToken } from '../src/companion/token';

const TOKEN = 'a'.repeat(64);

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatchdog-companion-'));
}

let pipeSeq = 0;

/** Windows 只能监听命名管道，不能监听文件系统路径 */
function makeSocketPath(dir: string): string {
  if (process.platform === 'win32') {
    pipeSeq += 1;
    return `\\\\.\\pipe\\aiwatchdog-test-${process.pid}-${pipeSeq}`;
  }
  return path.join(dir, 'companion.sock');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(`timeout waiting for ${label}`);
    }
    await sleep(25);
  }
}

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** 命名管道没有文件可 stat，统一用「能连上」判断服务端就绪 */
async function waitForListening(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const probe = await connect(socketPath);
      probe.destroy();
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        assert.fail('timeout waiting for server listening');
      }
      await sleep(25);
    }
  }
}

/** 起一个服务端并在回调结束后确保清理（否则事件循环挂起） */
async function withServer(
  fn: (ctx: { socketPath: string; events: MonitorEvent[]; server: CompanionServer }) => Promise<void>
): Promise<void> {
  const dir = makeTmpDir();
  const socketPath = makeSocketPath(dir);
  const server = new CompanionServer(socketPath, TOKEN);
  const events: MonitorEvent[] = [];
  server.onEvent((e) => events.push(e));

  try {
    server.start();
    await waitForListening(socketPath, 3000);
    await fn({ socketPath, events, server });
  } finally {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CompanionServer: 正确 token 鉴权后事件送达且保留 source', async () => {
  await withServer(async ({ socketPath, events }) => {
    const client = await connect(socketPath);
    try {
      client.write(`${JSON.stringify({ kind: 'auth', token: TOKEN })}\n`);
      client.write(
        serializeEventFrame({
          source: MonitorSource.VSCodeCompanion,
          type: 'activity',
          message: 'copilot streaming',
        })
      );
      await waitFor(() => events.length > 0, 3000, 'companion event');
    } finally {
      client.destroy();
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].source, MonitorSource.VSCodeCompanion);
    assert.equal(events[0].type, 'activity');
    assert.equal(events[0].message, 'copilot streaming');
  });
});

test('CompanionServer: 错误 token 立即断开且不产生事件', async () => {
  await withServer(async ({ socketPath, events, server }) => {
    const client = await connect(socketPath);
    const closed = new Promise<void>((r) => client.once('close', () => r()));
    client.write(`${JSON.stringify({ kind: 'auth', token: 'wrong-token' })}\n`);
    client.write(serializeEventFrame({ source: MonitorSource.VSCodeCompanion, type: 'activity' }));

    await Promise.race([closed, sleep(3000)]);
    assert.equal(events.length, 0, '未鉴权连接不应产生事件');
    assert.equal(server.connectionCount, 0);
    client.destroy();
  });
});

test('CompanionServer: 首帧不是 auth 时断开', async () => {
  await withServer(async ({ socketPath, events }) => {
    const client = await connect(socketPath);
    const closed = new Promise<void>((r) => client.once('close', () => r()));
    client.write(serializeEventFrame({ source: MonitorSource.VSCodeCompanion, type: 'done' }));

    await Promise.race([closed, sleep(3000)]);
    assert.equal(events.length, 0);
    client.destroy();
  });
});

test('CompanionServer: 非法行被忽略，后续合法行仍生效；ping 回 pong', async () => {
  await withServer(async ({ socketPath, events }) => {
    const client = await connect(socketPath);
    const replies: string[] = [];
    client.on('data', (d) => replies.push(d.toString('utf-8')));

    try {
      client.write(`${JSON.stringify({ kind: 'auth', token: TOKEN })}\n`);
      client.write('not json at all\n');
      client.write(`${JSON.stringify({ kind: 'event', source: 'file-watcher', type: 'done' })}\n`);
      client.write(`${JSON.stringify({ kind: 'ping' })}\n`);
      client.write(serializeEventFrame({ source: MonitorSource.VSCodeCompanion, type: 'waiting' }));

      await waitFor(() => events.length > 0, 3000, 'valid event after invalid lines');
      await waitFor(() => replies.join('').includes('pong'), 3000, 'pong reply');
    } finally {
      client.destroy();
    }

    assert.equal(events.length, 1, '仅合法伴侣事件应送达');
    assert.equal(events[0].type, 'waiting');
  });
});

test('CompanionServer: 跨 chunk 分片的行被正确重组', async () => {
  await withServer(async ({ socketPath, events }) => {
    const client = await connect(socketPath);
    try {
      const auth = `${JSON.stringify({ kind: 'auth', token: TOKEN })}\n`;
      client.write(auth.slice(0, 10));
      await sleep(30);
      client.write(auth.slice(10));

      const line = serializeEventFrame({ source: MonitorSource.VSCodeCompanion, type: 'done' });
      client.write(line.slice(0, 15));
      await sleep(30);
      client.write(line.slice(15));

      await waitFor(() => events.length > 0, 3000, 'reassembled event');
    } finally {
      client.destroy();
    }
    assert.equal(events[0].type, 'done');
  });
});

test('ensureToken: 生成后幂等，权限为 0600', () => {
  const dir = makeTmpDir();
  const tokenPath = path.join(dir, 'nested', 'companion-token');
  try {
    const first = ensureToken(tokenPath);
    assert.equal(first.length, 64, 'token 应为 32 字节 hex');
    assert.equal(ensureToken(tokenPath), first, '再次调用应复用同一 token');

    if (process.platform !== 'win32') {
      const mode = fs.statSync(tokenPath).mode & 0o777;
      assert.equal(mode, 0o600, `token 文件权限应为 0600，实际 ${mode.toString(8)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
