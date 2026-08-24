# AI Watchdog 统一监控产品 — 设计方案

> 状态：提案（Phase 0）
> 日期：2026-08-23
> 前置阅读：`handoff.md`（当前 VS Code 扩展形态的现状）

## 1. 背景与动机

当前 AI Watchdog 是一个 **VS Code 扩展**，只能监控 VS Code 进程内可感知的活动，存在三个硬边界：

| 边界 | 原因 |
|---|---|
| 终端监控正式版不可用 | 依赖 proposed API `onDidWriteTerminalData`，发布版静默降级 |
| 非 VS Code fork 产品无法监控 | Claude Desktop / ChatGPT 不在 VS Code 进程内，拿不到任何 API |
| fork 产品深度信号受限 | `getExtension('github.copilot')` 等扩展检测依赖 fork 的扩展生态 |

**产品愿景**：一个独立产品，用户在设置里勾选要监控的目标软件（VS Code、Cursor、Claude、终端等），即可跨产品获得统一的"AI 工作中 / 完成 / 等待输入"提醒。

## 2. 核心结论

1. **产品形态必须升级**：从"VS Code 扩展"变为"独立常驻应用"（系统守护进程 + 托盘 UI），才能物理上拿到跨产品信号。
2. **两个形态并存**：VS Code 扩展做浅层（继续维护），守护进程做主力（新开发）。
3. **架构延续**：现有 `IMonitor` 抽象、状态机、滑动窗口、防抖等纯逻辑 100% 复用。

## 3. 总体架构

```
┌─────────────────────────────────────────────┐
│              托盘应用 / 设置 UI                │
│   （勾选监控目标、配置项、活动历史面板）          │
├─────────────────────────────────────────────┤
│              状态聚合引擎（core）               │
│   状态机 + 防抖合并 + 通知路由 + 活动日志        │
├──────┬──────┬──────┬──────┬─────────────────┤
│ 文件  │ 进程  │Shell │Claude│  ...更多探针     │
│ 探针  │ 探针  │ Hook │ 会话  │  （插件式注册）   │
├──────┴──────┴──────┴──────┴─────────────────┤
│              OS 系统能力层                     │
│  fs.watch / 进程表 / AX API / 系统通知         │
└─────────────────────────────────────────────┘
```

**核心思想**：「监控目标」只是配置，「监控能力」是探针。
用户勾选 Cursor，实际激活的是"文件探针（Cursor 工作区目录）+ 进程探针（Cursor 进程名）"的组合。探针插件式注册，新增目标 = 新增 profile，不改核心。

## 4. 监控目标与探针组合

| 目标 | 探针组合 | 判定方式 | 可靠性 |
|---|---|---|---|
| VS Code / Cursor（fork 一视同仁） | ① `fs.watch` 工作区目录 ② 进程探针 | 滑动窗口检测文件变更频率 + 静默超时判 done | 高（复用现有算法） |
| Claude（桌面版） | ① 会话文件探针：`~/.claude/projects/*.jsonl` 有追加 = 正在生成 ② 窗口标题探针 | jsonl 静默超时 = 完成；出现提问 = 等待 | 中高 |
| Claude Code / 终端 AI CLI | ① Shell Hook（`precmd/preexec` 写状态文件） ② 进程树探针（claude/codex/aider 等进程及 CPU/IO） | 命令开始 = working，命令结束 = done | 高（hook 是精确信号） |
| 终端（通用） | Shell Hook + 终端 App 进程监控 | 同上 | 中高 |
| ChatGPT（网页/桌面） | ① 浏览器扩展读 DOM（后期可选） ② 窗口标题探针 | 弱信号 | 低（建议后期） |

### 信号分级原则（关键设计约束）

- **强信号**：文件变更、Shell Hook、官方数据文件（如 Claude jsonl）→ 可独立触发状态转移
- **弱信号**：窗口标题、进程 CPU、剪贴板 → 仅做辅助仲裁，**不单独触发通知**

## 5. 设置页设计

