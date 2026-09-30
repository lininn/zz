# kd1-multiversion

## ADDED Requirements

### Requirement: connector 上报版本
**ID:** REQ-KD1-001

**Scenario: 启动时上报版本**
- **When** connector 启动
- **Then** 系统 GET `http://127.0.0.1:3030/api/server-info` 读取 `version`
- **And** 成功则 bind 帧附加 `zcodeVersion` 上报 relay

**Scenario: server 未就绪**
- **When** `/api/server-info` 请求失败
- **Then** connector 标记版本为 `unknown`
- **And** 每 60s 轮询重试，获取后发 `update-version` 帧

### Requirement: relay 按版本路由 web-dist
**ID:** REQ-KD1-002

**Scenario: 手机访问匹配版本**
- **When** 手机访问 relay，设备绑定版本为 `v3.14.3`
- **Then** relay serve `web-dist/v3.14.3/`
- **And** 页面正常加载

**Scenario: unknown 版本兜底**
- **When** 设备版本为 `unknown`
- **Then** relay 用最新可用版本 web-dist 兜底
- **And** 页面顶部显示提示

### Requirement: 版本不匹配提示页
**ID:** REQ-KD1-003

**Scenario: 版本目录缺失**
- **When** 设备版本为 `v3.15.0` 但 `web-dist/v3.15.0/` 不存在
- **Then** relay 返回版本不匹配提示页
- **And** 页面列出所有可用版本 + 「使用最新版本」兜底按钮 + 升级/降级指引

### Requirement: 多版本共存与清理
**ID:** REQ-KD1-004

**Scenario: 旧版本保留**
- **When** 部署新版本
- **Then** 旧版本 web-dist 目录保留
- **And** `rsync --delete` 只作用于目标版本子目录，不删除兄弟版本

### Requirement: 部署脚本按版本分目录
**ID:** REQ-KD1-005

**Scenario: 部署到 kd1**
- **When** 执行 `deploy-web-kd1.sh`
- **Then** web-dist 构建产物同步到 `web-dist/<version>/`
- **And** 不覆盖其他版本目录
