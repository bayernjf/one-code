import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShellState } from '../src/probes/shellHookProbe';

test('evaluateShellState: 从无会话到 active 触发 activity', () => {
  assert.equal(evaluateShellState(false, { active: true, tool: 'claude' }), 'activity');
});

test('evaluateShellState: 从 active 到 inactive 触发 done', () => {
  assert.equal(evaluateShellState(true, { active: false, tool: 'claude' }), 'done');
});

test('evaluateShellState: 活跃态不变时不转移', () => {
  assert.equal(evaluateShellState(true, { active: true, tool: 'codex' }), null);
});

test('evaluateShellState: 无会话态不变时不转移', () => {
  assert.equal(evaluateShellState(false, { active: false }), null);
});

test('evaluateShellState: 文件不存在/解析失败（null）不触发 done', () => {
  // 启动时文件不存在不应误报 done
  assert.equal(evaluateShellState(false, null), null);
});