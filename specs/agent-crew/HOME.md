# 群组首页 / 工作群界面

日期：2026-09-25。基于当前工作区，保留 CLI 未提交改动，不改 `apps/zcode-cli`，不提交。

## 产品与边界

- 首页侧栏沿用一级视图切换：分组、项目、群组。群组树以 `workspaceIdentity?.trim() || workspacePath` 分项目，未绑定独立归组；群组下列出独立对话与状态。提供新建对话、复制为待绑定群、编辑、删除。
- `workspaceMainView = crew` 显示会话头、成员、按发送者连续分组的群聊消息、@ 交接、高亮接收者、可折叠长回复及原 CrewComposer。设置页继续负责 Agent/群组配置。
- 执行条保留历史成员快照、状态、耗时/runtime，展开只读过程，不离开群聊。ZCode 使用现有 V4 task timeline；外部 runtime 读取已有归一化事件/持久投影。若当前协议未暴露事件，不伪造过程：明确显示“详细过程不可用（原因）”，可以展示真实状态/摘要但不得称为事件流。
- 侧栏在窄屏沿用现有抽屉，点击对话关闭抽屉；主区独立滚动，输入区不被挤出。zh/en 同步，新增文件不超过 400 行；已有大型装配点仅作最小增量。

## 状态所有者与时序

```text
侧栏选择（UI 局部 groupId/conversationId）
    → useCrew / crewRequestScope → CrewService → 既有 SQLite / runtime
                                  └── SWR 只读投影 → 树 / 群聊 / 执行条

发送 / 复制 / 编辑 → 既有 RPC → 原 owner/lease、串行 admission → 持久状态
    → 刷新同 service scope 的投影；迟到结果不得选中或清空新会话
展开执行 → 校验 group + conversation + execution → 该执行绑定的 runtime/task
    → 只读过程；折叠/换会话停止读取；缺失、错误、过期都显示原因

desktop continuous ─┐
                   ├─ 原有 Host owner + 序列；不新增 Agent/Host/队列
mobile replayable ─┘
```

唯一业务事实源仍为 CrewService/现有运行时。首页不另建业务 store，service scope 随连接实例隔离；workspace path 仅用于 IO，identity 用于分组/请求关联。执行详情遵守执行快照绑定，不随群组后续重绑跳到另一个项目。请求不推进 runtime、不重放任务、不改变权限/恢复边界。

## Preflight

先用实际 server/Agent 调用和 binary 解析证据定位，不以怀疑代替结论。保留父进程 PATH 与已有覆盖变量，解析修复不得绕过工作区或运行时安全检查。若缺少 runtime bridge/启动依赖，应报告真实原因；本机已安装不等同于某远端 Host 已安装。通过本机 Web 同链路验证 claude/codex 的可用性，无凭据/真实任务外发。

## 验收

- 回归覆盖项目 identity 分组、未绑定、会话选择/失败状态、复制/编辑/删除命令与迟到结果隔离。
- 消息连续分组、历史成员名、@ 交接、长回复折叠、执行条展开/收起及不可用原因。
- 保持既有 crew 服务/UI/侧栏测试，实际运行 typecheck、lint、architecture changed。
- 浏览器验证首页 tab → 项目 → 群组 → 对话、执行详情、窄屏抽屉与 preflight；环境阻碍明确记录，不把静态检查当真机通过。

## 执行读取契约 / 状态投影

`crew.readExecution({groupId, conversationId, executionId})` 先验证所属关系，始终使用执行快照中的 binding/taskId。返回 execution、真实 runtimeTask（可空）和有限原因码；不执行任务、不新增业务持久状态。ZCode 详情只 peek 同 service/endpoint/task 的已存在 V4 projection，复用只读 timeline 渲染，不 acquire/subscribe/rowsRange/冷恢复；缺少现成投影显示明确原因，已有窗口不完整时提示更早历史不可被动读取。普通 rows/range 即使 existing-only 也会运行 SessionStart，不能用于本任务的无副作用详情。外部 bridge 目前仅有 task state/summary，没有事件 query；遵守不改 CLI 的约束，展示真实摘要并明确 `externalEventsUnavailable`，不声称存在逐步事件。

会话状态为派生值：任一 recovery_required > 任一 queued/running > 最后创建执行 failed > idle。失败不锁定重新派工；后续成功清除失败徽标。群组整体状态/租约规则不变，无数据库迁移。

可见读投影在 idle 时每 5 秒、active 时每 2.5 秒刷新，用于发现其他客户端新消息/执行；页面隐藏、侧栏群折叠、详情关闭时不轮询。此轮询只读事实，不参与 admission/完成判定，不是同步超时兜底。

设置覆盖时保留原 SWR key/读缓存和 Composer 子树以保留草稿，暂停 fetcher/轮询并卸载详情查询；恢复时即时刷新当前 key。跨 Host/key 仍不得复用旧投影。

## 首页新建模式补充（2026-09-26）

「创建群组」从侧栏直接打开主区的全新群组编辑器，不跳设置页；设置仍由「管理」入口进入。新建意图由 useCrewHomeNavigation 持有且不依赖 groupId 或会话详情，手机收起抽屉后保留。选择目录立即更新表单草稿，仅保存时调用既有 create/update/bind；绑定失败重试复用创建成功返回的群组 ID。完整状态、时序与验收契约见 `packages/ui/src/crew/SPEC.md` 的「首页创建编辑器与目录草稿回填」。
