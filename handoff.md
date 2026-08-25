# AI Watchdog - 项目交接文档

> **产品演进**：下一阶段方向是"统一监控产品"（跨 VS Code / Cursor / Claude / 终端），完整设计方案见 [`design.md`](./design.md)。

## 项目概述

VS Code 插件，监控 AI 编码工具（Copilot Chat、Cline/Roo Code、终端 AI CLI 等）的工作状态。用户启动 AI 任务后可以离开做其他事，插件在 AI 完成或等待输入时通过状态栏、系统通知、声音、桌面通知多维度提醒用户回来接管。

## 技术栈

- TypeScript + VS Code Extension API
- esbuild 打包
- node-notifier 桌面通知
- npm workspaces（monorepo：扩展 + `@ai-watchdog/core` 纯逻辑包）
- 目标 VS Code 版本: ^1.85.0

## 项目结构

```
├── package.json              # 根：插件清单 + workspaces 声明（packages/*）
├── tsconfig.json
├── esbuild.js                # 构建脚本（支持 --watch / --production）
├── .vscodeignore
├── .vscode/
│   ├── launch.json           # F5 调试
│   └── tasks.json
├── resources/
│   └── watchdog.svg          # 活动栏图标
├── packages/
│   └── core/                 # @ai-watchdog/core：纯逻辑包（无 vscode 依赖）
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts      # 统一出口
│       │   ├── types.ts      # AIStatus / MonitorSource / 事件类型
│       │   ├── transitions.ts# 状态机转移 computeNextStatus
│       │   ├── format.ts     # formatDuration 时长格式化
│       │   ├── paths.ts      # shouldIgnorePath 路径过滤
│       │   ├── editWindow.ts # RapidEditDetector 滑动窗口检测
│       │   └── companion.ts  # 伴侣 socket 协议：帧类型 + parseCompanionLine + socket/token 路径
│       └── test/             # core.test.ts / companion.test.ts（20 用例）
├── packages/
│   └── desktop/              # @ai-watchdog/desktop：Electron 桌面应用（统一监控产品）
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts       # 入口：托盘 + 通知 + 探针装配
│           ├── config.ts     # 监控目标配置（WatchTarget）
│           ├── configStore.ts # 配置持久化（JSON 存 userData）
│           ├── workspaceDiscovery.ts # 工作区目录自动发现
│           ├── aggregator.ts # 状态聚合引擎（复用 core 状态机 + 防抖）
│           ├── updater.ts    # electron-updater 自动更新（事件流 + IPC）
│           ├── settingsWindow.ts # 设置窗口（BrowserWindow + IPC）
│           ├── preload.ts    # contextBridge 暴露 settingsAPI
│           ├── renderer/
│           │   ├── settings.html # 设置页 UI（勾选目标 + 灵敏度 + 深度信号 + 更新）
│           │   └── settings.ts   # 渲染进程逻辑（ESM）
│           ├── scripts/gen-tray-icon.js # 托盘图标生成脚本（纯 Node，无依赖）
│           ├── resources/tray/ # 托盘图标 PNG（16/32 @2x，产品 logo）
│           ├── test/            # 单测：aggregator / 各探针 / shellHook / companionServer / codexSessionProbe（48 用例）
│           ├── shellHook/
│           │   ├── zsh.ts        # zsh precmd/preexec 片段与状态文件格式
│           │   └── manager.ts    # ~/.zshrc 片段幂等写入/移除
│           ├── companion/
│           │   ├── server.ts     # 伴侣 socket 服务端（Probe 实现，token 鉴权 + JSON lines）
│           │   └── token.ts      # 鉴权 token 生成/读取（0600）
│           └── probes/
│               ├── probe.ts      # 探针接口（宿主无关）
│               ├── fileProbe.ts  # 文件探针（chokidar + RapidEditDetector）
│               ├── processProbe.ts # 进程探针（ps 轮询，弱信号）
│               ├── shellHookProbe.ts # Shell Hook 状态文件探针（强信号）
│               ├── claudeSessionProbe.ts # Claude 会话 jsonl 追加检测
│               └── codexSessionProbe.ts # Codex rollout 生命周期事件探针（ChatGPT 桌面端 / VS Code 扩展 / CLI）
└── src/                      # VS Code 扩展（依赖 @ai-watchdog/core）
    ├── extension.ts          # 入口：初始化所有模块、注册命令、连接事件
    ├── config.ts             # 读取 aiWatchdog.* 配置项
    ├── companion/
    │   └── client.ts         # 伴侣客户端：深度信号上报 + 退避重连 + 心跳
    ├── monitors/
    │   ├── types.ts          # 薄层：re-export core 类型 + IMonitor 接口
    │   ├── fileWatcher.ts    # 核心：文件变更频率滑动窗口检测
    │   ├── terminalWatcher.ts# 终端输出关键词匹配（proposed API 可选）
    │   ├── copilotWatcher.ts # Copilot 扩展状态 + document version 检测
    │   └── clineWatcher.ts   # Cline/Roo 文件监控 + XML 标签模式匹配
    ├── state/
    │   ├── aiStateMachine.ts # 状态机 idle→working→done/waiting→idle
    │   └── activityLog.ts    # 活动历史记录 + 格式化工具函数
    ├── notifications/
    │   ├── statusBar.ts      # 状态栏指示器（旋转图标 + 计时 + 闪烁）
    │   ├── notifier.ts       # VS Code 弹窗通知（带操作按钮）
    │   ├── soundPlayer.ts    # 跨平台声音（macOS afplay / Linux paplay / Win PowerShell）
    │   └── desktopNotify.ts  # node-notifier 桌面通知（仅失焦时触发）
    └── views/
        └── activityPanel.ts  # 侧边栏 TreeView 活动时间线
```

