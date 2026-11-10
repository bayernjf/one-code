# one-code（AI Watchdog）深度代码审查报告

> 审查日期：2026-11-02
> 审查方式：只读静态审查 + 实际执行验证门（lint / typecheck / test / build / audit）
> 审查基线：git HEAD `25fce33`（docs: add git commit message convention），工作区无未提交改动

---

## 一、仓库定位与规模概览

**定位**：AI Watchdog —— 监控 AI 编码工具状态、提醒用户回来接管的工具，双形态：

| 层 | 位置 | 技术 | 产物 |
|---|---|---|---|
| VS Code 扩展 | `src/`（18 个 .ts） | VS Code API ^1.85，esbuild 打包 | `dist/extension.js`（实测 86,752 B，minify 后） |
| 共享纯逻辑包 | `packages/core/` | TypeScript，无 vscode/electron 依赖 | `tsc → packages/core/dist` |
| Electron 桌面守护 | `packages/desktop/` | Electron 31.7.7 托盘应用，tsc 双 tsconfig（main + renderer） | `packages/desktop/dist` + electron-builder `release/` |
| 辅助 | `tools/check-migrations.sh`、`scripts/test-runner.mjs` | bash / node | — |

**模块边界**：清晰且方向正确。`@ai-watchdog/core` 承载状态机转移（`transitions.ts`）、滑动窗口检测（`editWindow.ts`）、伴侣协议（`companion.ts`）等纯逻辑，被扩展与桌面端共同复用；扩展经本地 Unix socket / 命名管道把深度信号上报给桌面守护进程（`src/companion/client.ts` → `packages/desktop/src/companion/server.ts`）。git 追踪 110 个文件，`dist/`、`release/` 均已 gitignore 且实测未被追踪（`git ls-files dist` = 0）。

**无数据库**：全仓 `find . -name "*.sql"` = 0，无 `supabase/migrations` 或 `db/migrations` 目录。`MIGRATION_CONVENTION.md` 与检查脚本属预防性资产，当前无校验对象（见 P3-7）。

---

## 二、结论摘要

| 级别 | 数量 |
|---|---|
| P0（可利用安全/数据丢失/宕机） | **0** |
| P1（严重） | **1** |
| P2（质量/性能/依赖健康） | **4** |
| P3（约定/文档） | **8** |

**Top 3**：

1. **P1** 设置页自定义监控目标的 `processPatterns` 未校验，`ProcessProbe` 在 Electron 主进程回调里 `new RegExp(pattern)`，非法正则直接 uncaughtException 崩溃；配置持久化后形成**重启崩溃循环**，UI 无法自救（`processProbe.ts:74`、`settings.ts:238-247`）。
2. **P2** Electron 钉在 `31.7.7`，该大版本已 EOL，Chromium/Node 不再获得安全补丁（`packages/desktop/package.json:30`）。
3. **P2** `npm audit` 实测 40 个漏洞（28 moderate / 11 high / **1 critical：tar** 硬链接路径穿越，位于 electron-builder 等 dev 链；生产依赖 3 个，uuid via node-notifier）。

**正面结论**：所有 shell 调用均走 `execFile` + 固定参数（`focusApp.ts:30`、`soundPlayer.ts`、`main.ts:356`），未发现命令注入面；伴侣 socket 有 32 字节随机 token（0600 文件）+ `crypto.timingSafeEqual` + 64KB 行长上限 + 帧白名单校验（`companion/server.ts`、`token.ts`、`core/companion.ts`）；全部 4 个 BrowserWindow `contextIsolation: true, nodeIntegration: false`；无 `.env`、无硬编码密钥、无 `eval`/`new Function`；lint / typecheck / test / build 四道验证门实测全绿。

---

## 三、逐条发现

### P1

#### P1-1 用户可控正则直接进 `new RegExp`，可导致守护进程崩溃循环

- **位置**：`packages/desktop/src/probes/processProbe.ts:73-76`（`new RegExp(pattern, 'i')` 位于 `execFile` 回调内）；输入入口 `packages/desktop/src/renderer/settings.ts:238-247`（自定义监控目标，逗号拆分后**零校验**）；加载侧 `packages/desktop/src/configStore.ts:25-28`（同样无校验）。
- **影响**：设置页为自定义目标输入非法正则（如 `[`）并保存 → 主进程 3 秒轮询回调内抛 `SyntaxError` → Electron 主进程 uncaughtException 退出。配置已写入 `userData/config.json`，重启后探针重建再次崩溃，形成**崩溃循环**；设置窗口随主进程一并退出，用户只能手动编辑 config.json 才能恢复。正则来自本地用户，无远程触发面，但可用性影响严重且恢复路径差。
- **修复建议**：① `settings:save` IPC 或 `ConfigStore.load/save` 处逐项 `try { new RegExp(p) } catch` 校验，非法项拒绝保存或降级为字面量子串匹配；② `ProcessProbe.poll` 内对正则构造与 `re.test` 加 try/catch 并跳过坏 pattern（坏项只记日志一次）。

