# Agent Crew 离线组件交互场景

## 范围

编译真实 `CrewSection`、catalog/group/conversation 组件、hooks 与 providers，使用**内存服务替身**。
不会启动模型、读取用户目录、写用户 catalog 或访问真实 Host。HTML 使用简化 fixture CSS，不代表生产布局验收。

- `verify-browser.mjs`：保留 catalog CRUD、两群共享引用、目录绑定和引用删除保护；建群后显式打开默认会话并验证 conversationId。
- `verify-multiconversation.mjs`：默认/新建会话、编号标题、两会话消息/草稿/审批隔离，晚到 get/send/create 响应及另一会话恢复未决时继续发送。
- `fixture-delays.ts`：按命令及目标 ID 暂停下一次请求，由脚本显式 release；不用定时 sleep 猜测顺序。
- `fixture-conversations.ts`：要求显式 conversationId，支持独立文本消息与可控审批/恢复投影注入；不模拟真实 runtime 执行。
- `test-fixture.mjs`：打包并运行内存服务协议测试。打包使用 UI 的 workspace 依赖解析，不在根目录新增依赖。

这些不是完整应用/SQLite/Host/runtime E2E；生产服务和迁移由 leader 的独立验证覆盖。

## 已执行（2026-09-25）

```sh
TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*
node specs/agent-crew/e2e/test-fixture.mjs
node specs/agent-crew/e2e/build-fixture.mjs
node --check specs/agent-crew/e2e/verify-browser.mjs
node --check specs/agent-crew/e2e/verify-multiconversation.mjs
```

默认输出 `/tmp/crew-p01-browser/index.html`；`build-fixture.mjs <directory>` 可指定输出目录。

## 浏览器脚本（未执行）

在具备授权且浏览器可用的环境中运行，两个场景复用同一任务空间：

```sh
CREW_E2E_SPACE_ID=<existing-space-id> ego-browser nodejs < specs/agent-crew/e2e/verify-browser.mjs
CREW_E2E_SPACE_ID=<same-space-id> ego-browser nodejs < specs/agent-crew/e2e/verify-multiconversation.mjs
```

每个脚本通过 `goto` 加载 fixture，重置独立内存数据。`CREW_E2E_URL` 可指定其他 HTML URL，不需要 dev server。

**点击 E2E 未执行。** Leader 的实际浏览器连接被沙箱中的 `ego_cli bootstrap / NSWorkspace XPC Connection invalid` 阻断。
根据明确指令未重试、未请求 Full Access、未使用其他浏览器/HTTP server 绕过。
脚本语法检查、HTML 打包、Node hook harness 与 React SSR 均不计作浏览器交互通过；也未验证生产 CSS、移动端触摸或真实远端恢复。

## 首页场景（2026-09-25）

```sh
CREW_E2E_HOME=1 node specs/agent-crew/e2e/build-fixture.mjs /tmp/crew-home-browser
node --check specs/agent-crew/e2e/verify-home.mjs
# 同一已授权浏览器 task space，实际点击在本轮沙箱中未能执行：
CREW_E2E_SPACE_ID=<space-id> ego-browser nodejs < specs/agent-crew/e2e/verify-home.mjs
```

`home-fixture.tsx` 使用真实 CrewSidebar/CrewHome 和内存服务，验证打开对话、执行展开/收起、原因显示、发送、复制待绑定群；不是生产 CSS/完整应用 E2E。

`verify-local-preflight.mjs` 启动隔离 HOME 的真实源码 stdio，只有 probe，无任务；本轮因 Unix socket listen EPERM 被阻断。
`verify-runtime-adapters.mts` 直接使用真实 runtime facade，不启动任务；在没有外层隔离声明时，Claude/Codex read/write 均返回 `outer_isolation_missing`。不得将这一执行误记为“可用性通过”。

## 侧栏会话打开回归（本次修复）

- `home-fixture.tsx` 改为调用真实 `useCrewHomeNavigation`，不再用手写 selection 替代导航。预置待恢复执行，`verify-home.mjs` 在**内存 fixture**中点击恢复、取消并核对两个命令的群组/会话 ID；之后仍检查发送及复制。
- `verify-session-open.mjs` 面向完整应用，默认中文 UI、群组「简单任务组」。验证 1440px/390px 的侧栏选择、主区 ID、手机抽屉收起、执行展开及明确的不可用原因。仅只读浏览，不恢复/取消真实用户执行；脚本成功时写出两张展开截图。

```sh
CREW_E2E_HOME=1 node specs/agent-crew/e2e/build-fixture.mjs /tmp/crew-open-work/home-browser
# 已授权的现有 Ego task space；这两条浏览器命令本轮未能执行：
CREW_E2E_SPACE_ID=<space-id> CREW_E2E_URL=file:///tmp/crew-open-work/home-browser/index.html \
  ego-browser nodejs < specs/agent-crew/e2e/verify-home.mjs
CREW_E2E_SPACE_ID=<same-space-id> CREW_E2E_URL=http://localhost:5173/ \
  ego-browser nodejs < specs/agent-crew/e2e/verify-session-open.mjs
```

