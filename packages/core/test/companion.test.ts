import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseCompanionLine,
  serializeEventFrame,
  companionSocketPath,
  companionTokenPath,
  MonitorSource,
} from '../src';

test('parseCompanionLine: 合法 auth 帧', () => {
  const frame = parseCompanionLine('{"kind":"auth","token":"abc"}');
  assert.deepEqual(frame, { kind: 'auth', token: 'abc' });
});

test('parseCompanionLine: auth 帧缺 token 或空串视为非法', () => {
  assert.equal(parseCompanionLine('{"kind":"auth"}'), null);
  assert.equal(parseCompanionLine('{"kind":"auth","token":""}'), null);
});

test('parseCompanionLine: ping 帧', () => {
  assert.deepEqual(parseCompanionLine('{"kind":"ping"}'), { kind: 'ping' });
});

test('parseCompanionLine: 合法事件帧保留 files 与 message', () => {
  const frame = parseCompanionLine(
    '{"kind":"event","source":"vscode-companion","type":"activity","files":["/a.ts"],"message":"copilot streaming"}'
  );
  assert.deepEqual(frame, {
    kind: 'event',
    event: {
      source: MonitorSource.VSCodeCompanion,
      type: 'activity',
      files: ['/a.ts'],
      message: 'copilot streaming',
    },
  });
});

test('parseCompanionLine: 非白名单 source 被拒绝', () => {
  assert.equal(
    parseCompanionLine('{"kind":"event","source":"file-watcher","type":"activity"}'),
    null
  );
});

test('parseCompanionLine: 非法 type 被拒绝', () => {
  assert.equal(
    parseCompanionLine('{"kind":"event","source":"vscode-companion","type":"exploding"}'),
    null
  );
});

test('parseCompanionLine: 非法 JSON / 非对象 / 未知 kind 均返回 null', () => {
  assert.equal(parseCompanionLine('not json'), null);
  assert.equal(parseCompanionLine('42'), null);
  assert.equal(parseCompanionLine('null'), null);
  assert.equal(parseCompanionLine('{"kind":"whatever"}'), null);
});

test('parseCompanionLine: files 含非字符串时丢弃该字段而非整帧', () => {
  const frame = parseCompanionLine(
    '{"kind":"event","source":"vscode-companion","type":"done","files":[1,2]}'
  );
  assert.deepEqual(frame, {
    kind: 'event',
    event: { source: MonitorSource.VSCodeCompanion, type: 'done' },
  });
});

test('serializeEventFrame: 产出可被 parseCompanionLine 还原的单行', () => {
  const line = serializeEventFrame({
    source: MonitorSource.VSCodeCompanion,
    type: 'waiting',
    message: 'awaiting input',
  });
  assert.ok(line.endsWith('\n'));
  assert.equal(line.trimEnd().includes('\n'), false);
  assert.deepEqual(parseCompanionLine(line), {
    kind: 'event',
    event: {
      source: MonitorSource.VSCodeCompanion,
      type: 'waiting',
      message: 'awaiting input',
    },
  });
});

test('companion 路径：非 Windows 落在 ~/.ai-watchdog 下', () => {
  if (process.platform === 'win32') {
    assert.ok(companionSocketPath('/home/u').startsWith('\\\\.\\pipe\\'));
  } else {
    assert.equal(companionSocketPath('/home/u'), '/home/u/.ai-watchdog/companion.sock');
  }
  assert.equal(
    companionTokenPath('/home/u'),
    path.join('/home/u', '.ai-watchdog', 'companion-token')
  );
});
