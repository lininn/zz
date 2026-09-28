# Crew 外部 Runtime 改动：构建-部署-验证标准流程

> 本文档规定：任何涉及外部 runtime（Claude CLI / Codex CLI 派工）、crew 服务层、
> crew UI 的改动，声明完成前必须走完的流程。**禁止**只改源码就告诉用户"刷新页面"。

## 0. 生效链路（为什么改动经常"不生效"）

```
用户派工 → Server (packages/server, 跑 dist 构建产物)
              └─ spawn Agent 子进程（detached！server 重启它不会死）
                    └─ tsx 直接跑 apps/zcode-cli/packages/cli/src/main.ts（源码）
                          └─ 但依赖的 @zcode/adapters / @zcode/core 等
                             exports 指向 dist 编译产物 ←★ 改源码必须重新 tsc 构建
              └─ UI (packages/ui) ← vite dev 热更新，改完即生效
```

三个独立的"过期陷阱"：
1. **Agent 子进程 detached**：`pkill entry-http` 杀不掉它，新 server 会复用旧 agent，
   旧 agent 加载的是旧代码。**必须单独 kill agent 进程**。
2. **adapters/core 等 zcode-cli 子包走 dist**：改 src 后必须 `npx tsc` 构建，
   否则 agent 加载的是旧编译产物。
3. **server 自身跑 dist**：packages/server 源码或其依赖（packages/services、
   packages/shared 源码被打进 bundle）改动后必须重新 `npx tsup` 构建。

## 1. 判断改动影响哪些层

| 改动的包 | 需要的动作 |
|---|---|
| packages/shared/src | `npx tsc -b packages/shared`（services 消费其声明产物） |
| packages/services/src | 重新构建 server bundle（`cd packages/server && npx tsup`） |
| packages/ui/src | vite dev 热更新自动生效；非 dev 模式需重新构建 |
| apps/zcode-cli/packages/adapters|core 等 | `cd <该包> && npx tsc` 构建 dist |
| packages/server/src | `cd packages/server && npx tsup` |

## 2. 标准部署步骤（每次改动后全部执行）

```bash
# 1) 构建受影响子包（如 adapters）
cd apps/zcode-cli/packages/adapters && npx tsc

# 2) 构建 server bundle（services/shared 改动时需要）
cd packages/server && npx tsup

# 3) 杀掉所有残留 server + detached agent 进程
pkill -f "dist/entry-http.js --agent-source"
pkill -f "zcode-cli"          # agent 进程名是 zcode-cli，不叫 tsx/main.ts
#   ↑ 注意：桌面端 App 可能也有 zcode-cli 进程，先 ps aux | grep zcode-cli 确认，
#     只杀无 TTY（??）且启动时间晚于桌面端启动的 dev agent。

# 4) 带 crew 环境声明重启 server
cd packages/server
ZCODE_CREW_OUTER_SANDBOX_READY=1 \
ZCODE_CREW_ALLOW_DIRTY_WORKSPACE=1 \
nohup node dist/entry-http.js --agent-source > /tmp/zcode-server.log 2>&1 &

# 5) 验证监听与 ws 握手
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/
curl -s -i --max-time 3 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://localhost:3030/ws | head -1     # 期望 101

# 6) 确认新 agent 是刚拉起的（启动时间应晚于第 4 步）
ps aux | grep zcode-cli | grep -v grep
```

## 3. 自测调用（改 adapter 启动参数后必须做，不等用户派工）

用与派工完全相同的参数/环境直接调用 vendor CLI，验证行为：

```bash
cd <群组绑定的 workspace 目录>
env -i PATH="$PATH" LANG="$LANG" LC_ALL="$LC_ALL" TERM=xterm TMPDIR="${TMPDIR:-/tmp}" \
  claude --print --verbose --output-format stream-json \
  --disable-slash-commands \
  --disallowedTools "Agent,Task,TaskCreate,TaskGet,TaskUpdate,TaskList,TaskStop,Workflow,REPL,Monitor,CronCreate,CronDelete,CronList,RemoteTrigger" \
  --dangerously-skip-permissions \
  "用 Write 工具创建 verify-write-test.svg，内容 <svg/>。写完只回复 done." 2>&1 | tail -1
# 期望：末行 JSON "permission_denials":[] 且文件真实落盘；测完 rm 清理。
```

- claude 路径、ENV allowlist 见 `claude-adapter.ts` 的 `CLAUDE_ENV_ALLOWLIST`
  与 args 数组——测试参数必须与代码里的 args 保持一致。
- codex 同理：`codex exec --dangerously-bypass-approvals-and-sandbox --json ...`。
- 任何探针类改动（preflight/probe）复现方法：用 SystemProbeRunner 相同的
  execFile + 5s/15s timeout 逐条跑 helpProbeArgs/authProbeArgs。

## 4. 故障排查速查

| 症状 | 根因 | 处置 |
|---|---|---|
| Unknown channel: crew | server 跑了旧 dist | `npx tsup` 重建 server |
| outer_isolation_missing | server 缺 `ZCODE_CREW_OUTER_SANDBOX_READY=1` | 带 env 重启 |
| 状态显示"身份验证失败"但 CLI 本机正常 | preflight 任何失败都会汇总成 authentication_failed（external-runtime-service.ts:143）；常见为探测超时 | 排测 probe 各命令耗时；probe 仅展示不拦派工 |
| 改了 adapter 参数但行为不变 | ① adapters dist 未重建 ② detached agent 未杀 | 按第 2 节 1-3 步 |
| 写文件被"权限拒绝" | claude headless 无审批应答通道；write 成员必须 skip-permissions | 确认 args 里有 flag 且 agent 已重建 |
| 执行中途变 cancelled「超过时间预算」 | 群组接力预算（默认 30 分钟）从根请求起算 | 群组编辑里调大「时间预算（分钟）」 |
| 探测通过但新派工仍旧行为 | agent 复用了旧 detached 进程 | kill zcode-cli 进程后重派 |

## 5. 声明完成的最低证据

1. 第 2 节全部步骤已执行且输出符合期望；
2. 第 3 节自测（若改了 vendor 调用参数）通过，附关键输出（如 permission_denials 为空、文件落盘）；
3. `npx tsc -b packages/ui packages/services packages/shared` 无错；
4. 工作日志已记录根因与验证结果。
