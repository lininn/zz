# 任务：修复「创建群组」→ 编辑器打开 → 选择目录回填 链路

用户报（移动端经中转）：新建群组时点「选择此目录」不生效，字段仍是待绑定。

## 已排查事实

1. `CrewWorkspaceField` 组件本身正常：`onSelect → onChange({workspacePath}) → setBinding` 接线正确（代码审查确认）。
2. **playwright 移动端（390×844 isMobile）与桌面视口都无法进入编辑器**：点侧栏「+ 创建群组」后，「选择目录」按钮不存在——**编辑器没有打开**（或主区没切到编辑模式）。这是比目录回填更靠前的断点。
3. 「+ 创建群组」在侧栏树底（`CrewSidebar`），onClick → `crewHome.edit(groupId)` → `CrewHome` 的 `editing` 模式渲染 `CrewGroupEditor`。怀疑：
   - `edit(id)` 只设置选择但 `workspaceMainView` 未切到 crew（桌面停靠视口下主区仍是别的视图/空态）；
   - `editing` 模式下 CrewHome 渲染 CrewGroupEditor 的条件分支有误（如要求 groupId 有会话才渲染）;
   - 移动端抽屉收起逻辑把编辑器渲染打断。
4. 上一个任务（`HANDOFF-CREW-OPEN.md`）修过「会话打开链路」——这次是**编辑模式**链路，可能与该修复有交互回归。

## 要做的事

1. 修复「+ 创建群组」点击后编辑器必然打开（桌面 + 移动端）。
2. 修复「选择此目录」点击后字段回填（在编辑器打开的前提下用 playwright 断言：点击后 Select 显示所选路径；若仍有问题按根因修）。
3. 补测试：侧栏创建群组入口 → 编辑器渲染 → 目录选择回填（桌面 + 移动视口两档）。
4. 移动端专项：抽屉内点「+ 创建群组」→ 抽屉收起 → 编辑器在主区渲染。

## 硬约束

- 复用 `useCrewHomeNavigation`/现有数据层；架构策略；i18n zh/en；不 commit；不动 `apps/zcode-cli`。
- relay 仓库（/Users/lininn/test/zcode-relay）如需改动单独列出文件清单（部署由外部执行）。

## 完成标准

- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过。
- 既有测试不回退（服务端 crew 186 / UI crew 143+ 基线）。
- playwright（本仓库 e2e 脚本模式）实测：桌面 + 390 移动视口，创建群组 → 编辑器 → 选择目录 → 字段显示所选路径，全链路截图入报告。
- 报告（`specs/agent-crew/CODEX-REPORT-EDITOR-OPEN.md`）：根因、改动、自测路径。
