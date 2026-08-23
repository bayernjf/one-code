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

## 7. 分阶段路线图

| 阶段 | 内容 | 完成后效果 |
|---|---|---|
| **1. 骨架** | Electron 壳 + 托盘 + 设置页；现有纯逻辑迁为 `core` 包；文件探针 + 进程探针 | 覆盖所有"写文件"的工具：VS Code、Cursor、Claude Code、终端里的任何 AI（约 90% 诉求） |
| **1a. core 抽取（✅ 已完成）** | `packages/core` 包：`types`/`transitions`/`format`/`paths`/`editWindow` + 单测；npm workspaces 打通扩展侧引用 | 纯逻辑与 vscode 解耦，可被 Electron 复用 |
| **2. Shell Hook** | zsh 集成（precmd/preexec 写状态文件，守护进程消费） | 终端监控从"不可用"变"精确" |
| **3. Claude Desktop** | `~/.claude/projects/*.jsonl` 追加检测探针 | Claude 勾选项完整可用 |
| **4. 伴侣与扩展（可选）** | 现有 VS Code 扩展改造为"深度模式伴侣"（本地 socket 上报信号）；ChatGPT 浏览器扩展 | 深度信号 + 网页版覆盖 |

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

- [ ] 已迁到 core 的 5 个旧文件（`src/state/transitions.ts`、`src/util/format.ts`、`src/util/paths.ts`、`src/monitors/editWindow.ts`、`src/test/unit.test.ts`）现已成孤儿、与 core 重复，待用户确认后删除
- [ ] 多工作区目录的自动发现策略（最近活跃？固定列表？）
- [ ] Shell Hook 的安装引导流程（一键写入 zshrc？）
- [ ] Claude jsonl 解析的健壮性（格式未官方承诺，需灰度验证）
- [ ] Windows / Linux 支持优先级（当前先 macOS）
- [ ] 独立 App 的自动更新方案
