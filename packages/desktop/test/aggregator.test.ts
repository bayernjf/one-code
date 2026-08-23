import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIStatus, MonitorSource } from '@ai-watchdog/core';
import { Aggregator } from '../src/aggregator';

test('Aggregator: activity 从 idle 进入 working', () => {
  const agg = new Aggregator();
  const statuses: AIStatus[] = [];
  agg.onStatusChange((s) => statuses.push(s));

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });

  assert.equal(agg.currentStatus, AIStatus.Working);
  assert.deepEqual(statuses, [AIStatus.Working]);
});

test('Aggregator: done 从 working 进入 done 并触发通知', () => {
  const agg = new Aggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });

  assert.equal(agg.currentStatus, AIStatus.Done);
  assert.deepEqual(notifies, ['done']);
});

test('Aggregator: done 防抖合并（1.5s 内多次只通知一次）', () => {
  const agg = new Aggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  // 第一次 done 触发通知
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  // 紧接着的 done 被防抖（此时状态已是 Done，computeNextStatus 返回 null，本就不会再进）
  agg.handleEvent({ source: MonitorSource.Cline, type: 'done' });

  assert.equal(agg.currentStatus, AIStatus.Done);
  assert.deepEqual(notifies, ['done']);
});

test('Aggregator: waiting 触发通知', () => {
  const agg = new Aggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.Cline, type: 'waiting' });

  assert.equal(agg.currentStatus, AIStatus.Waiting);
  assert.deepEqual(notifies, ['waiting']);
});

test('Aggregator: acknowledge 从 done 回到 idle', () => {
  const agg = new Aggregator();
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Done);

  agg.acknowledge();
  assert.equal(agg.currentStatus, AIStatus.Idle);
});

test('Aggregator: 非法转移不改变状态', () => {
  const agg = new Aggregator();
  // idle 状态下 done 是非法转移，computeNextStatus 返回 null
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Idle);
});
