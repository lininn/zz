# 移动端首页侧栏交付与验证

## 实现

- 断点：Web `<1024px`；当前 WorkspaceShellLayout 已采用 flex + CSS 变量，并非旧 grid。沿用 SettingsPage 的 lg 边界；Electron 不按窄视口切换移动端行为。
- 单一显隐状态：`useAppPanels` 调用 `useWorkspaceSidebar`，向 App / shell / 快捷键 / 顶栏共享状态与动作。视口订阅具备 window/matchMedia 保护和稳定服务端快照。
- 入口：在现有 `DesktopTopOverlay` 中加入移动端专用 40px 开关；复用 `workspaceSidebar.toggleSidebar`，不新增翻译、不增加占位 rail。
- 布局：`WorkspaceSidebarPanel` 提取原 panel/aside 包裹层；移动端绝对定位覆盖内容，仍使用原宽度 CSS 变量及 200ms width/opacity 动画。
- 关闭：开关、遮罩、Escape；隐藏 panel 为 inert，展开时底层内容为 inert。收起时必要的焦点回到开关。
- 导航：workspace 草稿、已有任务、新任务（包含 grouped 入口）、new conversation 的既有回调派发后幂等关闭；只读/远程 workspace 校验失败不误关。
- 桌面隔离：移动端不渲染调宽分隔条、不迁移桌面旧版比例宽度；软键盘 resize 不触发桌面“conversation 过窄收起侧栏”策略。宽屏与 Electron 的现有按钮、快捷键和宽度逻辑保留。

## 改动文件

生产代码：

- `packages/ui/src/hooks/useWorkspaceSidebar.ts`（新增）
- `packages/ui/src/hooks/useAppPanels.ts`（接线）
- `packages/ui/src/App.tsx`（接线）
- `packages/ui/src/app-shell/types.ts`（接线类型）
- `packages/ui/src/app-shell/WorkspaceShellLayout.tsx`（panel/导航接线、移动端保护）
- `packages/ui/src/app-shell/WorkspaceSidebarPanel.tsx`（新增）
- `packages/ui/src/app-shell/MobileWorkspaceSidebarToggle.tsx`（新增）
- `packages/ui/src/DesktopTopOverlay.tsx`（移动端入口）

新增测试：

- `packages/ui/src/hooks/useWorkspaceSidebar.test.tsx`
- `packages/ui/src/app-shell/WorkspaceSidebarPanel.test.tsx`
- `packages/ui/test/workspaceSidebarNavigation.test.ts`
- `specs/mobile-workspace-sidebar/e2e/{fixture.tsx,build-fixture.mjs,verify-browser.mjs,README.md}`

所有新增实现/测试文件均小于 400 行；存量超长 App / shell / useAppPanels 仅做接线修改，没有为本任务展开无关重构。没有新增依赖，没有修改 i18n、服务或 CLI。

## 实际验证

| 检查                                                | 结果                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `pnpm typecheck`                                    | 通过，退出码 0                                   |
| `pnpm lint`                                         | 通过，0 errors / 72 warnings                     |
| `pnpm architecture:check --changed`                 | 通过，0 violations / 0 new                       |
| 本次文件 `oxfmt --check`、`git diff --check`        | 通过                                             |
| 新增侧栏回归                                        | **38/38**                                        |
| services crew                                       | **74/74**                                        |
| services crew + client catalog/RPC                  | **79/79**                                        |
| UI crew（包括既有 SSR）                             | **41/41**                                        |
| 离线交互 fixture（真实组件和生产 Tailwind CSS）构建 | 通过                                             |
| 浏览器脚本 `node --check`                           | 通过                                             |
| 浏览器实际点击、视觉/真机验收                       | **未执行成功：ego-browser bootstrap 被沙箱拒绝** |

新增 38 例由 17 个状态/视口/SSR、8 个组件 SSR、13 个真实导航回调逻辑用例组成。导航测试通过 TypeScript AST 提取当前 shell 中实际 useCallback 函数，并注入导航依赖执行，同时校验 JSX 回调接线；不是把测试中的“导航后关闭”当作实现。它不替代完整 App 挂载或 Host 端到端验证。

```sh
TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test \
  packages/ui/src/hooks/useWorkspaceSidebar.test.tsx \
  packages/ui/src/app-shell/WorkspaceSidebarPanel.test.tsx \
  packages/ui/test/workspaceSidebarNavigation.test.ts

node --import tsx --test packages/services/test/crew*.test.ts
node --import tsx --test packages/services/test/crew*.test.ts packages/client/test/crewAgentCatalog.test.ts
TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*

node specs/mobile-workspace-sidebar/e2e/build-fixture.mjs
node --check specs/mobile-workspace-sidebar/e2e/verify-browser.mjs
```

## 限制与建议

- 基线新鲜度脚本已尝试，但 `git fetch origin --prune` 无法写 `.git/FETCH_HEAD`；未获得远端最新基线确认，没有进行合并、rebase 或 commit。
- 浏览器失败为 `Failed to connect to ego_cli bootstrap`，未提权、未绕过沙箱、未伪报 E2E 通过。
- `apps/zcode-cli` 的既有 tracked diff 与任务开始时快照一致；未写入该目录、未处理其他未提交改动。
- 手机自测详见 `e2e/README.md`：优先验证 Safari/Chrome 刷新首屏、选择/新建后的收起、遮罩、软键盘、横竖屏、长名称与深浅主题。桌面真机确认快捷键、调宽/记忆与原生窗口行为。
- 共享 worklog 目录位于当前可写边界外，未写入；本交付记录保存在仓库内。

---

## 设置页侧栏复用：交付与验证

