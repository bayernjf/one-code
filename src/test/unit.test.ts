import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RapidEditDetector } from '../monitors/editWindow';
import { shouldIgnorePath } from '../util/paths';
import { computeNextStatus } from '../state/transitions';
import { formatDuration } from '../util/format';
import { AIStatus } from '../monitors/types';

test('RapidEditDetector: 窗口内达到阈值判定为工作中', () => {
  const detector = new RapidEditDetector(3000, 3);
  assert.equal(detector.record(1000), false);
  assert.equal(detector.record(1500), false);
  assert.equal(detector.record(2000), true); // 第 3 次，达到阈值
  assert.equal(detector.count, 3);
});

test('RapidEditDetector: 窗口外的旧时间戳被清理', () => {
  const detector = new RapidEditDetector(3000, 3);
  detector.record(0);
  detector.record(1000);
  detector.record(2000);
  assert.equal(detector.count, 3);
  // 时间推进到 6000，前三次都已超出 3000ms 窗口
  assert.equal(detector.record(6000), false);
  assert.equal(detector.count, 1);
});

test('RapidEditDetector: reset 清空记录', () => {
  const detector = new RapidEditDetector(3000, 2);
  detector.record(0);
  detector.record(500);
  assert.equal(detector.count, 2);
  detector.reset();
  assert.equal(detector.count, 0);
});

test('shouldIgnorePath: 匹配忽略模式', () => {
  const patterns = ['**/node_modules/**', '**/.git/**'];
  assert.equal(shouldIgnorePath('/proj/node_modules/foo/index.js', patterns), true);
  assert.equal(shouldIgnorePath('/proj/.git/config', patterns), true);
  assert.equal(shouldIgnorePath('/proj/src/index.ts', patterns), false);
});

test('shouldIgnorePath: 空模式不忽略任何路径', () => {
  assert.equal(shouldIgnorePath('/any/path.ts', []), false);
});

test('computeNextStatus: activity 仅在非 Working 时转移', () => {
  assert.equal(computeNextStatus(AIStatus.Idle, 'activity'), AIStatus.Working);
  assert.equal(computeNextStatus(AIStatus.Waiting, 'activity'), AIStatus.Working);
  assert.equal(computeNextStatus(AIStatus.Working, 'activity'), null);
});

test('computeNextStatus: done 仅从 Working 转移', () => {
  assert.equal(computeNextStatus(AIStatus.Working, 'done'), AIStatus.Done);
  assert.equal(computeNextStatus(AIStatus.Idle, 'done'), null);
  assert.equal(computeNextStatus(AIStatus.Waiting, 'done'), null);
});

test('computeNextStatus: waiting 从 Working/Idle 转移', () => {
  assert.equal(computeNextStatus(AIStatus.Working, 'waiting'), AIStatus.Waiting);
  assert.equal(computeNextStatus(AIStatus.Idle, 'waiting'), AIStatus.Waiting);
  assert.equal(computeNextStatus(AIStatus.Done, 'waiting'), null);
});

test('computeNextStatus: idle 从非 Idle 转移', () => {
  assert.equal(computeNextStatus(AIStatus.Done, 'idle'), AIStatus.Idle);
  assert.equal(computeNextStatus(AIStatus.Working, 'idle'), AIStatus.Idle);
  assert.equal(computeNextStatus(AIStatus.Idle, 'idle'), null);
});

test('formatDuration: 正确格式化秒/分/时', () => {
  assert.equal(formatDuration(5_000), '5s');
  assert.equal(formatDuration(65_000), '1m 5s');
  assert.equal(formatDuration(3_700_000), '1h 1m');
});
