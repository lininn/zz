# login-security

## ADDED Requirements

### Requirement: 登录页不显示连接信息
**ID:** REQ-LOGIN-001

**Scenario: 未登录访问登录页**
- **When** 未登录用户访问 `login.html`
- **Then** 页面只显示登录表单
- **And** 不显示 PC 在线状态、用户名等任何连接信息

**Scenario: 已登录访问登录页**
- **When** 有有效 session 的用户访问 `login.html`
- **Then** 页面不显示「已登录：用户名」
- **And** 不泄露用户名

### Requirement: /status 接口不泄露连接状态
**ID:** REQ-LOGIN-002

**Scenario: 无 session 调用 /status**
- **When** 未登录请求 `/status`
- **Then** 返回 `{online: false, user: null}`
- **And** 不再调用 `connectorOnline()` 暴露全局在线状态

### Requirement: 登录后设备状态保留
**ID:** REQ-LOGIN-003

**Scenario: 登录后查看设备**
- **When** 用户登录后访问 `/relay/devices`
- **Then** 设备在线状态、切换功能正常
- **And** 不受登录页修复影响
