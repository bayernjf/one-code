/**
 * bash Shell Hook
 *
 * bash 没有 zsh 的 preexec/precmd，用 `DEBUG` trap 顶替 preexec、
 * `PROMPT_COMMAND` 顶替 precmd，写入与 zsh 版完全相同的状态文件。
 */

import { SHELL_TOOLS_PATTERN } from './shared';

/**
 * 可写入 ~/.bashrc 的 bash 片段。
 * 用行数组拼接，避免模板字符串对 `$` / `${}` 的转义问题。
 */
export const BASH_HOOK_SOURCE = [
  '# AI Watchdog Shell Hook: 精确终端 AI CLI 监控',
  '# DEBUG trap 顶替 preexec，PROMPT_COMMAND 顶替 precmd，',
  '# 在开始 / 结束时写状态文件（默认 ~/.ai-watchdog/terminal.json），供桌面应用消费。',
  '_AI_WATCHDOG_STATE_FILE="${AI_WATCHDOG_STATE_FILE:-$HOME/.ai-watchdog/terminal.json}"',
  '',
  '# $1=active(true/false) $2=tool $3=pid；先写 .tmp 再 mv，读侧不会看到半个 JSON',
  '_ai_watchdog_write() {',
  '  mkdir -p "$(dirname "$_AI_WATCHDOG_STATE_FILE")"',
  '  printf \'{"active":%s,"tool":"%s","pid":%d,"updatedAt":%s}\\n\' \\',
  '    "$1" "$2" "$3" "$(date +%s)" > "${_AI_WATCHDOG_STATE_FILE}.tmp"',
  '  mv "${_AI_WATCHDOG_STATE_FILE}.tmp" "$_AI_WATCHDOG_STATE_FILE"',
  '}',
  '',
  '# 判断 "$1"（一条命令行）的首个命令是否为已知 AI CLI，命中则输出命令名',
  '_ai_watchdog_tool_name() {',
  '  local first bin',
  '  first="${1%% *}"',
  '  [ -z "$first" ] && return 1',
  '  bin="${first##*/}"',
  '  case "$bin" in',
  `    ${SHELL_TOOLS_PATTERN})`,
  '      printf \'%s\\n\' "$bin"',
  '      return 0 ;;',
  '    *) return 1 ;;',
  '  esac',
  '}',
  '',
  '_ai_watchdog_preexec() {',
  '  local tool',
  '  # 已有 AI CLI 在跑：管道中后续各段不必重复判定',
  '  if [ -n "$_AI_WATCHDOG_CURRENT" ] && [ "$_AI_WATCHDOG_CURRENT" != "-" ]; then',
  '    return',
  '  fi',
  '  if tool="$(_ai_watchdog_tool_name "$1")"; then',
  '    _AI_WATCHDOG_CURRENT="$tool"',
  '    _ai_watchdog_write true "$tool" "$$"',
  '  else',
  '    # "-" 表示「判过且不是 AI CLI」，precmd 据此不误报完成',
  '    _AI_WATCHDOG_CURRENT="-"',
  '  fi',
  '}',
  '',
  '_ai_watchdog_precmd() {',
  '  if [ -n "$_AI_WATCHDOG_CURRENT" ] && [ "$_AI_WATCHDOG_CURRENT" != "-" ]; then',
  '    _ai_watchdog_write false "$_AI_WATCHDOG_CURRENT" 0',
  '  fi',
  '  _AI_WATCHDOG_CURRENT=""',
  '}',
  '',
  "trap '_ai_watchdog_preexec \"$BASH_COMMAND\"' DEBUG",
  '# 幂等接入 PROMPT_COMMAND，且不覆盖用户原有内容',
  'case "$PROMPT_COMMAND" in',
  '  *_ai_watchdog_precmd*) ;;',
  '  "") PROMPT_COMMAND="_ai_watchdog_precmd" ;;',
  '  *) PROMPT_COMMAND="_ai_watchdog_precmd;$PROMPT_COMMAND" ;;',
  'esac',
  '',
].join('\n');
