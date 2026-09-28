# 任务：设置页侧栏支持移动端展开/收缩

刚完成「移动端首页 WorkspaceSidebar 隐藏/展开」（见 `specs/mobile-workspace-sidebar/VERIFICATION.md` 与 `CODEX-REPORT-MOBILE-SIDEBAR.md`）。现在把**同样的交互**应用到设置页。

## 现状

- `packages/ui/src/SettingsPage.tsx`（约 1382 行）：布局 `grid-cols-[68px_minmax(0,1fr)] lg:grid-cols-[268px_minmax(0,1fr)]`，窄屏下 68px 图标列常驻，无法收起。
- 首页机制已存在：`useWorkspaceSidebar` hook + `WorkspaceSidebarPanel`（窄屏 <1024px 初始隐藏、顶栏 40px 按钮、覆盖式展开 + 遮罩/Escape 关闭、选中后自动收起、桌面不启用）。

## 需求

1. 窄屏（<1024px）设置页侧栏**可隐藏、可展开**，交互模式与首页侧栏**完全一致**（断点、动画、关闭途径）。
2. **必须复用**刚落地的 `useWorkspaceSidebar` / `WorkspaceSidebarPanel`（或将其泛化为共享组件后两处复用），禁止再写一套平行实现；若需泛化，保持首页行为零变化。
3. 窄屏下进入设置页：侧栏初始隐藏，先看到当前 section 内容；点开侧栏选择目标 section 后自动收起。
4. 桌面端（≥1024px 及桌面应用）行为零变化：68px→268px 响应式、分组渲染、导航 intent 均不得回归。

## 硬约束

- SSR 安全（`typeof window` 保护），既有 SSR 测试不得回退。
- 架构策略、单文件 ≤ 400 行（SettingsPage.tsx 已超限历史豁免，不新增超限文件）。
- 文案复用既有 key；新增走 i18n zh/en。
- 不 commit；不动 `apps/zcode-cli`。

## 完成标准

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
- 新增设置页窄屏行为测试（初始隐藏/选择后收起/桌面不变），并复跑：侧栏 38 例、UI crew 41 例不回退。
- 更新 `specs/mobile-workspace-sidebar/VERIFICATION.md` 或新增对应章节，报告改动点与真机自测路径。
