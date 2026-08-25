import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MonitorEvent } from '@ai-watchdog/core';
import { FileProbe } from '../src/probes/fileProbe';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatchdog-test-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询等待条件成立，超时抛错（慢速 CI runner 上比固定 sleep 可靠） */
async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(`timeout waiting for ${label}`);
    }
    await sleep(25);
  }
}

test('FileProbe: 窗口内快速变更触发 activity，静默后触发 done', async () => {
  const dir = makeTmpDir();
  // 阈值 3，窗口 2s（慢速 runner 留余量），静默 300ms
  const probe = new FileProbe([dir], 2000, 3, 0.3);
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  // try/finally：断言失败也必须关掉 watcher，否则进程因事件循环挂起不退出
  try {
    probe.start();

    // 持续写入直到 activity 出现，而不是「睡一会儿等 chokidar 就绪 + 正好写 3 个」：
    // 慢机器上初始扫描没结束时写的文件会被漏掉，凑不满阈值
    let seq = 0;
    await waitFor(
      () => {
        if (!events.some((e) => e.type === 'activity')) {
          fs.writeFileSync(path.join(dir, `file-${seq++}.ts`), `content ${seq}`);
        }
        return events.some((e) => e.type === 'activity');
      },
      5000,
      'activity event'
    );
    // 等静默超时触发 done
    await waitFor(() => events.some((e) => e.type === 'done'), 3000, 'done event');
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const types = events.map((e) => e.type);
  assert.ok(types.includes('activity'), `应触发 activity，实际: ${JSON.stringify(types)}`);
  assert.ok(types.includes('done'), `应触发 done，实际: ${JSON.stringify(types)}`);
});

test('FileProbe: 忽略目录内的变更不触发 activity', async () => {
  const dir = makeTmpDir();
  const nodeModules = path.join(dir, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });

  const probe = new FileProbe([dir], 1000, 3, 0.3, ['**/node_modules/**']);
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  try {
    probe.start();
    await sleep(100);

    // 在 node_modules 里快速写入，应被忽略
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(nodeModules, `dep-${i}.js`), `x`);
      await sleep(50);
    }

    await sleep(500);
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(events.length, 0, `忽略目录不应触发事件，实际: ${JSON.stringify(events.map((e) => e.type))}`);
});
