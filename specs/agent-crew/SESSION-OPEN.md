# 侧栏会话打开与缺失投影

补充 `HOME.md`、`CHAT-HOME.md`；只修改共享 UI，不修改 CLI、RPC 或业务状态所有者。

## 产品规则与唯一所有者

- `useCrewHomeNavigation` 仅持有当前 Host 下的群组、会话和编辑意图；不复制服务端状态。会话按钮传入精确的 `groupId + conversationId`，群组按钮只展开/收起。
- `CrewService` 仍为群组、消息、执行、恢复和取消的事实源；`useCrew` 负责按 Host/群/会话隔离缓存并校验读结果。
- 只有未选择群组/会话时才显示「从左侧选择…」。已选择后的加载、读取失败、目标不存在、无有效投影必须可区分，错误可刷新，不能静默回到未选择空态。
- `recovery_required` 不阻止读取群聊；恢复及取消仍调用既有 controller，保留 pending 与目标 ID 校验，不因打开页面自动恢复执行。
- 主区详情读取不受侧栏 `readDetail=false` 或手机抽屉收起影响。设置覆盖只暂停读取；恢复可见后重读，不能显示其他会话的旧数据。
- ZCode 执行展开复用现成 V4 投影；缺失、断连或读取错误明确显示原因，不通过冷恢复伪造过程。外部 runtime 只显示真实摘要/状态。

## 事件顺序

```text
会话按钮（非群组展开按钮）
  → useCrewHomeNavigation.select(groupId, conversationId)
  → workspaceMainView = crew
  → 手机：收起抽屉（只改变侧栏可见性，不清除选择）
  → CrewHome → useCrew(..., readDetail=true)
  → SWR[Host, groupId, conversationId] → CrewService.get
  → 校验返回群组、会话归属及结构
      ├─ 有效 → CrewChatView（消息 + 执行折叠条 + 恢复/取消）
      └─ 失败/缺失 → 本地化错误与手动刷新，绝不渲染其他会话
```

Desktop continuous / mobile replayable 均复用原 Host、owner/lease、CommandInbox 及重连链路；不新建 runtime、队列或持久化字段。过期请求只写自己的 SWR key；换 Host 使旧导航失效。

## 回归与验收

1. 未选择 → 群组展开不导航 → 点击默认会话 → 精确 ID 传给主区 → 恢复状态仍渲染消息/执行。
2. 桌面不收起侧栏；手机收起侧栏后选择不变、主区继续读取；关闭的抽屉不因重复选择反向打开。
3. get 拒绝、错误群/会话、缺失/畸形响应：有明确本地化提示，不泄露异常原文、不渲染旧群聊；刷新成功恢复群聊。
4. 读取期间只显示加载；成功切换会话不被旧响应覆盖。相同 Host 选择保留，Host 切换隔离。
5. 执行折叠条仅展开时读取详情；V4 可用/不可用、恢复/取消参数与 pending 回归均覆盖。
6. 浏览器复测包括完整首页桌面和 <1024px 手机抽屉；Node/SSR 与离线内存 fixture 不冒充真机验收。
