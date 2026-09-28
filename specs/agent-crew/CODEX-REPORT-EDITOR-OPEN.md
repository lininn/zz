**代码修复已完成，但 Playwright 验收受环境阻断，尚未满足全部完成标准。**

### 修复内容
- 确认根因：侧栏「创建群组」误接 `onManage`，实际跳到设置页。
- 新增独立创建导航，无 groupId/详情也能打开主区编辑器。
- 移动端按「打开编辑器 → 切主区 → 收起抽屉」处理。
- 目录回填的真实组件处理器测试通过；绑定失败重试不会重复创建群组。

### 验证结果
- `pnpm typecheck` ✅
- `pnpm lint` ✅，0 errors / 73 warnings
- `pnpm architecture:check --changed` ✅，0 违规
- 服务端 **186/186**、UI **189/189**、客户端 **8/8**、fixture **2/2** ✅

**剩余缺口：**Chromium 启动被沙箱拒绝（MachPort `Permission denied`），桌面/390×844 移动浏览器实测及截图未完成。已交付 Playwright 脚本和复测命令，未将 Node/SSR 测试冒充浏览器通过。

报告：[CODEX-REPORT-EDITOR-OPEN.md](specs/agent-crew/CODEX-REPORT-EDITOR-OPEN.md)

未修改 `apps/zcode-cli` 或 relay 仓库，未 commit。