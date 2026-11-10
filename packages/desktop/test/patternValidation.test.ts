import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultConfig } from '../src/config';
import {
  MAX_PATTERN_LENGTH,
  collectPatternIssues,
  saveConfigWithValidation,
  validateConfigForSave,
  validatePattern,
} from '../src/patternValidation';

/**
 * 写入侧校验（2026-11-02 评审 P1-1）：非法 processPatterns 保存即拒绝且
 * 不落盘。saveConfigWithValidation 就是 settings:save IPC 实际调用的函数，
 * 这里用内存 persist/onChange 代替 ConfigStore，不需要 Electron 环境。
 */

function configWithPatterns(patterns: string[]) {
  const config = getDefaultConfig();
  config.targets.push({
    id: 'custom-1',
    name: 'My Tool',
    watchDirs: [],
    processPatterns: patterns,
    enabled: true,
    notifyEnabled: true,
  });
  return config;
}

test('validatePattern: 合法模式返回 null', () => {
  assert.equal(validatePattern('Cursor'), null);
  assert.equal(validatePattern('^Code( Helper)?$'), null);
  assert.equal(validatePattern('gemini|qwen'), null);
});

test('validatePattern: 语法错误返回可读原因', () => {
  assert.match(validatePattern('[')!, /Invalid regular expression/);
  assert.match(validatePattern('(?<broken')!, /Invalid regular expression/);
  assert.match(validatePattern('a{2,1}')!, /Invalid regular expression|numbers out of order/);
});

test('validatePattern: 空模式与超长模式被拒绝', () => {
  assert.equal(validatePattern(''), '模式为空');
  assert.equal(validatePattern('   '), '模式为空');
  assert.match(validatePattern('x'.repeat(MAX_PATTERN_LENGTH + 1))!, /超过 200 字符上限/);
  // 边界：恰好达到上限仍合法
  assert.equal(validatePattern('x'.repeat(MAX_PATTERN_LENGTH)), null);
});

test('collectPatternIssues: 汇总全部目标的全部非法模式，不短路', () => {
  const config = configWithPatterns(['ok', '[', '(?<bad']);
  const issues = collectPatternIssues(config);
  assert.equal(issues.length, 2);
  assert.deepEqual(
    issues.map((i) => i.pattern),
    ['[', '(?<bad']
  );
  assert.ok(issues.every((i) => i.targetName === 'My Tool' && i.reason.length > 0));
});

test('settings:save 非法配置被拒绝：不落盘、不触发探针重建，错误可读', () => {
  let persisted = false;
  let rebuilt = false;
  const result = saveConfigWithValidation(
    configWithPatterns(['[']),
    () => {
      persisted = true;
    },
    () => {
      rebuilt = true;
    }
  );
  assert.equal(result.ok, false);
  assert.equal(persisted, false, '脏配置绝不能落盘——落盘即形成重启崩溃循环');
  assert.equal(rebuilt, false, '被拒绝的配置不得触发探针重建');
  if (!result.ok) {
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('My Tool'), '错误要指出是哪个目标');
    assert.ok(result.errors[0].includes('['), '错误要指出是哪条模式');
  }
});

test('settings:save 合法配置正常落盘并触发重建', () => {
  const saved: unknown[] = [];
  const changed: unknown[] = [];
  const result = saveConfigWithValidation(
    configWithPatterns(['gemini']),
    (config) => saved.push(config),
    (config) => changed.push(config)
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(saved.length, 1);
  assert.equal(changed.length, 1);
});

test('validateConfigForSave: 默认配置与空模式列表都合法', () => {
  assert.deepEqual(validateConfigForSave(getDefaultConfig()), { ok: true });
  assert.deepEqual(validateConfigForSave(configWithPatterns([])), { ok: true });
});