```
监控目标
☑ VS Code        ☑ Cursor        ☑ Claude        ☐ ChatGPT        ☑ 终端

每个目标展开后：
- 监听目录（默认：~/Projects 或自动发现最近活跃工作区）
- 进程名匹配（如 "Cursor"、"claude"、"node.*claude"）
- 灵敏度（窗口大小 / 阈值 / 静默超时 —— 复用现有配置项语义）
- 通知方式（声音 / 系统通知 / 仅失焦时）
```

内置 profile 提供各目标默认值（Claude profile 预置 `~/.claude` 路径与进程名），用户只管勾选。

## 6. 技术选型

**Electron + TypeScript**，理由：

1. 现有纯逻辑层直接复用：`state/transitions.ts`、`monitors/editWindow.ts`、`util/format.ts`、`notificationCoordinator` 防抖逻辑（均不依赖 vscode）
2. 生态现成：`chokidar`（文件监控）、`node-notifier`（已依赖）
3. 系统级探针在 macOS 上以 `ps` / `osascript` / 原生模块补齐

备选 Tauri（更轻）—— 但需 Rust 重写逻辑，当前阶段不建议。

### 为什么选 Electron 而非 Tauri

**核心是"复用现有 TS 资产"的取舍**，按对本项目的重要性排序：

1. **代码复用率最高（决定性）**：现有纯逻辑层已是 TypeScript，Electron 主进程即 Node + TS，几乎原样迁移即可运行，`node-notifier` 直接可用。Tauri 后端为 Rust，需将状态机、滑动窗口、路径匹配、防抖全部重写一遍，且引入"两套实现需保持一致"的长期维护负担。

2. **系统探针生态是 Node 的**：文件监控（chokidar）、进程表/CPU/IO（`ps`/原生模块）、macOS 窗口标题/AX API（`osascript`）、Shell Hook 状态文件读取——Node 生态全现成；Tauri 需在 Rust 侧重新实现或经 FFI 桥回 JS。

3. **打包/跨平台心智成本更低**：electron-builder 一套配置覆盖 macOS/Windows/Linux；Tauri 需 Rust 工具链 + 各平台系统 webview 依赖（Linux 尤需 WebKitGTK）。

**Tauri 的优势（权衡后放弃）**：产物小、内存低、启动快。但常驻托盘监控器本就该低频、小内存（文件监听 + 进程表轮询，几十 MB 内），Tauri 的"轻"发挥不出优势，却要付出 Rust 重写全部逻辑的成本。

**结论**：阶段 1b 目标是快速落地、复用代码 > 省几十 MB 内存，故选 Electron。

**未来切换边界**：若需"极致低占用、开机自启、无感知后台守护"且愿意以 Rust 重写核心逻辑，则 Tauri（或纯 Rust + tray-icon）更优。

## 7. 分阶段路线图

| 阶段 | 内容 | 完成后效果 |
|---|---|---|
| **1. 骨架** | Electron 壳 + 托盘 + 设置页；现有纯逻辑迁为 `core` 包；文件探针 + 进程探针 | 覆盖所有"写文件"的工具：VS Code、Cursor、Claude Code、终端里的任何 AI（约 90% 诉求） |
| **1a. core 抽取（✅ 已完成）** | `packages/core` 包：`types`/`transitions`/`format`/`paths`/`editWindow` + 单测；npm workspaces 打通扩展侧引用 | 纯逻辑与 vscode 解耦，可被 Electron 复用 |
| **1b. 桌面骨架（✅ 已完成）** | `packages/desktop`：Electron 主进程 + 托盘 + 聚合引擎 + 设置窗口；文件探针（chokidar + RapidEditDetector）+ 进程探针 + 目录自动发现 + 配置持久化 + 产品 logo 托盘图标 | 可编译运行，完整设置 UI；待：端到端联调 |
| **2. Shell Hook** | zsh 集成（precmd/preexec 写状态文件，守护进程消费） | 终端监控从"不可用"变"精确" |
| **3. Claude Desktop** | `~/.claude/projects/*.jsonl` 追加检测探针 | Claude 勾选项完整可用 |
| **4. 伴侣与扩展（可选）** | 现有 VS Code 扩展改造为"深度模式伴侣"（本地 socket 上报信号）；ChatGPT 浏览器扩展 | 深度信号 + 网页版覆盖（详见 §11） |