### 改动与兼容边界

- `SettingsPage.tsx` 用同一个 `useWorkspaceSidebar(Boolean(isDesktop))` 持有 UI 显隐；进入窄屏不改变既有 section/偏好，选择当前或其他 section 成功后幂等关闭。plugin origin 清理、导航版本与外部 intent 仍走原逻辑。
- 新增 `settings/SettingsPageLayout.tsx`（70 行）及 `settings/SettingsSidebarNavigation.tsx`（159 行），只提取布局/导航展示，没有新增业务状态或平行抽屉实现。设置页由任务开始时的 1983 行降至 1873 行（本轮 +52/-162），新文件全部 ≤400 行。
- 窄屏 Web 使用共享 Panel/Toggle 的 200ms width/opacity 动画、遮罩、Escape、焦点恢复与 40px 开关；抽屉 268px，外部至少留 48px，内容 inert 且不被挤压，分组文字可见。高度复用外框动态视口，避免手机地址栏裁掉抽屉底部。
- 桌面 Web 与 Electron 仍是原 grid/普通 aside：窄 Electron 68px、大窗口及宽 Web 268px；不套用首页桌面面板的 50% 最大宽度，窗控/返回按钮/页脚规则保留。
- 集成检查确认 `RootWorkspaceContent` 会保留 inert 的底层首页。为避免重复 ID 与错误焦点，共享 `WorkspaceSidebarPanel` / `MobileWorkspaceSidebarToggle` 增加可选 `panelId`，默认仍为 `sidebar`；设置页用 `settings-sidebar`。Escape 跳过 inert 层，焦点按对应 `aria-controls` 返回；首页前台默认行为不变。
- 复用现有 i18n key，没有新增翻译、依赖、持久化、服务/协议修改。保留工作区原有 crew、remote control 等未提交改动；未 commit，未编辑 `apps/zcode-cli`。该目录 tracked diff 与任务开始快照字节一致。

### 实际验证结果

| 检查                                     | 结果                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `pnpm typecheck`                         | 通过，退出码 0                                   |
| `pnpm lint`                              | 通过，0 errors / 72 warnings                     |
| `pnpm architecture:check --changed`      | 通过，0 violations / 0 baseline / 0 new          |
| 原首页侧栏回归                           | **38/38**                                        |
| UI crew（含既有 SSR）                    | **41/41**                                        |
| 新设置页与共享焦点回归                   | **35/35**                                        |
| 上述合并执行                             | **114/114**，无 skip                             |
| 首页及设置页离线 fixture + 生产 CSS 构建 | 通过                                             |
| 两份浏览器脚本 `node --check`            | 通过                                             |
| 本轮文件格式检查、`git diff --check`     | 通过                                             |
| 实际浏览器点击 / 视觉 / 真机             | **未执行成功**：ego-browser bootstrap 被沙箱拒绝 |

新增 35 例由 10 个布局/导航分组/中英文/SSR、16 个视口与真实 section/外部 intent 回调、9 个双层 ID/真实共享 effect 焦点行为用例构成。回调/effect 测试提取并执行生产 TypeScript AST，注入边界依赖，避免在测试中重写被测导航逻辑；但它们不是完整 React 客户端挂载或浏览器 E2E，不能据此声称真机验收通过。

```sh
# 原首页 38 例 + UI crew 41 例 + 本轮 35 例
TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test \
  packages/ui/src/hooks/useWorkspaceSidebar.test.tsx \
  packages/ui/src/app-shell/WorkspaceSidebarPanel.test.tsx \
  packages/ui/test/workspaceSidebarNavigation.test.ts \
  packages/ui/src/crew/*.test.* \
  packages/ui/src/settings/SettingsPageLayout.test.tsx \
  packages/ui/test/settingsSidebarNavigation.test.ts \
  packages/ui/src/app-shell/WorkspaceSidebarPanel.focus.test.tsx

pnpm typecheck
pnpm lint
pnpm architecture:check --changed
node specs/mobile-workspace-sidebar/e2e/build-fixture.mjs
node specs/mobile-workspace-sidebar/e2e/build-fixture.mjs --settings
node --check specs/mobile-workspace-sidebar/e2e/verify-browser.mjs
node --check specs/mobile-workspace-sidebar/e2e/verify-settings-browser.mjs
```

### 真机路径与未验证项

详细步骤和浏览器脚本入口见 `specs/mobile-workspace-sidebar/e2e/README.md` 的「设置页侧栏」章节。

核心路径：手机 Safari/Chrome → 首页侧栏 → 设置 → 当前 section 内容 → 左上角开关 → 选择相同/不同 section 自动收起；再验按钮/遮罩/Escape、两层焦点隔离、中英文/主题、软键盘及横竖屏。桌面检查 ≥1024px Web 与窄 Electron 的原布局、分组、quickpick navigation intent 和原生窗控。

- 新鲜度脚本已尝试，但 `git fetch origin --prune` 无法写 `.git/FETCH_HEAD`；没有合并、rebase 或绕过权限。
- 浏览器实际尝试返回 `Failed to connect to ego_cli bootstrap`（退出码 4），未提权、未换浏览器绕过沙箱。无实际点击、截图、真机或完整服务树验证证据。
- 设置页 fixture 使用真实布局/导航/共享组件，并保留一个 inert 首页面板；section 提交为本地替身，不写真实偏好，也不启动 Host/Agent。
- 共享 worklog 目录在可写边界外，未写入；本章保留仓库内记录。类型：Feature；项目：ZCode；分支：`feat/web-config`；执行者：Codex；原因：复用首页机制去掉移动设置页常驻 rail；关联：本 spec 设置页章节。
