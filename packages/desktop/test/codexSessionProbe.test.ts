import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MonitorEvent } from '@ai-watchdog/core';
import { CodexSessionProbe, extractCodexTransitions } from '../src/probes/codexSessionProbe';

function eventLine(type: string, turnId: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    timestamp: '2026-08-25T10:21:58.676Z',
    type: 'event_msg',
    payload: { type, turn_id: turnId, ...extra },
  })}\n`;
}

test('extractCodexTransitions: 识别 started / complete / aborted', () => {
  const transitions = extractCodexTransitions([
    eventLine('task_started', 't1').trim(),
    eventLine('token_count', 't1').trim(),
    eventLine('task_complete', 't1').trim(),
    eventLine('turn_aborted', 't2', { reason: 'interrupted' }).trim(),
  ]);
  assert.deepEqual(transitions, [
    { kind: 'start', turnId: 't1' },
    { kind: 'complete', turnId: 't1' },
    { kind: 'abort', turnId: 't2' },
  ]);
});

test('extractCodexTransitions: 忽略非法行、非 event_msg 与缺 turn_id 的行', () => {
  const transitions = extractCodexTransitions([
    'not json',
    JSON.stringify({ type: 'session_meta', payload: { type: 'task_started' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
  ]);
  assert.deepEqual(transitions, []);
});

/** 起探针并保证清理 */
function withProbe(
  fn: (ctx: {
    dir: string;
    file: string;
    probe: CodexSessionProbe;
    events: MonitorEvent[];
    setNow: (ms: number) => void;
  }) => void,
  maxTurnMinutes = 30
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiwatchdog-codex-'));
  const file = path.join(dir, 'rollout-test.jsonl');
  let now = 1_000_000;
  const probe = new CodexSessionProbe(dir, maxTurnMinutes, () => now);
  const events: MonitorEvent[] = [];
  probe.onEvent((e) => events.push(e));
  try {
    fn({ dir, file, probe, events, setNow: (ms) => (now = ms) });
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CodexSessionProbe: turn 开始报 activity，结束报 done', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, eventLine('task_started', 't1'));
    probe.handleAdd(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity']
    );

    fs.appendFileSync(file, eventLine('task_complete', 't1'));
    probe.handleChange(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity', 'done']
    );
  });
});

test('CodexSessionProbe: 并发 turn 全部结束才报 done', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, eventLine('task_started', 't1') + eventLine('task_started', 't2'));
    probe.handleAdd(file);
    assert.equal(events.length, 1, '第二个 turn 开始不应重复报 activity');

    fs.appendFileSync(file, eventLine('task_complete', 't1'));
    probe.handleChange(file);
    assert.equal(events.length, 1, '仍有 turn 在跑，不应报 done');
    assert.ok(probe.isActive());

    fs.appendFileSync(file, eventLine('task_complete', 't2'));
    probe.handleChange(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity', 'done']
    );
    assert.ok(!probe.isActive());
  });
});

test('CodexSessionProbe: 中断报 idle 而非 done（用户已在键盘前）', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, eventLine('task_started', 't1'));
    probe.handleAdd(file);
    fs.appendFileSync(file, eventLine('turn_aborted', 't1', { reason: 'interrupted' }));
    probe.handleChange(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity', 'idle']
    );
  });
});

test('CodexSessionProbe: 未见过开始的 turn 结束时不推断状态', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, eventLine('task_complete', 'unknown-turn'));
    probe.handleAdd(file);
    assert.deepEqual(events, []);
  });
});

test('CodexSessionProbe: 已存在的大文件首次只对齐偏移，不重放历史', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, eventLine('task_started', 'old') + eventLine('task_complete', 'old'));
    // 未经 add，模拟探针启动前就存在的文件
    probe.handleChange(file);
    assert.deepEqual(events, [], '历史 turn 不应产生信号');

    fs.appendFileSync(file, eventLine('task_started', 'new'));
    probe.handleChange(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity']
    );
  });
});

test('CodexSessionProbe: 半截行留到下次补齐后才消费', () => {
  withProbe(({ file, probe, events }) => {
    fs.writeFileSync(file, '');
    probe.handleAdd(file);

    const line = eventLine('task_started', 't1');
    fs.appendFileSync(file, line.slice(0, 20));
    probe.handleChange(file);
    assert.deepEqual(events, [], '不完整行不应解析');

    fs.appendFileSync(file, line.slice(20));
    probe.handleChange(file);
    assert.deepEqual(
      events.map((e) => e.type),
      ['activity']
    );
  });
});

test('CodexSessionProbe: 卡死 turn 超时清理后报 idle', () => {
  withProbe(
    ({ file, probe, events, setNow }) => {
      fs.writeFileSync(file, eventLine('task_started', 't1'));
      probe.handleAdd(file);
      assert.ok(probe.isActive());

      setNow(1_000_000 + 31 * 60 * 1000);
      // 直接驱动清理逻辑，避免依赖 60s 定时器
      (probe as unknown as { pruneStaleTurns: () => void }).pruneStaleTurns();

      assert.ok(!probe.isActive());
      assert.deepEqual(
        events.map((e) => e.type),
        ['activity', 'idle']
      );
    },
    30
  );
});
