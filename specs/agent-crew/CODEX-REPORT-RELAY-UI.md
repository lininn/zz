已修复本地代码，**真实 TCP 三件套验收仍受沙箱限制**。

### 修复
- WebSocket 断开后未销毁 `ChannelClient`，导致 RPC 永久 pending；现在立即拒绝挂起请求。
- 目录读取与保存增加 **25 秒兜底**，显示分类错误、保留草稿并提供重试指引。
- 目录失败不再显示成空目录，也不能选择旧路径。
- 修复目录“前往”意外冒泡触发外层保存。
- **relay 无需新增修改；必须更新 Web 构建。**

### 验证
- 服务端 crew **186/186**
- UI **169/169**
- Client **16/16**
- relay **30/30**
- 内存 wire 集成连续三轮通过；每轮真实 TCP 两项因 `listen EPERM` 跳过，**不能算三轮真实 E2E 通过**。
- typecheck、架构、格式、Web build 通过；lint **0 errors / 73 warnings**。
- 375px、768px 浏览器交互抽查通过。

部署步骤、文件清单、兼容性结论及补验命令见 [完整报告](specs/agent-crew/CODEX-REPORT-RELAY-UI.md)。

未 commit、未部署、未修改 `apps/zcode-cli`。