# one-code（AI Watchdog）

监控 AI 编码工具状态，及时通知你回来接管。

跨 VS Code、Cursor、Claude、终端等监控 AI 编码工具的工作状态：当 AI 完成任务或需要你接管时，
通过声音、桌面通知、托盘图标提醒，一键跳回接管。完全本地运行，不上传任何数据。

- 落地页 / 官网：<https://one-code.bayjf.com>（仓库 `one-code-landing`）

## 技术栈

| 类别 | 方案 |
|------|------|
| 形态 | VS Code 扩展（`engines.vscode: ^1.85.0`，入口 `dist/extension.js`） |
| 构建 | esbuild（`esbuild.js`），npm workspaces（`packages/*`） |
| 激活 | `onStartupFinished` |

## 快速开始

```bash
npm install
npm run build      # 打包扩展
npm run typecheck
npm test
```
（以 `package.json` 的 scripts 为准，`scripts/` 下另有辅助脚本。）

## 已注册命令

| Command | 说明 |
|---|---|
| `aiWatchdog.toggle` | 开关监控 |
| `aiWatchdog.jumpToChat` | 跳转到 AI 对话面板 |
| `aiwatchdog.takeover` | 一键接管（定位最近改动） |
| `aiWatchdog.clearHistory` | 清除活动历史 |
| `aiWatchdog.showStatus` | 显示当前状态 |

## 注意

- 设计文档在 `design.md`，路线图在 `roadmap.md`，动手前先看这两份。
- 「完全本地运行」是产品承诺：不要引入把代码或对话内容外传的逻辑。
- 项目约定见 `AGENTS.md`、`handoff.md` 与 `docs/`。
