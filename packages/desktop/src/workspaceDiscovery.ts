import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 工作区目录自动发现
 *
 * 扫描常见代码目录下一层子目录，按最近修改时间排序，
 * 返回「最近活跃」的目录作为文件探针的监听目标。
 *
 * 策略（阶段 1b MVP）：
 * - 扫描根：可配置，默认包含用户常见代码根目录
 * - 识别「代码目录」：含 .git 或 package.json / Cargo.toml / go.mod 等标志
 * - 按目录 mtime 降序，取最近 N 个
 */
const DEFAULT_SCAN_ROOTS = [
  '~/000mycodes',
  '~/WebstormProjects',
  '~/Projects',
  '~/projects',
  '~/Documents',
  '~/Desktop',
];

/** 判定一个目录是否为代码工作区 */
const CODE_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pom.xml', 'requirements.txt', 'pyproject.toml'];

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function isCodeWorkspace(dir: string): boolean {
  return CODE_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
}

function mtimeOf(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 发现最近活跃的代码工作区目录
 * @param limit 返回的最大目录数
 * @param scanRoots 自定义扫描根（默认用 DEFAULT_SCAN_ROOTS）
 */
export function discoverWorkspaces(limit = 10, scanRoots: string[] = DEFAULT_SCAN_ROOTS): string[] {
  const candidates: { dir: string; mtime: number }[] = [];

  for (const root of scanRoots) {
    const abs = expandHome(root);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(abs);
    } catch {
      continue; // 根目录不存在，跳过
    }

    for (const name of entries) {
      const dir = path.join(abs, name);
      let stat;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) {
        continue;
      }
      if (isCodeWorkspace(dir)) {
        candidates.push({ dir, mtime: mtimeOf(dir) });
      }
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates.slice(0, limit).map((c) => c.dir);
}
