import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorSource, getSourceName } from '../src';

test('getSourceName: 每个 MonitorSource 都有非空展示名', () => {
  for (const source of Object.values(MonitorSource)) {
    const name = getSourceName(source);
    assert.equal(typeof name, 'string', `${source} 缺少展示名`);
    assert.ok(name.length > 0, `${source} 展示名为空`);
  }
});

test('getSourceName: 展示名互不重复（通知里要能区分来源）', () => {
  const names = Object.values(MonitorSource).map(getSourceName);
  assert.equal(new Set(names).size, names.length);
});
