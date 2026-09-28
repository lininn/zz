# 手机远程控制 PC 链路架构（zcode-relay）

> 目标：手机浏览器访问公网页面 → 用 blog 账号登录 → 操作家里 PC 上运行的 ZCode。
> 背景：原有"登录/手机控制"绑死智谱云（z.ai OAuth，token 由 `zcode.z.ai` 签发），智谱侧失效后不可用。
> 本文记录自建链路的架构、协议与部署，代码位于独立项目 `/Users/lininn/test/zcode-relay`（部署 kd1 `/opt/zcode-relay`）。

## 一、总体架构

```
手机浏览器（任意网络）
   │  HTTPS：登录 cookie + 页面/静态资源 + REST
   │  WSS：ZCode RPC（packages/rpc 二进制协议，长连接）
   ▼
relay-server（kd1 公网服务器，Docker host 网络，:8787）
   │  ① 登录：回源 blog 验证（同机 127.0.0.1:3001 /api/relay/auth）
   │  ② 托管 ZCode web 构建产物（web-dist/，登录 gate 后）
   │  ③ 反向代理：未命中静态的路径全部经隧道转发到 PC
   │  ▲ 出站 WSS /connector?token=PAIR_TOKEN（PC 主动外连，穿 NAT，断线重连）
   ▼
connector（家里 PC，launchd 自启）
   │  HTTP → http://127.0.0.1:3030（原样转发）
   │  WS   → ws://127.0.0.1:3030/ws（双向透传）
   ▼
ZCode server（PC 本地，packages/server，Hono :3030）
   └─ RPC services：工作区、任务、文件、终端……（packages/rpc 协议）
        └─ AI 模型调用不出 PC：走 --web-config 自定义 Provider（API key 本地）
```

### 设计决策

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 登录体系 | 回源 blog 验证，不自建用户库 | blog 有现成 `users.accessToken` 机制；账号只维护一份 |
| 模型调用 | `--web-config` 自定义 Provider，流量不出 PC | 智谱 OAuth 失效；key 本地存放，中转只转发控制指令 |
| PC 接入方式 | connector 主动出站 WS | PC 在 NAT 后；避免 frp 等额外组件，3030 不裸露公网 |
| 中转代码 | 独立项目 zcode-relay | 与 ZCode 主仓库解耦，Node 22 容器化部署（kd1 宿主 Node 仅 v12） |
| ZCode web | 构建产物直接托管，零代码改动 | `bootstrapWebApp` 不 gate OAuth，直连 `ws(s)://host/ws`（packages/web/src/main.tsx） |

### 与 ZCode 仓库的关系

- **直接复用（无改动）**：
  - `packages/web`：移动端控制台（Vite 构建，产物放 relay 的 `web-dist/`）
  - `packages/server`：PC 本地 server（Hono，`/ws` RPC 通道、`/api/*`）
  - `packages/rpc`：VSCode 风格二进制 RPC 协议，经隧道透传
- **不需要**：z.ai OAuth 全链路（`packages/services/src/oauth/`、`packages/web/src/auth/` 仅分享页使用）
- **模型 Provider**：`--web-config` 写入 `~/.zcode/v2/provider_config.json`，PC 端直连自选 Provider

## 二、认证与身份绑定

**模型：账号只能控制自己登录的 PC。**

1. PC 本地默认不登录、远程控制默认关闭（opt-in）：跑一次 `node src/connector/login.js` 输入 blog 账号 → connector 经 relay 向 blog `/api/relay/auth` 验证 → relay 把「PC ↔ 账号」绑定持久化（`data/binding.json`），本地凭证存 `data/connector-credentials.json`（600）
2. connector 每次重连都会向 relay 重新证明身份（bind 帧 → blog `/api/relay/verify`）；凭证失效则要求重新登录
3. 关闭远程：`node src/connector/logout.js`（解绑 + 清凭证）
4. 手机 `POST /login`：blog 验证通过后，relay 校验**登录账号 === PC 绑定账号**，不一致 403（`账号不匹配：本电脑绑定的是「X」`），未绑定 403（远程控制未开启）
5. relay 签发 HMAC-SHA256 签名 cookie（`relay_session`，7 天，HttpOnly/SameSite=Lax/Secure），内含 blog token；session cookie 不透传给 PC
6. connector ↔ relay 用 `PAIR_TOKEN` 配对（query 传入，timing-safe 比较），控制/数据/登录三通道均校验
7. blog `/api/relay/auth` 默认仅 admin（`RELAY_ADMIN_ONLY=1`）；kd1 生产已设 `RELAY_ADMIN_ONLY=0`——普通用户也能绑定**自己的** PC，但控制不了别人的。accessToken 复用稳定值（PC/手机共用一份），吊销走 blog refreshToken 轮换

