已落地 **Agent Crew P0 本地垂直切片**，保留在 `feat/web-config` 工作区，**未 commit**；原有 external-runtime、bootstrap、command-center 改动未覆盖。

### 主要改动
- `packages/shared`：严格校验的 Crew 协议与类型。
- `packages/services`：五张独立表的 migration、CrewService、配置复制与重绑、ZCode 执行、全局租约、持久化恢复及幂等防护。
- `packages/ui`：设置入口、角色编辑、目录绑定、`@` 成员选择、群板和执行状态，以及中英文文案。
- 补充行为 spec、测试和实现报告。

### 验证结果
- `pnpm typecheck`：通过
- `pnpm lint`：通过，0 errors、72 条既有 warnings
- `pnpm architecture:check --changed`：通过，0 违规
- 后端测试 **40/40**、UI/helper/SSR **14/14**、既有回归 **5/5**：全部通过
- 定向格式检查、`git diff --check`：通过；新增文件最大 346 行

### 已知边界
- 未执行真实模型调用及浏览器/Electron/手机 E2S 测试。
- 当前只读任务也保守串行；跨群租约冲突返回明确失败，不自动重试。远端 binding 明确拒绝。
- Windows 无法证明旧进程树已退出时保留 `recovery_required`，不冒险抢锁。
- 基线 freshness 检查因 `.git/FETCH_HEAD` 写权限受限未完成。

详细文件范围与验证记录：`specs/agent-crew/IMPLEMENTATION.md`。