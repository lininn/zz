# 任务：移动端首页侧栏支持隐藏/展开

用户手机浏览器测试 web 版反馈：首页左侧 WorkspaceSidebar 始终展开、无法隐藏。

## 现状（已排查）

- `packages/ui/src/hooks/useAppPanels.ts:205`：`isSidebarVisible` 初始固定 `useState(true)`，无窄屏分支。
- 桌面收起/展开走 `handleToggleSidebar` + `DesktopTopOverlay` 的按钮与快捷键；收起后宽度动画由 `WorkspaceShellLayout.tsx` 的 `applyWorkspaceSidebarWidth`（CSS 变量）驱动。
- `WorkspaceSidebarCollapsedRail` 组件存在但需确认移动端是否有渲染入口。
- 布局根 grid：`grid-cols-[68px_minmax(0,1fr)] lg:grid-cols-[268px_minmax(0,1fr)]`（SettingsPage 同款断点 lg=1024px 可参考，以 WorkspaceShellLayout 实际断点为准）。

## 需求

移动端（窄视口）首页左侧栏**能隐藏、能展开**：

1. 窄视口下初始隐藏（首屏直接是内容区，不被侧栏挤压）。
2. 提供可达的展开入口：优先复用 `WorkspaceSidebarCollapsedRail`（点击 logo/按钮展开）或等价顶栏按钮；触达区域 ≥ 40px。
3. 抽屉语义：窄屏下从侧栏选中 workspace / 新建任务后**自动收起**，避免遮挡内容。
4. 展开动画沿用现有宽度/CSS 变量机制，不重写布局；展开态如遮挡内容需提供关闭途径。
5. **桌面端行为完全不变**（快捷键、按钮、初始展开、宽度记忆均不得回归）。

## 硬约束

- `matchMedia`/视口读取必须 `typeof window` 保护，web SSR 不能崩（仓库有 SSR 测试）。
- 优先复用现有状态与组件，最小增量；遵守 `architecture-policy.yaml`、单文件 ≤ 400 行。
- 文案优先复用既有 `workspaceSidebar.toggleSidebar`；确需新增走 i18n zh/en 同步。
- 不要 git commit；不得动 `apps/zcode-cli` 下未提交文件。

## 完成标准

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
- 既有测试不回退（服务端 crew 74、UI crew 41、SSR 相关）。
- 为「窄屏初始隐藏 + 选中后自动收起 + 桌面不受影响」补可运行的组件/逻辑测试。
- 报告中说明：改动点、断点选择、手机端自测路径（哪些场景建议用户真机验证）。
