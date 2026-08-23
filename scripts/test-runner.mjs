#!/usr/bin/env node
/**
 * 跨平台测试运行器：展开 test 目录下的 .test.ts 文件，
 * 交给 Node 内置 test runner（配合 tsx loader）执行。
 *
 * 解决 Windows cmd.exe 不展开 shell glob（test/*.test.ts）的问题，
 * 不依赖 Node 22 的 glob 支持，Node 20 即可运行。
 *
 * 用法：node scripts/test-runner.mjs <testDir>
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const testDir = process.argv[2] ?? 'test';
const absDir = resolve(process.cwd(), testDir);

function collect(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...collect(full));
    } else if (name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

const testFiles = collect(absDir);
if (testFiles.length === 0) {
  console.error(`No .test.ts files found under ${absDir}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
