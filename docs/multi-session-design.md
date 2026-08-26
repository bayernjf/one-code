# 多会话状态管理 — 设计文档

> 状态：待评审
> 日期：2026-08-26
> 前置：[`roadmap.md`](../roadmap.md) P2-3、[`handoff.md`](../handoff.md)

## 1. 背景与问题

当前 `Aggregator` 是**单一全局状态机**：所有探针的事件汇入同一个 `status`，用 `computeNextStatus` 驱动转移。

这在单工具场景下没问题，但用户经常同时运行多个 AI 工具（比如 Claude Code 跑重构、ChatGPT 写文档），此时：

| 问题 | 表现 |
|---|---|
| 状态混淆 | 托盘只显示一个"工作中"，分不清是 Claude 还是 ChatGPT 在跑 |
| 通知模糊 | 通知只说"已完成"，不知道哪个工具完成了（虽然有 source，但全局状态不区分） |
| 时长不准 | `workingDuration` 是全局的，A 工具跑了 5 分钟、B 工具刚启动，显示的是 A 的时长 |
| 历史扁平 | 活动历史按时间倒序，无法按工具筛选/分组 |
| 仲裁粗糙 | `activeSessions` 只记录"有 session 在工作"，不区分是哪个 session |

## 2. 目标

1. 每个 `MonitorSource` 维护**独立状态机**，互不干扰
2. 全局状态由子状态**聚合**得出，保持现有 `onStatusChange` / `currentStatus` / `workingDuration` API 兼容
3. 通知按来源独立防抖、独立计算最短工作时长
4. 托盘菜单展示每个活跃会话的状态和时长
5. 活动历史已带 `source` 字段，存储不变，仅展示层支持按来源筛选

**非目标**：
- 不做跨工具的任务编排/依赖管理
- 不改变探针的事件格式（`MonitorEvent` 不变）
- 不做会话级别的配置覆盖（所有 session 共享同一套灵敏度/门槛配置）

## 3. 架构设计

### 3.1 SessionState

```typescript
interface SessionState {
  status: AIStatus;
  workingSince: Date | undefined;
  lastDoneAt: number;     // 用于该来源的 done 防抖
  lastWaitingAt: number;  // 用于该来源的 waiting 防抖
}
```

`Aggregator` 内部维护 `Map<MonitorSource, SessionState>`，事件到达时按 `event.source` 路由到对应 session。

### 3.2 全局状态聚合规则

优先级从高到低：

1. **任一 session 为 `waiting`** → 全局 `waiting`（需要用户操作，最紧急）
2. **任一 session 为 `working`**（且无 waiting）→ 全局 `working`
3. **任一 session 为 `done`**（且无 working/waiting）→ 全局 `done`
4. **全部 idle** → 全局 `idle`

每次 `handleEvent` 更新某个 session 后，调用 `recomputeGlobalStatus()`，若全局状态变化则 `emit('status', globalStatus)`。

### 3.3 workingDuration

全局 `workingDuration` 返回**所有 working session 中最长的时长**（最老的 `workingSince`）。理由：托盘显示"已工作 Xs"时，用户最关心的是跑得最久的那个任务。

```typescript
get workingDuration(): number {
  let oldest: Date | undefined;
  for (const s of this.sessions.values()) {
    if (s.status === AIStatus.Working && s.workingSince) {
      if (!oldest || s.workingSince < oldest) oldest = s.workingSince;
    }
  }
  return oldest ? Date.now() - oldest.getTime() : 0;
}
```

## 4. 状态转移细节

### 4.1 单 session 内的转移

复用 core 的 `computeNextStatus(session.status, event.type)`，与当前逻辑一致。

### 4.2 信号权威性仲裁（保留并细化）

当前逻辑：`activeSessions` 是全局 Set，session 探针工作时压制所有 heuristic 的 done。

多会话后改为**按来源精确仲裁**：

- `event.authority === 'session'` 且 `type === 'activity'` → 该来源标记为 active session
- `event.authority === 'session'` 且 `type !== 'activity'` → 该来源移出 active session
- 当 heuristic 来源的 `done` 事件到达时，检查**是否有其他来源**是 active session：有则丢弃该 done，无则正常处理

这样 A 工具（session 级）工作期间，B 工具（heuristic）的 done 仍被压制，但 B 工具自己的 activity/waiting 不受影响。

### 4.3 done 自动回 idle

