import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIStatus, MonitorSource } from '@ai-watchdog/core';
import { Aggregator } from '../src/aggregator';

/**
 * 默认关掉最短工作时长门槛。
 *
 * 这些用例测的是状态机与防抖，事件都是即刻连发的，留着 30 秒门槛只会把
 * 通知全部吃掉。门槛本身另有专门用例。
 */
function makeAggregator(minWorkSeconds = 0): Aggregator {
  const agg = new Aggregator();
  agg.setMinWorkDuration(minWorkSeconds);
  return agg;
}

test('Aggregator: activity 从 idle 进入 working', () => {
  const agg = makeAggregator();
  const statuses: AIStatus[] = [];
  agg.onStatusChange((s) => statuses.push(s));

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });

  assert.equal(agg.currentStatus, AIStatus.Working);
  assert.deepEqual(statuses, [AIStatus.Working]);
});

test('Aggregator: done 从 working 进入 done 并触发通知', () => {
  const agg = makeAggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });

  assert.equal(agg.currentStatus, AIStatus.Done);
  assert.deepEqual(notifies, ['done']);
});

test('Aggregator: done 防抖合并（1.5s 内多次只通知一次）', () => {
  const agg = makeAggregator();
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
  const agg = makeAggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.Cline, type: 'waiting' });

  assert.equal(agg.currentStatus, AIStatus.Waiting);
  assert.deepEqual(notifies, ['waiting']);
});

test('Aggregator: acknowledge 从 done 回到 idle', () => {
  const agg = makeAggregator();
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Done);

  agg.acknowledge();
  assert.equal(agg.currentStatus, AIStatus.Idle);
});

test('Aggregator: 非法转移不改变状态', () => {
  const agg = makeAggregator();
  // idle 状态下 done 是非法转移，computeNextStatus 返回 null
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Idle);
});

test('Aggregator: session 探针工作时，heuristic 的 done 被丢弃', () => {
  const agg = makeAggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(`${n.type}:${n.source}`));

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  // Codex 转入长时间推理，文件探针静默超时误报 done
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });

  assert.equal(agg.currentStatus, AIStatus.Working, '不应被推断性 done 提前推到 done');
  assert.deepEqual(notifies, [], '不应发出假通知');

  // Codex 真正完成
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });
  assert.equal(agg.currentStatus, AIStatus.Done);
  assert.deepEqual(notifies, [`done:${MonitorSource.Codex}`], '真通知必须送达');
});

test('Aggregator: session 探针结束后，heuristic 的 done 恢复生效', () => {
  const agg = makeAggregator();
  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });
  agg.acknowledge();

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Done);
});

test('Aggregator: session 探针中断（idle）也解除压制', () => {
  const agg = makeAggregator();
  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'idle', authority: 'session' });

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Done, 'session 探针已退出，不应再压制');
});

test('Aggregator: 多个 session 探针需全部结束才解除压制', () => {
  const agg = makeAggregator();
  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.ShellHook, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });
  agg.acknowledge();

  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Working, 'Shell Hook 仍在跑，仍应压制');
});

test('Aggregator: heuristic 的 waiting 不受压制（可能是另一个助手在等你）', () => {
  const agg = makeAggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'waiting' });

  assert.equal(agg.currentStatus, AIStatus.Waiting);
  assert.deepEqual(notifies, ['waiting']);
});

test('Aggregator: 短于最短工作时长的任务不通知，但状态照常流转', () => {
  const agg = makeAggregator(30);
  const notifies: string[] = [];
  const statuses: AIStatus[] = [];
  agg.onNotify((n) => notifies.push(n.type));
  agg.onStatusChange((s) => statuses.push(s));

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });

  assert.equal(agg.currentStatus, AIStatus.Done);
  assert.deepEqual(statuses, [AIStatus.Working, AIStatus.Done]);
  assert.deepEqual(notifies, []);
});

test('Aggregator: 超过最短工作时长则通知', () => {
  const agg = makeAggregator(30);
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  // 把该 session 的起点往前挪 31 秒，等价于任务跑了 31 秒
  const sessions = (agg as unknown as { sessions: Map<MonitorSource, { workingSince: Date }> }).sessions;
  sessions.get(MonitorSource.Codex)!.workingSince = new Date(Date.now() - 31_000);
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });

  assert.deepEqual(notifies, ['done']);
});

