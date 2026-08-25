/**
 * zsh Shell Hook
 *
 * precmd / preexec 精确捕获终端中运行的 AI CLI（claude / codex / opencode 等），
 * 在命令开始 / 结束时把状态写入「状态文件」，供桌面应用侧的 ShellHookProbe 消费。
 * 这是「精确终端信号」：命令开始 = working，命令结束 = done。
 */

import { SHELL_TOOLS_PATTERN } from './shared';

/**
 * 可写入 ~/.zshrc 的 zsh 片段。
 * 用行数组拼接，避免模板字符串对 `$` / `${}` 的转义问题。
 */
export const ZSH_HOOK_SOURCE = [
  '# AI Watchdog Shell Hook: 精确终端 AI CLI 监控',
  '# 通过 precmd / preexec 捕获 claude / codex / opencode 等命令，',
  '# 在开始 / 结束时写状态文件（默认 ~/.ai-watchdog/terminal.json），供桌面应用消费。',
  '_AI_WATCHDOG_STATE_FILE="${AI_WATCHDOG_STATE_FILE:-$HOME/.ai-watchdog/terminal.json}"',
  '',
  '# 判断 "$1"（一条命令行）的首个命令是否为已知 AI CLI，命中则输出命令名',
  '_ai_watchdog_tool_name() {',
  '  local first bin',
  '  first="$(print -r -- "$1" | awk \'{print $1}\')"',
  '  [[ -z "$first" ]] && return 1',
  '  bin="${first:t}"',
  '  case "$bin" in',
  `    ${SHELL_TOOLS_PATTERN})`,
  '      print -r -- "$bin"',
  '      return 0 ;;',
  '    *) return 1 ;;',
  '  esac',
  '}',
  '',
  '# 命令即将执行：若为 AI CLI，写 working 状态',
  '_ai_watchdog_preexec() {',
  '  local tool',
  '  if tool="$(_ai_watchdog_tool_name "$1")"; then',
  '    mkdir -p "${_AI_WATCHDOG_STATE_FILE:h}"',
  "    printf '{\"active\":true,\"tool\":\"%s\",\"pid\":%d,\"updatedAt\":%s}\\n' \\",
  '      "$tool" "$$" "$(date +%s)" > "${_AI_WATCHDOG_STATE_FILE}.tmp"',
  '    mv "${_AI_WATCHDOG_STATE_FILE}.tmp" "${_AI_WATCHDOG_STATE_FILE}"',
  '  fi',
  '}',
  '',
  '# 命令执行完回到提示符：若上一条是 AI CLI，写 done 状态',
  '_ai_watchdog_precmd() {',
  '  local last tool',
  '  last="$(fc -ln -1 2>/dev/null)"',
  '  if [[ -n "$last" ]] && tool="$(_ai_watchdog_tool_name "$last")"; then',
  '    mkdir -p "${_AI_WATCHDOG_STATE_FILE:h}"',
  "    printf '{\"active\":false,\"tool\":\"%s\",\"pid\":0,\"updatedAt\":%s}\\n' \\",
  '      "$tool" "$(date +%s)" > "${_AI_WATCHDOG_STATE_FILE}.tmp"',
  '    mv "${_AI_WATCHDOG_STATE_FILE}.tmp" "${_AI_WATCHDOG_STATE_FILE}"',
  '  fi',
  '}',
  '',
  'autoload -Uz add-zsh-hook',
  'add-zsh-hook preexec _ai_watchdog_preexec',
  'add-zsh-hook precmd _ai_watchdog_precmd',
  '',
].join('\n');