### P2

#### P2-1 Electron 31.7.7 已 EOL，运行时无安全补丁

- **位置**：`packages/desktop/package.json:30`（`"electron": "31.7.7"`）。
- **影响**：Electron 官方仅维护最近 3 个稳定大版本；31.x 早已停止接收 Chromium / Node 安全更新。桌面端是常驻进程，会加载本地 HTML 并发起网络请求（updater、webhook、ntfy），长期运行 EOL 引擎风险随时间累积。具体受影响 CVE 清单未逐一核对（未确认）。
- **修复建议**：升级到当前受支持的 Electron 大版本，回归验证托盘、`autoUpdater`（electron-updater 6.3）与 preload/contextBridge 行为。

#### P2-2 依赖漏洞存量 40 个（1 critical / 11 high）

- **证据**：`npm audit`（2026-11-02 实测）输出 `40 vulnerabilities (28 moderate, 11 high, 1 critical)`；critical 为 `tar <=7.5.20` 硬链接/符号链接路径穿越（GHSA-34x7-hfp2-rc4v 等 4 条），经 electron-builder dev 链引入；`npm audit --omit=dev` 为 3 个（2 moderate / 1 high，`uuid` 经 `node-notifier@10.0.1`，GHSA-w5hq-g745-h8pq）。
- **影响**：critical 在打包工具链（构建期解包），生产运行面主要是 node-notifier→uuid（扩展端与桌面端通知库）；不构成直接可利用的远程漏洞，但属明确的供应链卫生欠账。
- **修复建议**：`npm audit fix` 处理非破坏项；node-notifier 升到 ≥12（breaking，需回归通知功能）；electron-builder 链随 P2-1 一并升级。

#### P2-3 配置变更不重建文件监控与伴侣连接，部分设置改了不生效

- **位置**：`src/extension.ts:94-116`（`onConfigChange` 仅处理 `companion.enabled` 与 `enabled` 两个开关）；`src/monitors/fileWatcher.ts:45-64`（watcher 只在 `start()` 时按 `watchPatterns` 创建）。
- **影响**：用户在 VS Code 设置里修改 `aiWatchdog.watchPatterns` / `ignorePatterns` / `monitors.*` / `companion.socketPath` 后，运行中的扩展不重建 watcher、不重连指定 socket 路径，必须 reload window 才生效——与设置项的即时生效预期不符（功能正确性问题，非崩溃）。
- **修复建议**：配置变更回调中对受影响项调用 `stopMonitors()/startMonitors()` 或细化到 watcher 级重建；socketPath 变更时 dispose 并重建 `CompanionClient`。

#### P2-4 Windows 伴侣命名管道无平台级 ACL，token 文件权限依赖默认 profile ACL

- **位置**：`packages/core/src/companion.ts:31-33`（`\\.\pipe\ai-watchdog-companion` 固定管道名）；`packages/desktop/src/companion/server.ts:41-63`（0600 仅 Unix 分支执行）；`packages/desktop/src/companion/token.ts:22-23`（`mode: 0o600` 在 Windows 上为 no-op）。
- **影响**：Unix 侧 socket 文件 0600 + 目录 0700，防护到位；Windows 侧任何本地会话进程理论上都能连接该命名管道，鉴权完全依赖 token 文件机密性，而 token 文件在 Windows 上只靠用户 profile 默认 ACL 保护（通常安全，但弱于 Unix 的显式 0600）。Windows 多会话/共享机场景下同机低权进程若能读到 token 即可伪造伴侣上报（伪造「工作中/完成」信号，干扰通知，不能执行命令）。Windows 侧实际 ACL 行为未实测（未确认）。
- **修复建议**：Windows 下创建管道时传 `pipe` 的 SDDL/ACL（或借助 `named-pipe` 权限选项），最低限度在文档中声明威胁模型为「同用户单机」。

### P3