限流：relay 登录 10 次/分/IP（内存）；blog 侧 relay 接口 10 次/分/IP（express-rate-limit）。

## 三、隧道协议 v1（src/shared/protocol.js）

- **控制通道**：connector → relay `GET /connector?token=`（单实例，重连顶旧）
  - relay → connector 文本帧：`{ t:'open', id, kind:'http'|'ws' }`
- **数据通道**：connector → relay `GET /connector-data?token=&id=`，与手机请求一一配对
  - 全部二进制 ws 帧 + 1 字节前缀：`0x00`=协议帧(JSON)、`0x01`=二进制数据、`0x02`=文本数据
  - http：relay 发 `{t:'req',method,path,headers}` → 0x01 体块 → `{t:'req-end'|'abort'}`；connector 回 `{t:'res',status,headers}` → 0x01 体块 → `{t:'res-end'|'abort'}`
  - ws：`{t:'req',path,headers}` 之后双向 0x01/0x02 原样透传（文本/二进制保真），一侧关闭对端同步关闭
- 逐跳头过滤；relay session cookie 剥离；`x-forwarded-for` 补写
- PC 离线：HTTP 返回 502 提示页，WS 关闭码 1013；通道建立超时 10s
- ⚠️ 踩坑记录：早期版本用"文本帧=协议、二进制帧=数据"，WS 透传时手机的文本消息会被误当协议帧解析导致通道断开 → 改为前缀分帧后全链路测试通过

## 四、部署拓扑（kd1 = k.d-1.top → 68.64.181.33）

| 组件 | 位置 | 端口 | 说明 |
| --- | --- | --- | --- |
| blog（生产） | kd1 `/web/blog`，pm2 `blog-3001` | 3001 | MySQL；已加 `controllers/relay-auth.js` + 路由 |
| relay-server | kd1 `/opt/zcode-relay`，Docker host 网络 | 8787 | `.env`：BLOG_API_URL/PAIR_TOKEN/COOKIE_SECURE |
| openresty（1Panel） | kd1 | 80/443 | TLS 终结，站点 `pc.d-1.top` → 127.0.0.1:8787（1Panel 面板创建） |
| connector | 家里 PC | — | launchd `top.d-1.zcode-relay-connector`，KeepAlive，出站连 `wss://pc.d-1.top` |
| ZCode server | 家里 PC | 3030 | `packages/server`，Provider 用 --web-config 配置 |

`.env` 关键项见 `/opt/zcode-relay/.env`（600 权限）；PAIR_TOKEN 同步配置到 PC connector。

## 五、关键文件索引

**zcode-relay 项目**
- `src/server/index.js` — express + WS 升级路由（/connector*、/connector-login、手机侧鉴权）
- `src/server/auth.js` — blog 回源登录 + 绑定校验、HMAC cookie 会话、限流
- `src/server/tunnel.js` — connector 注册表、控制/数据通道、openChannel、绑定状态机
- `src/server/proxy.js` — HTTP 反代 + WS 透传（先挂监听再等通道，防丢帧）
- `src/connector/index.js` — 出站控制通道、指数退避重连、凭证监听自动绑定
- `src/connector/login.js` / `logout.js` — 开启/关闭远程控制（交互登录绑定/解绑）
- `src/connector/credentials.js` — 本地凭证存储（600）+ 变化监听
- `src/connector/forwarder.js` — open 指令 → 本地 3030 转发
- `public/login.html` — 手机登录页（PC 在线状态 + 绑定账号显示）
- `deploy/nginx-relay.conf` — openresty 反代示例（wss 必需，长连接超时 1h）

**blog 项目（/Users/lininn/test/blog，已上生产）**
- `controllers/relay-auth.js` — /api/relay/auth（签发）、/api/relay/verify（校验）
- `routes/api-router.v1.js` — 路由注册 + 限流

**ZCode 仓库（本仓库，未改动）**
- `packages/web/src/main.tsx:425` — bootstrapWebApp：无 OAuth gate，直连 /ws
- `packages/server/src/http.ts` — /ws RPC、/api/server-info
- `packages/web/vite.config.ts` — dev 启动慢的优化点（optimizeDeps 补全、页面级 lazy）

## 六、日常运维

```bash
# kd1 上
cd /opt/zcode-relay && docker compose up -d --build   # 更新 relay（先更新 web-dist）
docker logs -f zcode-relay                            # 看日志
pm2 restart blog-3001                                 # blog 变更后

# PC 上（前台调试）
RELAY_URL=wss://<域名> PAIR_TOKEN=<同服务器> node <relay>/src/connector/index.js
```

web-dist 更新流程：ZCode 仓库 `pnpm --filter @zcode/web build` → 拷 `packages/web/dist/` 到 relay `web-dist/` → rsync 上 kd1 → `docker compose restart relay`（web-dist 是只读挂载，改内容即可，无需重建镜像）。
