# @lininn/zz

简体中文 · [English](README.en.md)

zz 是基于 ZCode 的 AI 编程工作台，一条命令即可在终端、浏览器中与 AI 协作编码。

## 安装

```bash
npm install -g @lininn/zz
```

要求 Node.js >= 24。

## 快速开始

```bash
zz            # 终端 TUI
zz --web      # 本地 Web 界面
```

[pc.d-1.top](https://pc.d-1.top) 不是在线版，而是远程控制入口：先在你要控制的机器上安装并启动 zz，再运行 connector 绑定账号，之后就能用任意浏览器（包括手机）远程操控这台机器。使用需要邀请码，关注微信公众号「html5开发分享」并回复「邀请码」即可领取。

## 功能

- **多项目工作区**：项目、任务、会话集中管理，支持本地与远程工作区。
- **Agent 群组（Crew）**：多个 Agent 按角色分工，支持自动接力、审批与恢复。
- **管理者统筹**：首次安装内置「管理者」角色；群组内发消息但未 @ 成员时，由管理者按成员分工自动派发任务。每个群组最多一名管理者，自建 Agent 可自行勾选。
- **自动化与插件**：定时任务、插件市场、UI Plugin 与 Gen UI。
- **三端统一**：桌面端、浏览器、终端 CLI 共享同一套 Agent 与数据。

## 使用

### 终端 TUI 模式

```bash
zz
```

启动交互式终端 UI，与 AI 对话编码。

### 单次提问

```bash
zz -p "用 Python 写一个快速排序"
```

### Web 聊天页面

```bash
zz --web
```

启动本地 Web 服务器（默认端口 3030）并自动打开浏览器，在浏览器里与 AI 聊天。

端口被占用时自动切换到下一个可用端口。也可手动指定：

```bash
zz --web --web-port 8080
```

### 模型配置页

```bash
zz --web-config
```

打开浏览器配置自定义模型 Provider（Claude / OpenAI 兼容接口），配置写入 `~/.zcode/` 。

### 其他常用命令

```bash
zz --version          # 查看版本
zz --help             # 查看帮助
zz doctor             # 诊断环境信息
zz login              # 登录
zz plugin             # 插件管理
zz skills             # 技能管理
```

## 远程控制（手机操控 PC）

1. 在要控制的机器上启动 `zz --web`（或 TUI 模式）
2. 在同一台机器上运行 connector（`zcode-relay` 的 connector），绑定账号
3. 手机或任意浏览器访问 [pc.d-1.top](https://pc.d-1.top)，登录后即可远程操控该机器上的 ZCode

需要邀请码才能登录：关注微信公众号「html5开发分享」，回复「邀请码」领取。

中转服务器支持多版本共存：手机端看到的页面版本与 PC 端运行的 ZCode 版本自动匹配。

## 配置

- 配置目录：`~/.zcode/`
- Provider 配置：`~/.zcode/v2/personal-provider-config.json`（通过 `zz --web-config` 编辑）
- 环境变量：
  - `ZCODE_WEB_STATIC_ROOT` — 指定 web 静态文件目录（`zz --web` 托管）
  - `PORT` — server 端口（默认 3030）

## 许可证

详见项目 LICENSE 文件。
