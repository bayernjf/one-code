# AI Watchdog - 项目交接文档

## 项目概述

VS Code 插件，监控 AI 编码工具（Copilot Chat、Cline/Roo Code、终端 AI CLI 等）的工作状态。用户启动 AI 任务后可以离开做其他事，插件在 AI 完成或等待输入时通过状态栏、系统通知、声音、桌面通知多维度提醒用户回来接管。

## 技术栈

- TypeScript + VS Code Extension API
- esbuild 打包
- node-notifier 桌面通知
- 目标 VS Code 版本: ^1.85.0

## 项目结构

```
├── package.json              # 插件清单（命令、配置项、视图贡献点）
├── tsconfig.json
├── esbuild.js                # 构建脚本（支持 --watch / --production）
├── .vscodeignore
├── .vscode/
│   ├── launch.json           # F5 调试
│   └── tasks.json
├── resources/
│   └── watchdog.svg          # 活动栏图标
└── src/
    ├── extension.ts          # 入口：初始化所有模块、注册命令、连接事件
    ├── config.ts             # 读取 aiWatchdog.* 配置项
    ├── monitors/
    │   ├── types.ts          # AIStatus 枚举、IMonitor 接口、事件类型
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

## 待完成

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
npm install          # 安装依赖
npm run build        # 生产构建 → dist/extension.js
npm run watch        # 开发监听模式
npm run lint         # ESLint 检查
npm run test:unit    # 纯逻辑单元测试（node:test + tsx）
npx tsc --noEmit     # 类型检查
# F5                 # 在 VS Code 中启动扩展开发宿主调试
```

## 关键设计决策

1. **通用检测优先**：文件变更频率检测不依赖任何特定扩展 API，兼容所有 AI 工具
2. **proposed API 可选**：终端 onDidWriteTerminalData 作为增强，不可用时静默降级
3. **execFile 替代 exec**：声音播放使用 execFile + argv 数组，避免 shell 注入
4. **桌面通知仅失焦时**：`vscode.window.state.focused` 为 true 时不发桌面通知，避免打扰
5. **done 状态 30 秒自动回 idle**：避免状态栏长期停留在"已完成"

## 已知限制

- Copilot Chat 无公开 API 直接读取对话状态，只能通过 document version 间接推断
- Cline/Roo 的 webview 内容不可直接访问，依赖文件系统变更间接检测
- 终端 proposed API 需要 `--enable-proposed-api` 启动参数，正式发布版不可用
