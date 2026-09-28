## 目标

左侧导航（首页工作区侧栏 + 设置页导航栏）的手动展开/收起开关**常驻**：任何屏幕尺寸、任何平台都能点击切换。

## 现状盘点

| 表面 | 平台 | 现状 |
|---|---|---|
| 首页侧栏 | Web（所有视口） | ✅ 并发会话已实现：Web 统一覆盖式侧栏（`useWorkspaceSidebar` 恒为覆盖式 + `DesktopTopOverlay` 左上角常驻开关），收起即隐藏、再点展开 |
| 首页侧栏 | Electron | ✅ 已有开关（mac/Windows 自绘标题栏按钮 + 快捷键 + 拖宽记忆） |
| 设置页 | Web（所有视口） | ✅ 随 hook 修复：所有视口走抽屉 + 常驻开关 |
| 设置页 | Electron 桌面 | ❌ **唯一遗留**：窄窗口强制 68px 图标栏、≥1024 固定 268px，无任何切换开关 |
| SPEC | — | ❌ `specs/mobile-workspace-sidebar/SPEC.md` 仍写"宽屏 Web 初始展开"，与新契约矛盾 |

并发会话正在同一工作树活动（已改 `useWorkspaceSidebar.ts/.test.tsx`、`DesktopTopOverlay.tsx`、`settingsSidebarNavigation.test.ts`）。本计划**不重做其工作**；每次编辑前重新校验文件新鲜度，若撞车则停手说明。

## Phase 1：同步 SPEC

更新 `specs/mobile-workspace-sidebar/SPEC.md`：Web（非 Electron）统一覆盖式侧栏、交互与视口无关、开关常驻、初始收起；删除 1024px 分界断言；Electron 保持桌面分支（拖宽/记忆/快捷键不变）；更新验收场景与时序图。

## Phase 2：Electron 设置页补常驻开关

- **状态所有者**：新增 `packages/ui/src/settings/useSettingsSidebarRail.ts`（会话级 UI 状态，不持久化、不广播）：SSR 安全；默认按视口（≥1024 展开 268px、<1024 缩为 68px 图标栏，兼容现状）；跨断点重置为默认值；toggle 随时可覆盖。附同名测试。
- **`SettingsSidebarNavigation.tsx`**：新增 `rail` prop，`max-lg:` 压缩类改为状态驱动；图标栏模式沿用既有 tooltip；移动抽屉模式不变。
- **`SettingsPageLayout.tsx`**：桌面分支列宽状态驱动（rail ? 68px : 268px）+ 200ms 过渡动画；抽屉分支不动。
- **`SettingsPage.tsx`**：接线 hook；在"回到工作区"同行渲染展开/收起按钮（复用 `PanelLeftClose/Open` 图标与 `workspaceSidebar.toggleSidebar` 文案，`aria-expanded`/`aria-controls`）；页脚显示改为 rail 驱动。
- 测试：扩展 `SettingsPageLayout.test.tsx` 与 `settingsSidebarNavigation.test.ts`（两态渲染、aria、Electron 窄窗口回归）。

## Phase 3：验证（如实报告）

1. `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`（改前先跑基线）。
2. `npx tsx --test` 运行侧栏相关全部测试（含并发会话的 hook 测试，确认整体一致）。
3. 真机/浏览器视觉验收不在本环境，如实说明。

## 备注

宽屏 Web 目前的形态是"收起后完全隐藏、覆盖式展开"（并发会话方向，全视口一致）。如果你更想要"宽屏保持挤压内容布局、收起缩为窄条图标栏"，批准前告诉我，Phase 2 的状态驱动方案可以直接推广到首页。