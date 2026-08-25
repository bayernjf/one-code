import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyClaudeAppend,
  ClaudeSessionProbe,
  isClaudeQuestion,
  parseClaudeLine,
} from '../src/probes/claudeSessionProbe';

function assistantLine(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function userLine(text: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

function toolResultLine(): string {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
    },
  });
}

function systemLine(): string {
  return JSON.stringify({ type: 'system', subtype: 'init' });
}

// ---------- 纯函数 ----------

test('parseClaudeLine: 非法 JSON 返回 null', () => {
  assert.equal(parseClaudeLine('not-json'), null);
  assert.equal(parseClaudeLine(''), null);
});

test('parseClaudeLine: 合法 JSON 返回对象', () => {
  const entry = parseClaudeLine(assistantLine('hi'));
  assert.equal(entry?.type, 'assistant');
});

test('isClaudeQuestion: 以问号结尾为提问', () => {
  assert.equal(isClaudeQuestion('May I proceed?'), true);
  assert.equal(isClaudeQuestion('要继续吗？'), true);
});

test('isClaudeQuestion: 普通陈述不是提问', () => {
  assert.equal(isClaudeQuestion('Done fixing the bug'), false);
});

test('classifyClaudeAppend: assistant 正常输出 -> activity', () => {
  assert.equal(classifyClaudeAppend([assistantLine('Here is the fix')]), 'activity');
});

test('classifyClaudeAppend: assistant 提问 -> waiting', () => {
  assert.equal(classifyClaudeAppend([assistantLine('Should I run the tests now?')]), 'waiting');
});

test('classifyClaudeAppend: user 真实输入 -> activity', () => {
  assert.equal(classifyClaudeAppend([userLine('fix the bug please')]), 'activity');
});

test('classifyClaudeAppend: 仅 tool_result -> none（自动回填）', () => {
  assert.equal(classifyClaudeAppend([toolResultLine()]), 'none');
});

test('classifyClaudeAppend: 仅 system 行 -> none', () => {
  assert.equal(classifyClaudeAppend([systemLine()]), 'none');
});

test('classifyClaudeAppend: 取最后一条信号', () => {
  // user 输入后跟 assistant 提问，最新为 waiting
  const lines = [userLine('run it'), assistantLine('Shall I continue?')];
  assert.equal(classifyClaudeAppend(lines), 'waiting');
});

// ---------- 探针集成 ----------

function tmpProjectsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-claude-'));
}

function writeSession(dir: string, name: string, content: string): string {
  const file = path.join(dir, name + '.jsonl');
  fs.appendFileSync(file, content);
  return file;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询等待条件成立，超时抛错（慢速 CI runner 上比固定 sleep 可靠） */
async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      assert.fail(`timeout waiting for ${label}`);
    }
    await sleep(25);
  }
}

test('ClaudeSessionProbe: 新会话 add -> activity，静默超时 -> done', async () => {
  const dir = tmpProjectsDir();
  const probe = new ClaudeSessionProbe(dir, 0.2);
  const events: Array<{ type: string; message?: string }> = [];
  probe.onEvent((e) => events.push(e));

  // try/finally：断言失败也必须关掉 watcher，否则进程因事件循环挂起不退出
  try {
    probe.start();

    // 不断建新会话文件直到 activity 出现。固定 sleep 等 chokidar 就绪在负载下不够，
    // 初始扫描没结束时建的文件会被 ignoreInitial 当成既存文件吞掉。
    // 等事件而不是等 probe.isActive()：后者是瞬态，静默超时一到就被清掉。
    let seq = 0;
    await waitFor(
      () => {
        if (!events.some((e) => e.type === 'activity')) {
          writeSession(dir, `s${seq++}`, assistantLine('Starting work') + '\n');
        }
        return events.some((e) => e.type === 'activity');
      },
      5000,
      'activity after session start'
    );

    // 静默超时 -> done
    await waitFor(() => events.some((e) => e.type === 'done'), 3000, 'done after silence timeout');
    assert.equal(probe.isActive(), false);
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ClaudeSessionProbe: 启动前已存在的会话不重放历史，仅报 activity', async () => {
  const dir = tmpProjectsDir();
  // 历史里埋一条提问：若被重放会误判 waiting
  const file = writeSession(dir, 's3', assistantLine('Should I proceed?') + '\n');
  const probe = new ClaudeSessionProbe(dir, 1);
  const events: Array<{ type: string; message?: string }> = [];
  probe.onEvent((e) => events.push(e));

  try {
    probe.start();
    await sleep(200);

    fs.appendFileSync(file, assistantLine('Still working') + '\n');
    await waitFor(
      () => events.some((e) => e.type === 'activity'),
      3000,
      'activity on first change'
    );

    assert.equal(events.some((e) => e.type === 'waiting'), false);
    assert.equal(events.filter((e) => e.type === 'activity').length, 1);
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ClaudeSessionProbe: 追加 assistant 提问 -> waiting', async () => {
  const dir = tmpProjectsDir();
  const probe = new ClaudeSessionProbe(dir, 1);
  const events: Array<{ type: string; message?: string }> = [];
  probe.onEvent((e) => events.push(e));

  try {
    probe.start();
    await sleep(200);

    const file = writeSession(dir, 's2', assistantLine('Working...') + '\n');
    await waitFor(
      () => events.some((e) => e.type === 'activity'),
      3000,
      'activity after session start'
    );

    // 追加提问行
    fs.appendFileSync(file, assistantLine('Should I proceed?') + '\n');
    await waitFor(
      () => events.some((e) => e.type === 'waiting'),
      3000,
      'waiting after question'
    );
    assert.equal(probe.isActive(), false);
  } finally {
    probe.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