当前单状态机没有自动回 idle（靠 `acknowledge()` 或 30 秒超时在 VS Code 扩展侧）。桌面端 `Aggregator` 里 done 状态会一直保持，直到下一个 activity。

多会话后保持现状：done 不自动超时，靠 `acknowledge()` 统一清除。如果未来需要自动超时，按 session 独立设置 timer。

## 5. 通知与防抖

### 5.1 按来源独立防抖

当前 `lastDoneAt` / `lastWaitingAt` 是全局的，改为 `SessionState` 内的字段，每个来源独立计时。

理由：Claude 完成和 Codex 完成是两个独立事件，不应互相防抖。

### 5.2 最短工作时长门槛

按 session 独立计算：`session.workingSince` 到 done 事件的时长 < `minWorkDurationMs` → 不通知。

`workingSince` 为空（没观察到起点，如探针刚重启）→ 照常通知（与当前逻辑一致）。

### 5.3 notify payload

```typescript
{ type: 'done' | 'waiting'; source: MonitorSource; files?: string[] }
```

与当前一致，`source` 字段已存在，调用方（main.ts）根据 source 做通知文案、聚焦应用、历史记录。

## 6. 托盘展示

### 6.1 托盘标题

当前：`AI Watchdog · ● 空闲 / ◐ 工作中 / ✓ 已完成 / ? 等待输入`

多会话后，working 状态附加活跃数：
- 1 个 working：`AI Watchdog · ◐ 工作中`
- 多个 working：`AI Watchdog · ◐ 工作中 (2)`

### 6.2 托盘菜单

新增"活跃会话"子菜单，列出所有非 idle 的 session：

```
活跃会话
  ├ Claude · 工作中 · 3分12秒
  ├ ChatGPT / Codex · 已完成 · 用时 45秒
  └ Terminal · 等待输入
```

点击某条 → 聚焦对应应用（复用 `focusAppForSource`）。

## 7. 活动历史

存储层不变（`ActivityRecord` 已带 `source`）。展示层增强：
- 历史窗口顶部加来源筛选（全部 / Claude / Codex / VS Code / ...）
- 每条记录已显示来源名称，无需改结构

## 8. API 兼容性

| API | 变化 |
|---|---|
| `currentStatus` | 不变，返回聚合后的全局状态 |
| `workingDuration` | 语义微调（最长 working session），返回类型不变 |
| `onStatusChange` | 不变，全局状态变化时触发 |
| `onNotify` | 不变，payload 已带 source |
| `setMinWorkDuration` | 不变，全局配置 |
| `acknowledge()` | 语义变为"清除所有 done/waiting session" |
| `handleEvent` | 不变，内部按来源路由 |

**无破坏性变更**，现有调用方（main.ts）无需修改即可编译通过。

## 9. 影响面清单

| 文件 | 改动 |
|---|---|
| `aggregator.ts` | 核心重构：单状态机 → Map<source, SessionState> + 聚合 |
| `main.ts` | 托盘菜单加活跃会话子菜单；`acknowledge` 语义不变 |
| `historyWindow.ts` / `history.ts` | 加来源筛选（可选，可后续迭代） |
| `aggregator.test.ts` | 新增多会话用例：并发 working、独立防抖、独立门槛、全局聚合 |

探针、core 包、配置、设置页**无需改动**。

## 10. 测试策略

新增用例（在现有 15 个 aggregator 用例基础上）：

1. **并发 working**：A 和 B 同时 activity → 全局 working，workingDuration 取较长者
2. **独立防抖**：A done 后 0.5s B done → 两者都通知（不跨来源防抖）
3. **独立门槛**：A 工作 5s 后 done（不通知），B 工作 60s 后 done（通知）
4. **全局聚合优先级**：A working + B done → 全局 working（不显示 done）
5. **跨来源仲裁**：A（session）working 时 B（heuristic）done 被丢弃，A 自己的 done 正常
6. **acknowledge 清除所有**：A done + B waiting → acknowledge → 全部 idle
7. **单 session 行为不变**：原有 15 个用例全部通过（回归保障）

## 11. 实施步骤

1. 重构 `aggregator.ts`，保持外部 API 不变
2. 跑现有单测确保回归通过
3. 新增多会话单测
4. `main.ts` 托盘菜单加活跃会话子菜单
5. 构建 + 全量测试
6. （可选）历史窗口加来源筛选
