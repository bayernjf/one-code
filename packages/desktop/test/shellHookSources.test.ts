import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SHELL_KINDS, hookSourceFor, rcPathFor } from '../src/shellHook/manager';
import { BASH_HOOK_SOURCE } from '../src/shellHook/bash';
import { FISH_HOOK_SOURCE } from '../src/shellHook/fish';
import { ZSH_HOOK_SOURCE } from '../src/shellHook/zsh';

function hasShell(bin: string): boolean {
  if (process.platform === 'win32') {
    return false;
  }
  return spawnSync('command', ['-v', bin], { shell: '/bin/sh' }).status === 0;
}

function writeTmp(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-hook-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

// ---------- 注册表 ----------

test('rcPathFor: 每种 shell 指向自己的 rc 文件', () => {
  assert.equal(rcPathFor('zsh', '/home/u'), path.join('/home/u', '.zshrc'));
  assert.equal(rcPathFor('bash', '/home/u'), path.join('/home/u', '.bashrc'));
  assert.equal(
    rcPathFor('fish', '/home/u'),
    path.join('/home/u', '.config', 'fish', 'config.fish')
  );
});

test('hookSourceFor: 三种 shell 的片段互不相同且非空', () => {
  const sources = SHELL_KINDS.map((k) => hookSourceFor(k));
  assert.equal(sources.length, 3);
  for (const s of sources) {
    assert.ok(s.trim().length > 0);
  }
  assert.equal(new Set(sources).size, 3);
});

test('各 shell 片段都写同一个状态文件路径', () => {
  for (const source of [ZSH_HOOK_SOURCE, BASH_HOOK_SOURCE, FISH_HOOK_SOURCE]) {
    assert.ok(source.includes('.ai-watchdog/terminal.json'));
    assert.ok(source.includes('AI_WATCHDOG_STATE_FILE'));
  }
});

// ---------- 真实 shell 校验 ----------

test('bash 片段语法合法', { skip: !hasShell('bash') }, () => {
  const file = writeTmp('hook.bash', BASH_HOOK_SOURCE);
  execFileSync('bash', ['-n', file]);
});

test('fish 片段语法合法', { skip: !hasShell('fish') }, () => {
  const file = writeTmp('hook.fish', FISH_HOOK_SOURCE);
  execFileSync('fish', ['-n', file]);
});

test('bash hook: AI CLI 写 active，结束写 done，非 AI 命令不动状态', {
  skip: !hasShell('bash'),
}, () => {
  const hook = writeTmp('hook.bash', BASH_HOOK_SOURCE);
  const stateFile = path.join(path.dirname(hook), 'terminal.json');
  // 关掉 DEBUG trap：这里直接调函数模拟提示符生命周期，
  // 否则 trap 会对脚本自己的每条命令再触发一次
  const script = [
    `source ${hook}`,
    'trap - DEBUG',
    '_ai_watchdog_preexec "claude --resume"',
    'cat "$_AI_WATCHDOG_STATE_FILE"',
    '_ai_watchdog_precmd',
    'cat "$_AI_WATCHDOG_STATE_FILE"',
    '_ai_watchdog_preexec "ls -la"',
    '_ai_watchdog_precmd',
    'cat "$_AI_WATCHDOG_STATE_FILE"',
    '_ai_watchdog_preexec "/usr/local/bin/codex exec"',
    'cat "$_AI_WATCHDOG_STATE_FILE"',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { ...process.env, AI_WATCHDOG_STATE_FILE: stateFile },
  });
  const states = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { active: boolean; tool: string });

  assert.deepEqual(
    states.map((s) => [s.active, s.tool]),
    [
      [true, 'claude'],
      [false, 'claude'],
      // 非 AI 命令走完一轮 preexec/precmd 后状态没被改写
      [false, 'claude'],
      // 绝对路径取 basename
      [true, 'codex'],
    ]
  );
});
