# 群组任务受控自动接力

## 产品规则

- 只读取成功执行的最终回复中的最后一个 `<crew-handoff>{"to":"成员名","objective":"任务","context":"上下文"}</crew-handoff>`；自由文本 @、流式片段、工具输出不派工；最后标签损坏、无标签则结束。to 必须唯一匹配当前群成员名称。
- 当前成员模型没有 PM 角色字段，不猜测名字/提示词。用户直接点名的根执行（hop=0）是该请求的规划者；它产生交接即视为计划，任何模式都必须人工批准。后续交回该成员是汇总而非新计划，不重复强制审批。
- 标签协议一次只描述一个下一站；计划正文可包含完整拆解，确认卡显示计划摘要和本次分配，后续分配由成员继续声明。多个标签不是并行任务列表，明确只取最后一个。
- manual 每次交接待批准；semi 下一跳 hop<=K 自动，K 默认2；auto 在计划批准后自动。群 relayPaused 暂停后不得再创建下一跳，既有执行可取消；暂停期间完成的交接保留待批准，恢复开关不偷偷重放待审批交接。
- hop 从根执行0开始，最大8；根请求首次创建到下一跳准入的墙钟时间不得超过 relayBudgetMinutes（默认30）。所有模式及人工批准都执行预算、重复目标+标准化目标指纹、成员可用性、epoch、恢复隔离检查。
- runtime失败/取消/恢复未决均停止链。recovery_required 时不允许自动或人工派工；恢复检查绝不重新发送已有task输入，也不自动处理持久化待审批交接。权限沿用原审批通道。

## 所有者与边界

CrewService 唯一决定交接；SQLite 的既有 execution 保存 rootRequestId/hop/relay（kind、status、目标、objective、context、原因）；UI 只读取投影和发 respondRelay 命令。不增加队列或runtime执行通道。

```text
用户 @规划者 -> send/enqueue(root, hop=0) -> runtime -> finish 成功
                                                  | 最终标签
                                                  v
                                  execution.relay awaiting_user_approval
用户批准 -> respondRelay -> 复查恢复/epoch/预算/runtime -> enqueue(root,hop+1,to)
                                                           |
                                         runtime -> finish -> 模式/预算决策
                                                    | auto    | manual/semi超额/暂停
                                                    v         v
                                               同一enqueue    awaiting_user_approval
```

- finish 与交接提案同事务提交；自动派工前异步probe后再次在写锁内复查，避免暂停/取消/恢复期间晚到结果越界。
- 幂等键使用 rootRequestId+hop+目标成员的稳定hash，沿用消息唯一键及 enqueue。根隔离始终包含 groupId/conversationId。
- 成员runtime快照、workspaceIdentity、remoteSessionId、owner/lease和stale run判断保持原路径。
- Desktop continuous 与手机 replayable 都读相同 CrewService 投影/命令，不在Main/relay或UI储存链真相。

## 数据与合同

v7 新增 group relay_mode(manual默认)、relay_auto_hops(2)、relay_budget_minutes(30)、relay_paused(false)；execution root_request_id(旧数据回填message_id)、hop(0)、relay_json、relay_objective_hash。保留冻结v4/v5/v6及checksum，v7加入迁移账本。

公共协议新增可选读投影字段以兼容旧fixture/客户端，服务端始终填充；create/update 支持接力设置。`respondRelay({groupId,conversationId?,executionId,approved}) -> CrewExecution`，重复同决定幂等，不同决定拒绝。会话状态增加 awaiting_user_approval，由pending relay派生，恢复未决优先。

relay 投影：`{kind:'plan'|'handoff',status:'awaiting_user_approval'|'dispatched'|'rejected'|'blocked',to,toMemberId?,objective,context,automatic?:boolean,reason?:string}`。拒绝/熔断终止，不复活旧交接。错误原因是固定i18n key，不包含异常原文。

## 验收

计划批准/拒绝和返PM不重复审批；auto全链；manual不自动；semi K边界；hop8、30分钟、重复指纹、runtime不可用；恢复隔离；暂停/取消与异步probe竞态；重复批准幂等；迁移保留旧数据；UI双语、计划卡置顶、A→B标识、预算与系统原因。

真实手测：建群选auto并绑定workspace -> @项目管理提需求 -> 检查计划卡且成员尚未执行 -> 批准并开始 -> 观察成员派工及交回PM -> 暂停/恢复、拒绝、取消与熔断提示。

### 取消与读取投影补充

- v7另持久化 `relay_cancel_requested`：在await原生取消之前记录意图；它仅阻止后继，不能替代已停止证明。这样取消与成功回调竞争时不会新增派工。未证明停止的task仍保持既有恢复隔离。
- 执行队列claim在暂停时跳过后继hop；恢复开关只调度已接受但尚未创建task的queued，不自动批准pending提案。
- 为保持400行边界，把既有群详情能力/权限读取移到crewExecutionDetail的纯投影装配函数；既有106条服务回归锁定原行为。
- 活动task同时安装基于根请求墙钟deadline的停止预算；到期调用同一runtime.cancel，停止已证明才落cancelled，失败转recovery_required。timer不承担任务排序/同步职责。

### 控制切换失效与预算快照

- 每个待审批交接持有 `admissionRevision`。群暂停/恢复切换、会话进入或处理恢复隔离时，在同一写锁内推进受影响提案版本。预检返回后必须与起始版本一致，否则只保留人工待审批，不因开关恢复而继续旧自动准入。新一次显式审批才可重新预检。
- 预算在根请求创建时冻结为 `relay_budget_minutes_snapshot`（v7新增，旧执行30分钟）；同链后继沿用快照。群设置修改只影响之后的新根请求，不追溯改变活动链。准入判断与活动timer都使用同一根预算快照。
- 人工批准在异步预检期间遇到已提交拒绝，返回 `crew.relayDecisionConflict`；同决定重复批准保持幂等。
