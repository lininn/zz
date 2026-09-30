# 设计：登录页信息泄露修复

## 目标
登录页不显示连接信息，防止黑客探测用户名或「relay 背后有 PC 在线」。

## 决策
1. `public/login.html`：删除状态展示区（`.sub` 的 dot + pcState）和 `fetch('/status')` JS 块，登录页只留纯登录表单
2. `src/server/index.js` 的 `/status`：无 session 时返回 `{online: false, user: null}`，不再调 `connectorOnline()`
3. 登录后的设备在线状态在 `/relay/devices`（auth gate 后）正常保留

## 验收
- 未登录访问 `login.html` 看不到任何连接信息
- 有 session 访问 `login.html` 不显示用户名
- `/status` 无 session 时返回 `{online: false, user: null}`
- 登录后 `/relay/devices` 设备状态不受影响
