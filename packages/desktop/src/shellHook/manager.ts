import fs from 'node:fs';
import path from 'node:path';
import { SHELL_HOOK_BEGIN, SHELL_HOOK_END } from './shared';
import { ZSH_HOOK_SOURCE } from './zsh';
import { BASH_HOOK_SOURCE } from './bash';
import { FISH_HOOK_SOURCE } from './fish';

/** 依赖注入用的文件系统接口（便于测试用内存 mock） */
export interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: 'utf-8'): string;
  writeFileSync(p: string, data: string, enc: 'utf-8'): void;
  mkdirSync(p: string, opts: { recursive: true }): void;
}

const nodeFs: FsLike = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs),
};

/** 支持一键安装 hook 的 shell */
export type ShellKind = 'zsh' | 'bash' | 'fish';

export const SHELL_KINDS: readonly ShellKind[] = ['zsh', 'bash', 'fish'];

/** 各 shell 的 rc 文件与 hook 片段 */
const SHELL_SPECS: Record<ShellKind, { rc: (home: string) => string; source: string }> = {
  zsh: { rc: (home) => path.join(home, '.zshrc'), source: ZSH_HOOK_SOURCE },
  bash: { rc: (home) => path.join(home, '.bashrc'), source: BASH_HOOK_SOURCE },
  fish: {
    rc: (home) => path.join(home, '.config', 'fish', 'config.fish'),
    source: FISH_HOOK_SOURCE,
  },
};

/**
 * 当前平台值得展示的 shell。
 *
 * Windows 原生没有这三种 shell；只有 bash 可能经 Git Bash / WSL 存在，
 * 因此只留 bash，避免给出装了也没用的 zsh / fish 入口。
 */
export function shellsForPlatform(platform: string): readonly ShellKind[] {
  return platform === 'win32' ? ['bash'] : SHELL_KINDS;
}

/** 指定 shell 的 rc 文件路径 */
export function rcPathFor(kind: ShellKind, homedir: string): string {
  return SHELL_SPECS[kind].rc(homedir);
}

/** 指定 shell 的 hook 片段 */
export function hookSourceFor(kind: ShellKind): string {
  return SHELL_SPECS[kind].source;
}

/** 用标记包裹一段 shell 源，便于定位整段 */
export function wrapHook(source: string): string {
  return `${SHELL_HOOK_BEGIN}\n${source.trim()}\n${SHELL_HOOK_END}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shell Hook 安装管理器
 *
 * 负责把对应 shell 的片段一键写入其 rc 文件（幂等），并在需要时移除。
 */
export class ShellHookManager {
  constructor(private fslike: FsLike = nodeFs) {}

  /** 判断一段 rc 内容是否已包含 hook 标记 */
  isInstalled(content: string): boolean {
    return content.includes(SHELL_HOOK_BEGIN) && content.includes(SHELL_HOOK_END);
  }

  /** 判断 rc 文件是否已安装 hook */
  installed(rcPath: string): boolean {
    if (!this.fslike.existsSync(rcPath)) {
      return false;
    }
    return this.isInstalled(this.fslike.readFileSync(rcPath, 'utf-8'));
  }

  /** 安装 hook 到 rc 文件（幂等）；返回是否已安装以及本次是否发生变更 */
  install(rcPath: string, source: string): { installed: boolean; changed: boolean } {
    const content = this.fslike.existsSync(rcPath)
      ? this.fslike.readFileSync(rcPath, 'utf-8')
      : '';
    if (this.isInstalled(content)) {
      return { installed: true, changed: false };
    }
    // fish 的 ~/.config/fish 可能整个不存在
    this.fslike.mkdirSync(path.dirname(rcPath), { recursive: true });
    const block = wrapHook(source);
    const sep = content.trim() ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
    this.fslike.writeFileSync(rcPath, content + sep + block, 'utf-8');
    return { installed: true, changed: true };
  }

  /** 从 rc 文件移除 hook 段；返回是否发生移除 */
  uninstall(rcPath: string): { uninstalled: boolean } {
    if (!this.fslike.existsSync(rcPath)) {
      return { uninstalled: false };
    }
    const content = this.fslike.readFileSync(rcPath, 'utf-8');
    const re = new RegExp(
      `\\n?${escapeRegExp(SHELL_HOOK_BEGIN)}[\\s\\S]*?${escapeRegExp(SHELL_HOOK_END)}\\n?`
    );
    const next = content.replace(re, '');
    if (next === content) {
      return { uninstalled: false };
    }
    this.fslike.writeFileSync(rcPath, next, 'utf-8');
    return { uninstalled: true };
  }
}