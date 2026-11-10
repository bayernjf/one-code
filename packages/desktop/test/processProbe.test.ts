import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorEvent } from '@ai-watchdog/core';
import { ProcessProbe, processListCommand } from '../src/probes/processProbe';

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

test('processListCommand: Windows 用 tasklist，其他平台用 ps', () => {
  assert.deepEqual(processListCommand('win32'), { cmd: 'tasklist', args: ['/FO', 'CSV', '/NH'] });
  assert.deepEqual(processListCommand('darwin'), { cmd: 'ps', args: ['-axo', 'comm'] });
  assert.deepEqual(processListCommand('linux'), { cmd: 'ps', args: ['-axo', 'comm'] });
});

test('ProcessProbe: Windows 上调用 tasklist 并能匹配 tasklist 的 CSV 输出', async () => {
  const calls: string[] = [];
  const csv = '"Code.exe","1234","Console","1","120,000 K"\n"explorer.exe","9","Console","1","8 K"\n';
  const probe = new ProcessProbe(
    ['Code'],
    10,
    (cmd, _a, _o, cb) => {
      calls.push(cmd);
      cb(null, csv);
    },
    'win32'
  );

  try {
    probe.start();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    probe.stop();
  }

  assert.equal(calls[0], 'tasklist');
  assert.equal(probe.isActive(), true);
});

// ── 读取侧容错（2026-11-02 评审 P1-1）：脏配置不得让进程崩，非法模式被跳过
// 并记录，合法模式照常匹配。这些用例在修复前的实现上会直接抛 SyntaxError。

/** 临时吞掉 console.error 并记录调用，返回恢复函数 */
function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
}

test('ProcessProbe: 脏配置启动不崩——非法模式被跳过并记录，合法模式照常匹配', async () => {
  const { calls: errorLogs, restore } = captureConsoleError();
  let probe: ProcessProbe;
  try {
    probe = new ProcessProbe(['Cursor', '[', '(?<bad'], 10, mockExec('/usr/bin/Cursor\n'));
    assert.deepEqual(probe.getSkippedPatterns(), ['[', '(?<bad'], '非法模式必须被逐条隔离');

    try {
      probe.start();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      probe.stop();
    }
    assert.equal(probe.isActive(), true, '合法的 "Cursor" 模式仍要正常匹配');
  } finally {
    restore();
  }
  assert.equal(errorLogs.length, 2, '每条被跳过的模式记录一次日志');
  assert.ok(String(errorLogs[0][0]).includes('skipping invalid process pattern'));
});

test('ProcessProbe: 全部模式非法时探针保持存活但不误报活跃', async () => {
  const { restore } = captureConsoleError();
  try {
    const probe = new ProcessProbe(['[', '(?<bad'], 10, mockExec('/usr/bin/Cursor\n'));
    assert.deepEqual(probe.getSkippedPatterns(), ['[', '(?<bad']);
    const events: MonitorEvent[] = [];
    probe.onEvent((e) => events.push(e));

    try {
      probe.start();
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      probe.stop();
    }
    assert.equal(probe.isActive(), false, '没有合法模式可匹配时必须保持不活跃，而不是崩掉');
    assert.equal(events.length, 0);
  } finally {
    restore();
  }
});

test('ProcessProbe: 用户在设置页改正模式后恢复正常匹配（自愈闭环）', async () => {
  const { restore } = captureConsoleError();
  try {
    // 修复前：用户在旧版本保存了 "["，落盘成脏配置；加载后该模式被隔离
    const broken = new ProcessProbe(['['], 10, mockExec('/usr/bin/gemini\n'));
    try {
      broken.start();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      broken.stop();
    }
    assert.equal(broken.isActive(), false);

    // 用户按设置页标红提示删除/改正目标后，主进程用新配置重建探针
    const fixed = new ProcessProbe(['gemini'], 10, mockExec('/usr/bin/gemini\n'));
    assert.deepEqual(fixed.getSkippedPatterns(), []);
    try {
      fixed.start();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      fixed.stop();
    }
    assert.equal(fixed.isActive(), true, '改正后的模式必须恢复正常匹配');
  } finally {
    restore();
  }
});
