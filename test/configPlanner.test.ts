/**
 * 评审 P2-3 回归：配置变更必须 diff 出重建动作——
 * 此前 onConfigChange 只处理 companion.enabled 与 enabled，
 * 改 watchPatterns / ignorePatterns / monitors.* / companion.socketPath
 * 后运行中的扩展不重建，必须 reload window 才生效（静默不生效）。
 *
 * 本测试钉死纯函数 planConfigChange 的完整判定矩阵；
 * extension.ts 的配置回调只是该计划的执行器。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planConfigChange } from '../src/configPlanner';
import type { WatchdogConfig } from '../src/config';

function base(overrides: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    enabled: true,
    silenceTimeout: 8,
    activityThreshold: 3,
    windowSize: 3,
    sound: { enabled: true, volume: 0.7 },
    desktopNotify: { enabled: true },
    watchPatterns: ['**/*.ts'],
    ignorePatterns: ['**/node_modules/**'],
    monitors: { copilot: true, cline: true, terminal: true },
    companion: { enabled: true, socketPath: '' },
    ...overrides,
  };
}

test('无变化 → 不产生任何动作', () => {
  const plan = planConfigChange(base(), base());
  assert.deepEqual(plan, {
    enabledToggled: false,
    startCompanion: false,
    stopCompanion: false,
    reconnectCompanion: false,
    restartMonitors: false,
  });
});

test('watchPatterns 变化 → restartMonitors', () => {
  const plan = planConfigChange(base(), base({ watchPatterns: ['**/*.py'] }));
  assert.equal(plan.restartMonitors, true);
});

test('ignorePatterns 变化 → restartMonitors', () => {
  const plan = planConfigChange(base(), base({ ignorePatterns: ['**/dist/**'] }));
  assert.equal(plan.restartMonitors, true);
});

test('monitors.* 开关翻转 → restartMonitors', () => {
  const prev = base();
  const next = base({ monitors: { copilot: false, cline: true, terminal: true } });
  assert.equal(planConfigChange(prev, next).restartMonitors, true);
});

test('windowSize / activityThreshold / silenceTimeout 变化 → restartMonitors', () => {
  assert.equal(planConfigChange(base(), base({ windowSize: 5 })).restartMonitors, true);
  assert.equal(planConfigChange(base(), base({ activityThreshold: 10 })).restartMonitors, true);
  assert.equal(planConfigChange(base(), base({ silenceTimeout: 20 })).restartMonitors, true);
});

test('companion.socketPath 变化（保持启用）→ reconnectCompanion', () => {
  const prev = base();
  const next = base({ companion: { enabled: true, socketPath: '/tmp/other.sock' } });
  const plan = planConfigChange(prev, next);
  assert.equal(plan.reconnectCompanion, true);
  assert.equal(plan.startCompanion, false);
  assert.equal(plan.stopCompanion, false);
});

test('companion.enabled 开关翻转 → start/stopCompanion', () => {
  const offToOn = planConfigChange(
    base({ companion: { enabled: false, socketPath: '' } }),
    base(),
  );
  assert.equal(offToOn.startCompanion, true);
  assert.equal(offToOn.stopCompanion, false);

  const onToOff = planConfigChange(base(), base({ companion: { enabled: false, socketPath: '' } }));
  assert.equal(onToOff.stopCompanion, true);
  assert.equal(onToOff.startCompanion, false);
  // 停用不需要重连
  assert.equal(onToOff.reconnectCompanion, false);
});

test('enabled 翻转 → enabledToggled；仅声音开关变化不重建监控', () => {
  assert.equal(planConfigChange(base(), base({ enabled: false })).enabledToggled, true);
  const soundOnly = planConfigChange(base(), base({ sound: { enabled: false, volume: 0.7 } }));
  assert.equal(soundOnly.restartMonitors, false);
  assert.equal(soundOnly.enabledToggled, false);
});
