已完成 P0.1 解耦，**未创建 commit，工作区改动保留**。

- 独立 Agent catalog：CRUD、角色提示词、模型/runtime、权限与工具配置。
- 群成员仅保存引用与权限覆写；支持多群共享，更新后新派工读取最新定义，被引用的 Agent 禁止删除。
- 新增 v5 migration，无损抽取旧定义并保留历史执行快照。
- UI 拆分为「Agent 管理」「群组管理」，同步更新 zh/en。
- 569 个受保护 P1 CLI 源文件哈希一致，未改写 external-runtime 实现。

### 验证
- `pnpm typecheck`：通过
- `pnpm lint`：通过，0 errors、72 条既有 warnings
- `pnpm architecture:check --changed`：通过，0 violations
- 测试：**298/298 通过**，含服务端 74、RPC 5、UI 41、P1 CLI 173、迁移相关回归 5

**验证缺口：**浏览器点击 E2E 和 freshness 远端检查受沙箱限制未完成。外部 runtime 模型仍遵循 P1 的 CLI 配置边界。

已更新 [IMPLEMENTATION.md](specs/agent-crew/IMPLEMENTATION.md)；文件清单、验证记录及保留限制见 [最终报告](specs/agent-crew/CODEX-REPORT-P0.1.md)。