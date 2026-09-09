# AGENTS.md — one-code（AI Watchdog）

供 AI coding agents（Claude Code / Codex / Cursor / Copilot 等）在本仓库工作时自动读取。

## 项目概览
AI Watchdog：监控 AI 编码工具状态、及时通知你回来接管的 VS Code 扩展（`displayName: AI Watchdog`，
包名 `ai-watchdog`）。跨 VS Code、Cursor、Claude、终端等统一监控；完全本地运行，不上传任何数据。
落地页仓库是 `one-code-landing`，站点 https://one-code.bayjf.com。

## 技术栈
- VS Code 扩展（`engines.vscode: ^1.85.0`，入口 `dist/extension.js`）
- npm workspaces（`packages/*`）+ esbuild 打包（`esbuild.js`）
- 激活时机：`onStartupFinished`

## 常用命令
```bash
npm install
npm run build      # 打包扩展（见 package.json scripts）
npm run typecheck
npm test
```
（以 `package.json` 的 scripts 为准；`scripts/` 目录下另有辅助脚本。）

## 已注册命令
| Command | 说明 |
|---|---|
| `aiWatchdog.toggle` | 开关监控 |
| `aiWatchdog.jumpToChat` | 跳转到 AI 对话面板 |
| `aiwatchdog.takeover` | 一键接管（定位最近改动） |
| `aiWatchdog.clearHistory` | 清除活动历史 |
| `aiWatchdog.showStatus` | 显示当前状态 |

## 约定
- 设计文档在 `design.md`，路线图在 `roadmap.md`，动手前先看这两份。
- 完全本地运行是产品承诺，**不要**引入任何把代码或对话内容外传的逻辑。
- 新增用户可见能力要走 command 注册 + 状态栏 / 通知交互，保持与现有命令风格一致。

## 不要做的事
- 不要上传用户代码、对话内容或任何本地数据。
- 不要提交 `dist/`、`.vsix` 与 `.env`。
- 不要跳过 `git pull --rebase` 直接 push。