1. **P3-1 文档命令与实现不符**：`AGENTS.md:19` 与 `README.md:23` 都写 `npm run typecheck`，根 `package.json` 无该 script（实测 `npm error Missing script: "typecheck"`）；CI 实际用 `npx tsc --noEmit`（`.github/workflows/ci.yml:75`）。建议根 package.json 补 `typecheck` script 或改文档。
2. **P3-2 README 技术栈只写扩展**：`README.md:12-16` 未提及 `packages/desktop`（Electron 守护进程）与 monorepo 三构件，新读者会误判仓库形态。
3. **P3-3 「完全本地运行，不上传任何数据」与远程通知能力并存**：`AGENTS.md:7,39`、`README.md:6,41` 为绝对化表述；实现上 `packages/desktop/src/notifiers/{webhook,ntfy}.ts` 提供用户可选的外发渠道（默认空配置关闭，payload 仅来源/时长/文件数，无代码内容）。建议措辞改为「默认完全本地；远程通知为可选且自行配置」。
4. **P3-4 命令 ID 大小写不一致**：`aiwatchdog.takeover`（全小写）与其余 4 个 `aiWatchdog.*` 命令不一致（`package.json:30-34`、`src/extension.ts:208`），已发布后再改属 breaking，至少应在文档中注明原因。
5. **P3-5 `jumpToAIChat` 未处理命令不存在的 rejection**：`src/extension.ts:270-278`，Copilot/Cline 分支的 `executeCommand` 未接 `.then(undefined, …)`，目标命令不存在时产生 unhandled rejection 噪音（默认分支有处理，不一致）。
6. **P3-6 硬编码个人路径**：`packages/desktop/src/workspaceDiscovery.ts:17` 默认扫描根写死 `~/000mycodes`（owner 个人目录习惯），对分发用户无意义且泄露个人信息；建议移除或改为纯文档示例。
7. **P3-7 迁移检查脚本无校验对象且未接 CI**：仓库无任何 SQL/迁移目录时 `tools/check-migrations.sh:38` 直接 `exit 1`（"No migration directory found"）；三个 workflow 均未调用该脚本。建议无迁移目录时退出码 0（"nothing to check"），或在 CI 中条件执行。
8. **P3-8 重复实现**：`packages/desktop/src/main.ts:135-141` 本地重复实现 `formatDuration`，而 `@ai-watchdog/core` 已导出同名工具（`packages/core/src/format.ts`，扩展侧在用）；建议复用 core 实现保持一致性。

---

## 四、验证门实际执行结果

以下均为 2026-11-02 在本机（macOS，沙箱）真实执行，无跳过、无推断：

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run lint`（根，`eslint src --ext ts`） | ✅ PASS | 无告警输出，exit 0 |
| `npx tsc --noEmit`（根，扩展类型检查） | ✅ PASS | exit 0，无错误 |
| `npm run build`（根，esbuild --production） | ✅ PASS | `[watch] build succeeded`，产物 `dist/extension.js` 86,752 B |
| `npm run typecheck --workspace @ai-watchdog/desktop` | ✅ PASS | 两份 tsconfig（main + renderer）均无错误 |
| `npm test`（根 = core build + 全部 workspaces） | ✅ PASS | `tests 73, pass 72, skipped 1, fail 0`（skip 为 fish 语法检查，环境无 fish）；core 单独复跑 `22/22 pass` |
| `npm run typecheck`（根） | ❌ FAIL（预期外） | `npm error Missing script: "typecheck"` —— 证实 P3-1 |
| `npm audit --omit=dev` | ⚠️ 3 个 | 2 moderate / 1 high（uuid via node-notifier） |
| `npm audit`（全量） | ⚠️ 40 个 | 28 moderate / 11 high / 1 critical（tar，dev 链） |
| `git ls-files dist` / `git ls-files` 全量检查 | ✅ | `dist`、`packages/*/dist`、`release/` 均未追踪；无 `.env`、无 `.vsix` 入库 |
| 密钥扫描（api_key/secret/password/sk- 模式，src+packages+tools） | ✅ | 仅命中 settings.html 中 ntfy 占位文案 `my-secret-topic-123`（placeholder，非真实密钥） |
| `tools/check-migrations.sh` 合规性 | N/A | 全仓 0 个 `.sql` 文件，无迁移目录，约定当前无适用对象 |

桌面端 `npm run build`（完整 tsc 构建）与 Electron 打包（`electron-builder`）未执行：前者与 typecheck 同源且 CI 有覆盖，后者产物体积大且与本次只读审查目标无关（未确认其本地可复现性）。

---

## 五、修复优先级建议

| 顺序 | 项 | 理由 |
|---|---|---|
| 1 | P1-1 正则校验 + poll 容错 | 唯一的崩溃级缺陷，且恢复路径最差；改动小（两处校验 + try/catch） |
| 2 | P2-1 + P2-2 Electron 与依赖升级 | 同一轮升级可覆盖 electron、electron-builder（tar）与 node-notifier（uuid），一次回归测试成本 |
| 3 | P2-3 配置变更即时生效 | 用户可感知的功能正确性，改动集中在 `extension.ts` 配置回调 |
| 4 | P2-4 Windows 管道权限声明/加固 | 先补威胁模型文档，再视发布范围决定是否实现 ACL |
| 5 | P3-1/2/3 文档对齐（typecheck script、README、本地运行措辞） | 低成本，避免误导后续协作者 |
| 6 | 其余 P3（命名、unhandled rejection、硬编码路径、check-migrations 退出码、formatDuration 复用） | 顺手清理 |
