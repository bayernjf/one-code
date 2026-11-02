import { DesktopConfig } from './config';

/**
 * 进程模式（processPatterns）校验 —— 2026-11-02 评审 P1-1。
 *
 * 用户在设置页自定义的 processPatterns 会进入 `new RegExp(pattern, 'i')`；
 * 非法正则曾让 Electron 主进程在轮询回调里抛 SyntaxError 并因配置已落盘
 * 形成重启崩溃循环。本模块是纯函数（不依赖 Electron），供三处共用：
 *   1. settings:save 写入侧：非法即拒绝，不落盘；
 *   2. ProcessProbe 读取侧：逐条编译，非法隔离（跳过并记录）；
 *   3. 设置页自愈：标出被跳过的模式，让用户能改回。
 */

/**
 * 单条模式的最大长度。进程名（macOS comm、Windows 镜像名）都很短，200 字符
 * 远超合理需求；上限挡住的是粘贴事故与 ReDoS 类超长模式的构造空间。
 * 注意：JS RegExp 没有执行超时，真正的 ReDoS（嵌套量词）无法在库里拦停；
 * 取舍是：输入源是本地用户本人（无远程触发面）、匹配对象是短进程名行、
 * 轮询间隔 3 秒，最坏情况是单次 tick 变慢而非进程卡死，因此只限长度。
 */
export const MAX_PATTERN_LENGTH = 200;

/** 校验单条模式；返回 null 表示合法，否则返回可读的原因。 */
export function validatePattern(pattern: string): string | null {
  if (!pattern.trim()) {
    return '模式为空';
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `模式超过 ${MAX_PATTERN_LENGTH} 字符上限`;
  }
  try {
    new RegExp(pattern, 'i');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface PatternIssue {
  targetId: string;
  targetName: string;
  pattern: string;
  reason: string;
}

/** 汇总配置里所有非法模式（逐条编译，不短路，让用户一次看到全部问题）。 */
export function collectPatternIssues(config: DesktopConfig): PatternIssue[] {
  const issues: PatternIssue[] = [];
  for (const target of config.targets) {
    for (const pattern of target.processPatterns) {
      const reason = validatePattern(pattern);
      if (reason) {
        issues.push({ targetId: target.id, targetName: target.name, pattern, reason });
      }
    }
  }
  return issues;
}

export type SaveValidation = { ok: true } | { ok: false; errors: string[] };

/**
 * settings:save 的写入闸门：存在非法模式时返回可读错误列表，调用方必须
 * 拒绝落盘（2026-11-02 评审 P1-1，写入侧校验）。
 */
export function validateConfigForSave(config: DesktopConfig): SaveValidation {
  const issues = collectPatternIssues(config);
  if (issues.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: issues.map((issue) => `「${issue.targetName}」的进程模式 "${issue.pattern}" 无效：${issue.reason}`),
  };
}

/**
 * settings:save 的处理逻辑（与 IPC 解耦，便于 Node 层测试）：非法配置既不
 * 落盘也不触发变更回调；合法配置先落盘再通知探针重建。
 */
export function saveConfigWithValidation(
  config: DesktopConfig,
  persist: (config: DesktopConfig) => void,
  onChange: (config: DesktopConfig) => void
): SaveValidation {
  const validation = validateConfigForSave(config);
  if (!validation.ok) {
    return validation;
  }
  persist(config);
  onChange(config);
  return { ok: true };
}
