/**
 * fish Shell Hook
 *
 * fish 自带 `fish_preexec` / `fish_postexec` 事件，语义与 zsh 版一一对应，
 * 写入完全相同的状态文件。
 */

import { SHELL_TOOLS } from './shared';

/** fish 的 switch 分支用空格分隔多个模式 */
const FISH_TOOLS_CASE = SHELL_TOOLS.join(' ');

/** 可写入 ~/.config/fish/config.fish 的 fish 片段 */
export const FISH_HOOK_SOURCE = [
  '# AI Watchdog Shell Hook: 精确终端 AI CLI 监控',
  '# 通过 fish_preexec / fish_postexec 捕获 claude / codex / opencode 等命令，',
  '# 在开始 / 结束时写状态文件（默认 ~/.ai-watchdog/terminal.json），供桌面应用消费。',
  'if not set -q AI_WATCHDOG_STATE_FILE',
  '    set -g AI_WATCHDOG_STATE_FILE "$HOME/.ai-watchdog/terminal.json"',
  'end',
  '',
  '# 先写 .tmp 再 mv，读侧不会看到半个 JSON',
  'function _ai_watchdog_write --argument-names active tool pid',
  '    mkdir -p (dirname $AI_WATCHDOG_STATE_FILE)',
  '    printf \'{"active":%s,"tool":"%s","pid":%d,"updatedAt":%s}\\n\' \\',
  '        $active $tool $pid (date +%s) > "$AI_WATCHDOG_STATE_FILE.tmp"',
  '    mv "$AI_WATCHDOG_STATE_FILE.tmp" "$AI_WATCHDOG_STATE_FILE"',
  'end',
  '',
  '# 命中已知 AI CLI 则输出命令名，否则什么都不输出（调用方判空，不依赖 $status）',
  'function _ai_watchdog_tool_name --argument-names line',
  '    set -l parts (string split -m1 " " -- $line)',
  '    set -l first $parts[1]',
  '    test -z "$first"; and return',
  '    switch (basename $first)',
  `        case ${FISH_TOOLS_CASE}`,
  '            echo (basename $first)',
  '    end',
  'end',
  '',
  'function _ai_watchdog_preexec --on-event fish_preexec',
  '    set -l tool (_ai_watchdog_tool_name $argv[1])',
  '    test -n "$tool"; or return',
  '    set -g _ai_watchdog_current $tool',
  '    _ai_watchdog_write true $tool $fish_pid',
  'end',
  '',
  'function _ai_watchdog_postexec --on-event fish_postexec',
  '    set -q _ai_watchdog_current; or return',
  '    _ai_watchdog_write false $_ai_watchdog_current 0',
  '    set -e _ai_watchdog_current',
  'end',
  '',
].join('\n');