## 核心算法

**文件监控滑动窗口：**
- 窗口大小默认 3 秒，阈值默认 3 次变更
- 窗口内变更次数 ≥ 阈值 → 判定 AI working
- 变更停止超过 silenceTimeout（默认 8 秒）→ 判定 done
- 配置项：`aiWatchdog.windowSize`、`aiWatchdog.activityThreshold`、`aiWatchdog.silenceTimeout`

**状态机转换：**
```
idle → working（检测到活动）
working → done（静默超时）
working → waiting（检测到等待输入模式）
done → idle（30 秒后自动 / 用户确认）
waiting → idle（用户确认）
```

## 已完成

- [x] 项目脚手架（package.json / tsconfig / esbuild）
- [x] 4 个监控器（文件、终端、Copilot、Cline）
- [x] 状态机 + 活动日志
- [x] 通知系统（状态栏 / 弹窗 / 声音 / 桌面）
- [x] 侧边栏 TreeView 面板
- [x] 配置管理（10+ 配置项）
- [x] 4 个命令（toggle / jumpToChat / clearHistory / showStatus）
- [x] esbuild 构建通过
- [x] TypeScript 类型检查通过（零错误）
- [x] `.gitignore`（排除 node_modules/ dist/ out/ *.vsix）
- [x] `git init` + 初始提交
- [x] `@types/node-notifier` 加入 devDependencies
- [x] ESLint 配置（.eslintrc.json），`npm run lint` 零错误
- [x] 通知防抖：新增 NotificationCoordinator，done/waiting 通知 1.5s 窗口合并
- [x] 活动日志持久化（vscode.globalState，跨会话保存最近 100 条）
- [x] "一键接管" 命令 `aiwatchdog.takeover`：定位并打开最近改动文件末尾（通知"查看变更"按钮触发）
- [x] 单元测试：`npm run test:unit`（node:test + tsx），覆盖状态机/滑动窗口/文件过滤/时长格式化
- [x] 纯逻辑解耦：提取 `monitors/editWindow.ts`、`util/paths.ts`、`state/transitions.ts`、`util/format.ts`（不依赖 vscode，可单测）
- [x] core 包抽取（阶段 1a）：`packages/core`（`@ai-watchdog/core`），纯逻辑 + 类型迁入；npm workspaces 打通扩展侧引用；单测迁至 `packages/core/test`
- [x] 桌面应用骨架（阶段 1b 初版）：`packages/desktop`（`@ai-watchdog/desktop`），Electron 主进程 + 托盘 + 聚合引擎 + 文件探针（chokidar + RapidEditDetector）+ 进程探针（ps 轮询）；可编译运行
- [x] 阶段 4a：VS Code 扩展伴侣模式 —— 深度信号经本地 Unix domain socket（token 鉴权）上报守护进程，判断/防抖/通知仍留在守护进程侧；守护进程未运行时静默退避重连，浅层监控不受影响

## 待完成

### 统一监控产品（下一阶段，见 `design.md`）

- [x] 阶段 1a：core 抽取（纯逻辑解耦为 `@ai-watchdog/core`）
- [✅] 阶段 1b：Electron 壳 + 托盘 + 设置窗口 + 文件探针 + 进程探针（骨架、目录自动发现、配置持久化、托盘图标、设置窗口 UI、探针/聚合引擎单测均已完成；ad-hoc 签名解决 Gatekeeper 拦截；electron-builder 打包 mac dmg/zip 已验证通过；release 工作流 + electron-updater 自动更新（含完整事件流 + IPC + 设置页更新 UI，对齐 soft-desk）已就绪）
- [x] 阶段 2：Shell Hook（zsh）精确终端监控（ShellHookProbe + 托盘一键安装/卸载 ~/.zshrc 片段 + 单测）
- [x] 阶段 3：Claude Desktop 专用探针（`~/.claude/projects/*.jsonl` 追加检测 + 单测）
- [x] 阶段 3a：Codex 会话探针（`~/.codex/sessions/**/rollout-*.jsonl` 生命周期事件 + 单测）—— 一个探针同时覆盖 ChatGPT 桌面端、VS Code openai.chatgpt 扩展、codex CLI
- [x] 阶段 4a：守护进程 socket + VS Code 伴侣（core 协议层 + Desktop CompanionServer + 扩展 CompanionClient + 设置页开关 + 端到端验证）
- [—] 阶段 4b：ChatGPT 浏览器扩展 —— **已搁置**，且桌面端已被阶段 3a 的 Codex 探针取代；仅 ChatGPT 网页版仍未覆盖
- [ ] 阶段 4a 端到端灰度：真实 VS Code + 打包后守护进程联调，观察重复通知是否需调防抖窗口
- [ ] 阶段 3a 端到端灰度：真实 ChatGPT 桌面端跑一轮任务，确认 activity/done 时序符合预期
- [ ] 清理根目录 `npm test`：脚本指向已删除的 `out/test/runTest.js`（既存问题，CI 未跑到）

