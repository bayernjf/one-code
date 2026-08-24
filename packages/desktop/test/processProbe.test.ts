import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorEvent } from '@ai-watchdog/core';
import { ProcessProbe } from '../src/probes/processProbe';

/** 构造 mock execFile，返回指定 stdout */
function mockExec(stdout: string) {
  return (
    _cmd: string,
    _args: string[],
    _opts: { maxBuffer: number },
    cb: (err: Error | null, stdout: string) => void
  ) => {
    cb(null, stdout);
  };
}

test('ProcessProbe: 匹配到进程时 isActive 为 true，不触发 done', async () => {
  const probe = new ProcessProbe(['Cursor'], 10, mockExec('/usr/bin/Cursor\n/usr/bin/finder\n'));
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  probe.start();
  await new Promise((r) => setTimeout(r, 50));
  probe.stop();

  assert.equal(probe.isActive(), true);
  assert.equal(events.length, 0);
});

test('ProcessProbe: 从活跃变为不活跃时触发 done', async () => {
  let stdout = '/usr/bin/Cursor\n';
  const probe = new ProcessProbe(['Cursor'], 10, (_c, _a, _o, cb) => cb(null, stdout));
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  // try/finally：断言失败也必须清掉轮询 interval，否则进程挂起不退出
  try {
    probe.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(probe.isActive(), true);

    // 进程消失
    stdout = '/usr/bin/finder\n';
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    probe.stop();
  }

  assert.equal(probe.isActive(), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'done');
});

test('ProcessProbe: execFile 出错时不改变状态', async () => {
  const probe = new ProcessProbe(['Cursor'], 10, (_c, _a, _o, cb) => cb(new Error('boom'), ''));
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));

  probe.start();
  await new Promise((r) => setTimeout(r, 50));
  probe.stop();

  assert.equal(probe.isActive(), false);
  assert.equal(events.length, 0);
});