`CREW_E2E_GROUP_NAME` 可指定其他已存在的测试群组，`CREW_E2E_OUTPUT` 可指定截图目录，默认 `/tmp/crew-session-open`。

本轮只通过打包、语法检查、fixture 协议测试及 Node/SSR 交互回归。浏览器连接再次返回 `ego_cli bootstrap` / XPC 拒绝，本机页面在当前沙箱不可达。**不声称已有手机真机截图或完整应用 E2E 通过。**

## 受控接力场景（2026-09-26）

`verify-relay.mjs` 复用 `home-fixture.tsx`（`?relay=1`）、真实 CrewHome/编辑器/hooks，以及已有内存服务和显式屏障。
覆盖 auto 模式根计划仍须批准、置顶卡、批准/拒绝、下一跳投影、busy 暂停/恢复不重放、编辑 semi/K/分钟预算、普通返程交接、自动 A→B 标识和 hop8 固定原因。
`seedRelay` 只是可控服务投影注入，不解析标签、调用模型或声称验证后端预算/派工正确性。

```sh
CREW_E2E_HOME=1 node specs/agent-crew/e2e/build-fixture.mjs /tmp/crew-relay-browser
node --check specs/agent-crew/e2e/verify-relay.mjs
node specs/agent-crew/e2e/test-fixture.mjs
# 仅在既有授权浏览器可用时由 leader 执行：
CREW_E2E_SPACE_ID=<space-id> CREW_E2E_URL=file:///tmp/crew-relay-browser/index.html \
  ego-browser nodejs < specs/agent-crew/e2e/verify-relay.mjs
```

**浏览器测试未执行。** Leader 已尝试一次，返回 `ego_cli bootstrap / NSWorkspace XPC Connection invalid`。
本 executor 不重试浏览器、不启动替代浏览器、不使用 HTTP 绕过。Node 回调测试、脚本语法检查和 HTML 打包不能计作浏览器/手机交互通过。

## 首页创建编辑器与目录回填（2026-09-26）

`verify-editor-open.mjs` 是 **Playwright / 完整应用** 回归脚本，不使用 Ego fixture 代替生产 Shell。
使用当前环境已提供的 `playwright-core`；本次未新增依赖。需要运行中的完整 Web 应用、可启动的 Chromium 和已配置的测试登录态。

```sh
# 默认 http://localhost:5173/；输出可指向报告旁的证据目录。
CREW_E2E_OUTPUT=specs/agent-crew/evidence/editor-open/browser \
  node specs/agent-crew/e2e/verify-editor-open.mjs
# 可选环境变量：
# CREW_E2E_URL             完整应用入口（支持测试用中转入口）
# CREW_E2E_EXECUTABLE      当前环境已安装、可启动的 Chromium 可执行文件
# CREW_E2E_STORAGE_STATE   测试登录态 JSON 文件路径（不提交到仓库）
# CREW_E2E_DIRECTORY       需要选择的既有测试目录；省略则选择实际 homedir
node --check specs/agent-crew/e2e/verify-editor-open.mjs
```

每次创建独立的 1440×900 desktop 和 390×844 `isMobile/hasTouch` context；中文/英文选择器均支持。
断言：侧栏群组 tab → 创建（不能跳设置）→ 无 groupId 的主区编辑器 → 选择目录 → 选择此目录 → 有关联 label 的 combobox 精确显示所选路径。
手机额外断言 sidebar `inert`，并保留表单名称，防止目录浏览提交造成整页刷新/误保存。可选测试目录还会覆盖输入路径后的「前往」提交。
测试最后取消草稿，不点击保存、不创建持久群组、不执行 Agent。

成功时产出 `results.json` 和 desktop/mobile 各四张阶段截图（`01-create-entry`、`02-editor`、`03-directory`、`04-filled`）；失败时记录失败阶段并尽可能截取现场。截图可能包含测试环境已有群组名和路径，仅在审查后共享。
`home-fixture.tsx` 同时接入真实 `navigation.create`，但它仍是内存服务/简化 CSS 的组件 fixture，不可替代完整 Shell 或 relay 验收。

**本次未执行浏览器场景，未产出截图。** Playwright 预检先发现默认 revision 未安装；使用已安装 Chromium 启动后被 macOS 沙箱拒绝 MachPort 注册（Permission denied）。未绕过权限或更换工具重试。已执行脚本语法检查、fixture 打包与 Node/SSR 回归；实际阻碍见 `../evidence/editor-open/browser-blocker.txt`，结论见 `../CODEX-REPORT-EDITOR-OPEN.md`。