test('Aggregator: 没观察到起点时时长未知，照常通知', () => {
  const agg = makeAggregator(30);
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  // 探针刚重启，只收到 done：宁可通知也不要漏
  agg.handleEvent({ source: MonitorSource.ShellHook, type: 'activity', authority: 'session' });
  const sessions = (agg as unknown as { sessions: Map<MonitorSource, { workingSince: Date | undefined }> }).sessions;
  sessions.get(MonitorSource.ShellHook)!.workingSince = undefined;
  agg.handleEvent({ source: MonitorSource.ShellHook, type: 'done', authority: 'session' });

  assert.deepEqual(notifies, ['done']);
});

test('Aggregator: waiting 不受最短工作时长限制', () => {
  const agg = makeAggregator(30);
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(n.type));

  agg.handleEvent({ source: MonitorSource.Claude, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'waiting' });

  // 「卡住等你输入」无论多快发生都该通知：你被堵着
  assert.deepEqual(notifies, ['waiting']);
});

// ── 多会话专项 ──────────────────────────────────────────────

function hackSessions(agg: Aggregator) {
  return (agg as unknown as { sessions: Map<MonitorSource, { workingSince: Date | undefined; lastDoneAt: number }> }).sessions;
}

test('Aggregator: 并发 working，workingDuration 取最长者', () => {
  const agg = makeAggregator();
  const sessions = hackSessions(agg);

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  sessions.get(MonitorSource.Codex)!.workingSince = new Date(Date.now() - 60_000);
  agg.handleEvent({ source: MonitorSource.Claude, type: 'activity' });
  sessions.get(MonitorSource.Claude)!.workingSince = new Date(Date.now() - 10_000);

  assert.equal(agg.currentStatus, AIStatus.Working);
  assert.ok(agg.workingDuration >= 55_000, '应取最长的 60s session，实际 ' + agg.workingDuration);
});

test('Aggregator: 多会话独立防抖（不跨来源合并）', () => {
  const agg = makeAggregator();
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(`${n.type}:${n.source}`));

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });
  // 紧接着另一个来源完成，不应被前一个的防抖吃掉
  agg.handleEvent({ source: MonitorSource.Claude, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'done' });

  assert.deepEqual(notifies, [`done:${MonitorSource.Codex}`, `done:${MonitorSource.Claude}`]);
});

test('Aggregator: 多会话独立最短工作时长门槛', () => {
  const agg = makeAggregator(30);
  const notifies: string[] = [];
  agg.onNotify((n) => notifies.push(`${n.type}:${n.source}`));
  const sessions = hackSessions(agg);

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  sessions.get(MonitorSource.Codex)!.workingSince = new Date(Date.now() - 5_000); // 5秒 < 30秒
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });

  agg.handleEvent({ source: MonitorSource.Claude, type: 'activity' });
  sessions.get(MonitorSource.Claude)!.workingSince = new Date(Date.now() - 60_000); // 60秒 > 30秒
  agg.handleEvent({ source: MonitorSource.Claude, type: 'done' });

  assert.deepEqual(notifies, [`done:${MonitorSource.Claude}`], '只有超过门槛的 Claude 通知');
});

test('Aggregator: 全局聚合优先级 waiting > working > done', () => {
  const agg = makeAggregator();

  // Codex working + FileWatcher done → 全局 working
  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'done' });
  assert.equal(agg.currentStatus, AIStatus.Working, 'working 优先级高于 done');

  // FileWatcher 转入 waiting → 全局 waiting（需要用户操作最紧急）
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.FileWatcher, type: 'waiting' });
  assert.equal(agg.currentStatus, AIStatus.Waiting, 'waiting 优先级高于 working');
});

test('Aggregator: acknowledge 清除所有 done/waiting session', () => {
  const agg = makeAggregator();

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Codex, type: 'done', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'waiting' });

  assert.equal(agg.currentStatus, AIStatus.Waiting);
  assert.equal(agg.getActiveSessions().length, 2);

  agg.acknowledge();
  assert.equal(agg.currentStatus, AIStatus.Idle);
  assert.deepEqual(agg.getActiveSessions(), []);
});

test('Aggregator: getActiveSessions 返回非 idle 会话', () => {
  const agg = makeAggregator();

  agg.handleEvent({ source: MonitorSource.Codex, type: 'activity', authority: 'session' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'activity' });
  agg.handleEvent({ source: MonitorSource.Claude, type: 'done' });

  const active = agg.getActiveSessions();
  assert.equal(active.length, 2);
  const sources = active.map((s) => s.source).sort();
  assert.deepEqual(sources, [MonitorSource.Claude, MonitorSource.Codex]);
});
