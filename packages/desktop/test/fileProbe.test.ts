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

test('FileProbe: 窗口内快速变更触发 activity，静默后触发 done', async () => {
  const dir = makeTmpDir();
  // 阈值 3，窗口 1s，静默 300ms
  const probe = new FileProbe([dir], 1000, 3, 0.3);
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  probe.start();
  await sleep(100); // 等 chokidar 就绪

  // 快速写入 3 个文件触发 activity
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, `file-${i}.ts`), `content ${i}`);
    await sleep(50);
  }

  // 等静默超时触发 done
  await sleep(500);

  probe.stop();
  fs.rmSync(dir, { recursive: true, force: true });

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

  probe.start();
  await sleep(100);

  // 在 node_modules 里快速写入，应被忽略
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(nodeModules, `dep-${i}.js`), `x`);
    await sleep(50);
  }

  await sleep(500);
  probe.stop();
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(events.length, 0, `忽略目录不应触发事件，实际: ${JSON.stringify(events.map((e) => e.type))}`);
});
