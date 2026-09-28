P1 接入代码和离线验证已落地，**保留工作区改动，未 commit**。

### 已实现
- Crew 按绑定通过既有外部 facade/dispatch 执行，禁止降级到 ZCode。
- 新增 Codex、OpenCode adapter；支持事件归一化、结构化结果、取消及受限 native-session resume。
- 权限请求接入群板；补齐租约隔离、取消竞态、重启恢复和跨 Host 交接保护。

### 最终验证
| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过，0 errors / 72 条既有 warnings |
| `pnpm architecture:check --changed` | 通过，0 violations |
| Crew 测试 | **60/60**，P0 的 40 个无回退 |
| CLI 相关离线测试 | **173/173** |
| UI 测试 | **29/29** |

### 能力与限制
- **Claude 2.1.241、Codex 0.156.1**：已按本机 help 核对并接入。
- **OpenCode 1.18.30**：认证及部分安全能力未通过检查，明确显示不可用。
- 未放宽外层沙箱要求。当前实测 CLI 的权限回复通道未获验证，因此批准禁用；展示和安全拒绝可用，支持批准的端口路径已用 fixture 验证。
- 未做真实网络 smoke 或浏览器/Electron E2E。

文件清单、探测证据、验证命令和遗留问题已更新至 **`specs/agent-crew/IMPLEMENTATION.md`**，详细记录见同目录 `P1-ADAPTERS.md`、`P1-CLI-CORE-REPORT.md`。