## 8. 取舍说明

统一产品形态**放弃**：

- VS Code 内深度集成（状态栏、跳转 AI 面板命令）→ 需重新设计为全局快捷键 / 托盘菜单
- Marketplace 分发渠道 → 独立 App 分发，macOS 需处理签名与公证

**换来**：跨产品全覆盖（VS Code / fork / Claude / 终端）。

决策：两个形态并存——扩展做浅层，守护进程做主力。

## 9. 目录规划（阶段 1 落地时）

```
one-code/
├── packages/
│   ├── core/            # 纯逻辑：状态机、滑动窗口、防抖、格式化（从 src/ 迁移）
│   ├── desktop/         # Electron 主进程 + 托盘 + 设置 UI
│   └── probes/          # 探针实现：file / process / shell-hook / claude-session
├── src/                 # 现有 VS Code 扩展（继续维护）
└── handoff.md / design.md
```

## 10. 开放问题（待决策）

- [ ] 多工作区目录的自动发现策略（最近活跃？固定列表？）
- [x] Shell Hook 的安装引导流程 —— 阶段 2 已落地：托盘一键写入/卸载 `~/.zshrc` 片段
- [ ] Claude jsonl 解析的健壮性（格式未官方承诺，阶段 3 已实现，待端到端灰度验证）
- [ ] Windows / Linux 支持优先级（当前先 macOS）
- [ ] 独立 App 的自动更新方案
- [ ] 阶段 4：浏览器扩展访问 localhost socket 的权限 / CORS 限制
- [ ] 阶段 4：socket 鉴权（防本机其他进程伪造信号）

## 11. 阶段 4 详细设计：伴侣与扩展（可选）

### 11.1 目标与角色转变

阶段 1-3 的守护进程靠 **OS 层信号**工作（文件变更、进程表、Shell Hook、Claude jsonl），但有两类**只有宿主应用内部才拿得到**的深度信号，OS 层永远看不见：

| 信号 | 宿主 | 示例 |
|---|---|---|
| VS Code 内部 | VS Code 扩展 API | Copilot/Cline 扩展是否活跃、`onDidWriteTerminalData` 终端写入、编辑器焦点 |
| ChatGPT 网页 | 浏览器 DOM | "Stop generating" 按钮、流式渲染、发送按钮状态 |

**伴侣（Companion）= 守护进程的"外置传感器"**：住在宿主应用内部，把深度信号经本地 socket 上报给守护进程，**不做状态判断**——判断、聚合、防抖、通知全部留在守护进程。

**角色转变**：现有 VS Code 扩展从"独立监控器"降级为"信号源"，与 ChatGPT 浏览器扩展一起接入守护进程体系。

### 11.2 总体架构

```
   宿主应用内部（阶段 4 新增）                OS 层（阶段 1–3）
┌───────────────────────────┐      ┌──────────────────────────────┐
│  VS Code 扩展（伴侣）      │      │  文件探针 / 进程探针           │
│  Copilot/Cline 活跃        │──┐   │  Shell Hook / Claude jsonl   │
│  onDidWriteTerminalData    │  │   └─────────────▲────────────────┘
└───────────────────────────┘  │                  │ 探针事件
┌───────────────────────────┐  │ 本地 socket      │
│  ChatGPT 浏览器扩展        │  │（localhost IPC） │
│  Stop/Regenerate 按钮      │──┤                  │
│  流式渲染 / 等待输入       │  │                  │
└───────────────────────────┘  │                  │
                        ┌──────▼──────────────────▼──────┐
                        │   AI Watchdog 守护进程           │
                        │  聚合引擎 · 状态机 · 防抖 · 通知  │
                        └─────────────────────────────────┘
```

