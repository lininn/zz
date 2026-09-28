已实现，**未提交 Git commit**。

- 同一群组可创建多个对话，共享成员、权限和 workspace 绑定；消息、执行、审批、恢复及运行时上下文按会话隔离。
- v6 将旧历史迁入固定默认会话，保留历史字段与原生会话续接兼容；迁移回滚、幂等和重复初始化测试通过。
- workspace 租约仍全局互斥，未按会话拆锁。
- UI 增加会话列表、新建与切换，zh/en 已同步。

### 验证结果

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 errors，72 条既有 warnings |
| 架构检查 | 0 violations |
| 服务端 Crew | **97/97** |
| UI Crew | **57/57** |
| 侧栏回归 | **81/81** |
| RPC/共享契约 | **8/8** |

`apps/zcode-cli` 原有 **77 个未提交文件哈希未变**。Crew 源文件均不超过 400 行。

### 交付文档

- 实现记录：`specs/agent-crew/IMPLEMENTATION.md`
- 改动清单、迁移策略及真机自测路径：`specs/agent-crew/CODEX-REPORT-CREW-CONVERSATIONS.md`

**验证缺口：**真实浏览器连接被沙箱阻断，未完成真机点击 E2E 或真实 vendor CLI smoke；离线 fixture 已构建，E2E 脚本已提供，未将其算作真机通过。