# Crew 经设备中转派工：集成契约

## 范围与验收

本轮验证真实 `zcode-relay` server、connector、ZCode HTTP/WS server、二进制 Channel RPC、CrewService 和 SQLite。外部 blog 用本地 HTTP stub，最终模型执行用确定性 runtime 端口替代；后者不代表真实 Agent/模型执行已通过。额外的 stdio 检查单独验证已有 bundle 的 `session/create`，不重建或修改 CLI。

- relay 与 connector 使用真实入口子进程；端口由 OS 分配（0），配置、凭据、数据库和 HOME 均位于临时目录，测试退出清理。
- 登录、设备选择和业务读取均经过实际中转；不构造/伪造 relay session，不跳过鉴权。
- crew 不是 HTTP JSON RPC：`/ws` 携带 SocketProtocol + ChannelClient 的二进制流。断言必须等到 RPC 返回，不能以手机 WS `open` 或 connector 在线作为成功。
- create/catalog/bind/send/get 经同一通道，消息与 execution 从 SQLite 独立读取确认；相同 messageId 重试/重连不重复执行。
- 覆盖首次详情 >3 秒、UTF-8 大消息（不超过现有 64000 字符产品限制）、旧 session 无设备 cookie 的单设备自动路由、多设备显式选择及失效选择拒绝。
- 开启 ZCode token 鉴权时，HTTP 获取的 ZCode cookie 也必须用于后续 WS 握手；缺失 cookie 仍应拒绝。relay_session/relay_device 不得泄漏给 PC。不得转发或伪造 trusted-host capability。

## 所有者与事件顺序

```text
手机 cookie jar（登录/设备选择；不拥有任务队列）
  → relay：验证 relay_session，按 relay_device 选择账号内设备
  → connector：打开独立数据通道，转发握手与二进制字节
  → ZCode /ws：校验 ZCode token，建立 web-remote-replayable ChannelServer
  → CrewService：唯一业务所有者，以 group/conversation/epoch/messageId 幂等准入
  → SQLite：先落消息/execution/taskId，再调用 runtime
  → runtime：完成后由 CrewService 落最终执行状态及回复
  → RPC get：返回同一所有者的持久化投影
```

Desktop `desktop-continuous` 的 `/ws/host` 能力票据与手机 `/ws` 分开；本轮不修改 owner/lease、stale-run 或 V4 replay 语义。不增加 relay 业务队列、不启动手机专属 Agent、不以延长 timeout 掩盖握手失败。

## 失败语义与兼容

- 只有一个在线设备时，无 relay_device 的旧 session 可自动路由；多设备必须明确选择；失效的显式 cookie 不得悄悄回退另一台 PC。
- WS 外层已打开而内层失败时，RPC 必须在关闭时拒绝，不能永远等待 Initialize。
- relay 只剥离自己的 cookie，保留应用 cookie。connector 只接收允许的 Origin、子协议和应用 cookie，不扩大到任意认证/host 提权头。
- 不修改线上部署；外部 relay 不可写时交付可审查 patch，明确标记未应用。
- TCP 权限受限时真实进程测试报告 skip 与具体错误；内存 duplex 检查是独立补充证据，绝不冒充 TCP/TLS/浏览器 E2E。三轮 skip 不算稳定性验收。

## 验证入口

`ZCODE_RELAY_ROOT` 默认同级 `../zcode-relay`。测试读取该工作树及其已安装依赖，不下载依赖、不访问线上 blog。

```sh
node --import tsx --test packages/server/test/crewRelay.e2e.test.ts
node --import tsx --test packages/server/test/crewRelay.memory.test.ts
```

线上根因只能在复现证据支持下确认；发现 cookie 转发缺陷不能直接推断当前线上一定启用了 token。