### 必要项（发布前）

全部完成 ✅

### 体验增强

- [x] 活动日志持久化（vscode.globalState）
- [x] 多根工作区 fileWatcher 优化（VS Code 的 `createFileSystemWatcher('**/...')` 原生覆盖所有 workspace folder，已满足）
- [x] "一键接管"：聚焦编辑器并定位到最近变更位置
- [x] 单元测试（状态机、滑动窗口、文件过滤）

### 发布

- [ ] 替换 package.json 中 publisher 为真实 ID
- [ ] 制作 128x128 插件图标
- [ ] 录制功能演示 GIF
- [ ] `vsce package` 打包 .vsix 本地验证
- [ ] 发布到 VS Code Marketplace

## 开发命令

```bash
npm install                           # 安装依赖 + 建立 workspace 软链
npm run build                         # 生产构建 → dist/extension.js
npm run watch                         # 开发监听模式
npm run lint                          # ESLint 检查（src/）
npm test --workspace @ai-watchdog/core # core 包单测（含伴侣协议）
npm run typecheck --workspace @ai-watchdog/core # core 包类型检查
npx tsc --noEmit                      # 扩展侧类型检查
npm run build --workspace @ai-watchdog/desktop # 桌面应用构建（tsc → dist/）
npm run start --workspace @ai-watchdog/desktop # 启动桌面应用（托盘）
npm test --workspace @ai-watchdog/desktop # 桌面应用单测（探针 + 聚合引擎 + 伴侣 socket）
npm run dist:mac --workspace @ai-watchdog/desktop # 打包 macOS 安装包（dmg/zip → release/）
npm run dist:win --workspace @ai-watchdog/desktop # 打包 Windows 安装包（NSIS exe → release/）
# F5                                  # 在 VS Code 中启动扩展开发宿主调试
```

## 关键设计决策

1. **通用检测优先**：文件变更频率检测不依赖任何特定扩展 API，兼容所有 AI 工具
2. **proposed API 可选**：终端 onDidWriteTerminalData 作为增强，不可用时静默降级
3. **execFile 替代 exec**：声音播放使用 execFile + argv 数组，避免 shell 注入
4. **桌面通知仅失焦时**：`vscode.window.state.focused` 为 true 时不发桌面通知，避免打扰
5. **done 状态 30 秒自动回 idle**：避免状态栏长期停留在"已完成"
6. **纯逻辑与宿主解耦**：状态机/滑动窗口/路径过滤/时长格式化迁入 `@ai-watchdog/core`，不依赖 vscode，可被独立监控应用（Electron）复用
7. **伴侣只上报不判断**：扩展经 socket 上报深度信号，状态判断/防抖/通知全留在守护进程；信号分级放在信号源侧，聚合引擎不为弱信号引入新仲裁机制
8. **伴侣鉴权用 token 文件**：`~/.ai-watchdog/companion-token`（0600）+ Unix domain socket（0600），避免端口冲突与防火墙提示；守护进程未运行时伴侣静默退避重连，不打扰用户
9. **Codex 状态取显式事件而非静默超时**：rollout 里有 `task_started` / `task_complete` / `turn_aborted`，比 Claude 探针的「追加停止 + 防抖」精确；并发 turn 用 Map 计数，全部结束才报 done，另设 30 分钟兜底清理，避免宿主崩溃后永久卡在 working

## 已知限制

- Copilot Chat 无公开 API 直接读取对话状态，只能通过 document version 间接推断
- Cline/Roo 的 webview 内容不可直接访问，依赖文件系统变更间接检测
- 终端 proposed API 需要 `--enable-proposed-api` 启动参数，正式发布版不可用 → 伴侣模式下该深度信号同样受限
- VS Code 扩展形态本身无法监控非 fork 独立产品（Claude Desktop / ChatGPT），这部分由桌面守护进程覆盖（见 `design.md`）
- Codex 探针拿不到 waiting：rollout 不落盘「等待用户批准」事件，只能给 working / done / idle
- Codex rollout 格式非官方承诺；事件类型若改名，探针会静默失效（不误报）
- 伴侣 socket 的 0600 权限只能挡住其他用户，同用户进程仍可读 token 文件伪造信号——本机同用户信任模型下可接受
- 伴侣的 Windows 命名管道路径已实现但未实测（当前 macOS 优先）
