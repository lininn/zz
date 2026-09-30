# zz-web

## ADDED Requirements

### Requirement: --web 参数注册
**ID:** REQ-WEB-001

**Scenario: 解析 --web**
- **When** 用户执行 `zz --web`
- **Then** 系统识别 `--web` 参数并进入 web 启动流程
- **And** 不进入默认 TUI 流程

**Scenario: 解析 --web-port**
- **When** 用户执行 `zz --web --web-port 8080`
- **Then** 系统使用 8080 作为 web 端口

### Requirement: 启动内嵌 server 托管 web-dist
**ID:** REQ-WEB-002

**Scenario: 生产模式启动**
- **When** 用户执行 `zz --web`
- **Then** 系统启动内嵌 HTTP server
- **And** 通过 staticRoot 托管 web-dist 静态资源
- **And** 提供 `/ws` WebSocket RPC 通道

### Requirement: 端口自动回退
**ID:** REQ-WEB-003

**Scenario: 默认端口被占用**
- **When** 默认端口 3030 已被占用
- **Then** 系统自动向后探测可用端口（上限 10 次）
- **And** 在终端和页面给出实际端口提示

### Requirement: 自动打开浏览器
**ID:** REQ-WEB-004

**Scenario: 启动成功后打开浏览器**
- **When** server 启动成功
- **Then** 系统自动打开默认浏览器访问 `http://127.0.0.1:<port>`
- **And** 支持 `--no-browser` 跳过

### Requirement: 与 --web-config 不冲突
**ID:** REQ-WEB-005

**Scenario: 两个 web 命令独立**
- **When** 用户执行 `zz --web-config`
- **Then** 仍进入模型配置页（端口 3210），行为不变
- **And** `zz --web` 与 `zz --web-config` 互不影响
