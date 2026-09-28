**已复现一个明确断点并交付修复补丁，但尚未完成全部验收。**

### 已确认的缺陷
relay 和 connector 的 WS 握手都会丢弃 ZCode 应用 cookie。**PC 开启 token 鉴权时**，HTTP 登录成功、手机外层 WS 打开后，PC `/ws` 仍返回 401，RPC 无法到达。

补丁保留应用 cookie，同时继续剥离 relay 自身凭据，不修改超时或业务队列。

### 验证结果
- 补丁临时副本：内存 wire 集成连续 **3/3 通过**，覆盖派工落库、大消息、慢请求和重连幂等。
- 既有测试：服务端 **189/189**、UI **147/147**、relay **30/30**。
- typecheck、补充测试类型检查、架构检查通过。
- lint：**73 warnings，0 errors**。

### 未完成项
- 原 relay 目录不可写，**补丁尚未应用到原工作树**。
- TCP 和 Agent IPC 监听被沙箱拒绝，真实 E2E 两项及 Agent 测试一项跳过；不能计作三轮真实 E2E 通过。
- 此缺陷是否就是线上原因仍需确认：若同一连接已有成功的 `crew.get`，它不能解释单独缺少 `crew.send`。

交付：
- [完整报告与后续验证清单](specs/agent-crew/CODEX-REPORT-CREW-E2E.md)
- [双端修复补丁](specs/agent-crew/patches/relay-ws-application-cookie.patch)

未部署、未 commit、未修改 CLI 既有改动；临时副本已清理。