两条信号路径汇入同一个守护进程：探针上报 OS 层信号（阶段 1-3），伴侣上报深度信号（阶段 4），统一走现有 `MonitorEvent` / `MonitorSource` 语义，聚合引擎无感扩展。

### 11.3 本地 socket 协议

- **传输**：localhost TCP 或 Unix domain socket，守护进程监听固定端口/路径。
- **鉴权**：共享 token（环境变量注入或首次配对写入），防止本机其他进程伪造信号。
- **消息格式**（JSON lines，复用 `MonitorEvent` 语义）：
  ```json
  {"source":"vscode-ext","type":"activity","message":"copilot streaming"}
  {"source":"chatgpt-ext","type":"waiting","message":"awaiting input"}
  {"source":"vscode-ext","type":"done","message":"copilot finished"}
  ```
  `type ∈ activity | done | waiting | idle`，`source` 映射到 `MonitorSource` 新枚举（如 `vscode-companion`、`chatgpt-web`）。
- **可靠性**：断线自动重连 + 心跳保活；守护进程未启动时伴侣静默降级（不打扰用户）。

### 11.4 VS Code 扩展 → 深度模式伴侣

- **现状**：扩展是独立监控器（`src/` 现有逻辑），自己判断、自己通知。
- **改造点**：保留浅层监控继续维护；新增**伴侣模式**——启动时探测守护进程 socket，连接成功后上报深度信号，断开则回退浅层。
- **深度信号清单**：
  - Copilot / Cline / Roo 扩展是否活跃（`getExtension().isActive`）
  - `onDidWriteTerminalData`（终端写入；proposed API，发布版不可用 → 伴侣模式天然受限，仅本地/dev 生效）
  - 编辑器焦点、当前活动编辑器切换
  - 状态栏可见状态（如 Copilot 状态栏文字）
- **信号分级**：以上多为**弱信号/辅助**，仅"扩展活跃 + 明确生成中"可作为强信号（遵循 §4 信号分级原则）。

### 11.5 ChatGPT 浏览器扩展

- **形态**：Chrome/Edge MV3 扩展。
- **检测点（DOM）**：
  - "Stop generating" 按钮出现 = 生成中 → `activity`
  - "Regenerate"/发送按钮可用、回答区停住 = 等待输入 → `waiting`
  - 回答流式渲染区域变化 = `activity`
- **信号分级**：**弱信号**，仅辅助仲裁，不单独触发通知（遵循 §4 信号分级原则）。
- **上报**：浏览器扩展连 localhost socket 需处理 host 权限/CORS；如受限，可经本地 agent（守护进程配套的迷你 HTTP 服务）转发。

### 11.6 落地步骤

1. `core`：新增 `MonitorSource` 枚举（`vscode-companion` / `chatgpt-web`）。
2. `desktop`：实现本地 socket 服务端（监听 + 鉴权 + 解析 JSON lines → 喂给 `Aggregator`）。
3. `src/` 扩展：新增伴侣模式 + socket 客户端，保持浅层功能兼容。
4. 浏览器扩展：DOM 检测 + socket 上报。
5. 设置页：新增"深度信号"开关（VS Code 伴侣 / ChatGPT 网页）。
6. 端到端验证 + 灰度。

### 11.7 风险与开放问题

- 浏览器扩展访问 localhost socket 的权限 / CORS 限制（可能需要本地转发 agent）。
- socket 安全：本机其他进程可能伪造信号 → 必须做 token 鉴权。
- ChatGPT DOM 结构易碎，需灰度验证；定位为弱信号，坏了不影响主流程。
- `onDidWriteTerminalData` 发布版不可用 → VS Code 伴侣的深度价值受限，主信号仍靠浅层 + 守护进程探针。
- 扩展改造需保持浅层功能完全兼容，避免回归。

## 12. 文档变更记录

- 2026-08-24：新增 §11 阶段 4 详细设计（伴侣与扩展）；更新 §10 开放问题。

