import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShellHookManager, wrapHook } from '../src/shellHook/manager';
import { SHELL_HOOK_BEGIN, SHELL_HOOK_END } from '../src/shellHook/shared';

/** 内存 mock 文件系统 */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    existsSync(p: string): boolean {
      return files.has(p);
    },
    readFileSync(p: string, _enc: 'utf-8'): string {
      return files.get(p) ?? '';
    },
    writeFileSync(p: string, data: string, _enc: 'utf-8'): void {
      files.set(p, data);
    },
    mkdirSync(_p: string, _opts: { recursive: true }): void {
      // 内存 mock 无目录概念
    },
  };
}

test('install: 首次安装写入带标记的片段', () => {
  const f = memoryFs();
  const m = new ShellHookManager(f);
  const res = f.files;
  const out = m.install('/tmp/.zshrc', 'echo hi');
  assert.equal(out.installed, true);
  assert.equal(out.changed, true);
  const content = res.get('/tmp/.zshrc') ?? '';
  assert.ok(content.includes(SHELL_HOOK_BEGIN));
  assert.ok(content.includes(SHELL_HOOK_END));
  assert.ok(content.includes('echo hi'));
});

test('install: 幂等，重复安装不重复追加', () => {
  const f = memoryFs({ '/tmp/.zshrc': 'export FOO=1\n' });
  const m = new ShellHookManager(f);
  m.install('/tmp/.zshrc', 'echo hi');
  const first = f.files.get('/tmp/.zshrc') ?? '';
  const second = m.install('/tmp/.zshrc', 'echo hi');
  assert.equal(second.changed, false);
  assert.equal(f.files.get('/tmp/.zshrc'), first);
});

test('install: 已存在 hook 时 installed 判定为 true 且不重复', () => {
  const f = memoryFs({ '/tmp/.zshrc': wrapHook('echox') });
  const m = new ShellHookManager(f);
  assert.equal(m.installed('/tmp/.zshrc'), true);
  const res = m.install('/tmp/.zshrc', 'echo hi');
  assert.equal(res.changed, false);
});

test('uninstall: 移除整段 hook，保留其余内容', () => {
  const f = memoryFs({ '/tmp/.zshrc': `export FOO=1\n${wrapHook('echox')}alias bar=2\n` });
  const m = new ShellHookManager(f);
  const out = m.uninstall('/tmp/.zshrc');
  assert.equal(out.uninstalled, true);
  const content = f.files.get('/tmp/.zshrc') ?? '';
  assert.ok(!content.includes(SHELL_HOOK_BEGIN));
  assert.ok(content.includes('export FOO=1'));
  assert.ok(content.includes('alias bar=2'));
});

test('install/uninstall: 暂存在时不误报存在，卸载不存在的返回 false', () => {
  const f = memoryFs();
  const m = new ShellHookManager(f);
  assert.equal(m.installed('/tmp/.zshrc'), false);
  assert.equal(m.uninstall('/tmp/.zshrc').uninstalled, false);
});