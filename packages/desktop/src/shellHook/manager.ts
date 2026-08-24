import fs from 'node:fs';
import path from 'node:path';
import { SHELL_HOOK_BEGIN, SHELL_HOOK_END, ZSH_HOOK_SOURCE } from './zsh';

/** 依赖注入用的文件系统接口（便于测试用内存 mock） */
export interface FsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: 'utf-8'): string;
  writeFileSync(p: string, data: string, enc: 'utf-8'): void;
}

const nodeFs: FsLike = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
};

/** 用标记包裹一段 zsh 源，便于定位整段 */
export function wrapHook(source: string): string {
  return `${SHELL_HOOK_BEGIN}\n${source.trim()}\n${SHELL_HOOK_END}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 默认 zsh 配置路径 */
export function zshrcPath(homedir: string): string {
  return path.join(homedir, '.zshrc');
}

/**
 * Shell Hook 安装管理器
 *
 * 负责把 zsh 片段一键写入 ~/.zshrc（幂等），并在需要时移除。
 */
export class ShellHookManager {
  constructor(private fslike: FsLike = nodeFs) {}

  /** 判断一段 zshrc 内容是否已包含 hook 标记 */
  isInstalled(content: string): boolean {
    return content.includes(SHELL_HOOK_BEGIN) && content.includes(SHELL_HOOK_END);
  }

  /** 判断 zshrc 文件是否已安装 hook */
  installed(rcPath: string): boolean {
    if (!this.fslike.existsSync(rcPath)) {
      return false;
    }
    return this.isInstalled(this.fslike.readFileSync(rcPath, 'utf-8'));
  }

  /** 安装 hook 到 zshrc（幂等）；返回是否已安装以及本次是否发生变更 */
  install(
    rcPath: string,
    source: string = ZSH_HOOK_SOURCE
  ): { installed: boolean; changed: boolean } {
    const content = this.fslike.existsSync(rcPath)
      ? this.fslike.readFileSync(rcPath, 'utf-8')
      : '';
    if (this.isInstalled(content)) {
      return { installed: true, changed: false };
    }
    const block = wrapHook(source);
    const sep = content.trim() ? (content.endsWith('\n') ? '\n' : '\n\n') : '';
    this.fslike.writeFileSync(rcPath, content + sep + block, 'utf-8');
    return { installed: true, changed: true };
  }

  /** 从 zshrc 移除 hook 段；返回是否发生移除 */
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