# cicd

## ADDED Requirements

### Requirement: tag 触发流水线
**ID:** REQ-CI-001

**Scenario: push tag 自动构建**
- **When** 推送 `v*` 格式的 git tag
- **Then** 流水线自动触发
- **And** 执行 `pnpm install` + `pnpm build:bootstrap`

### Requirement: 自动发布 npm
**ID:** REQ-CI-002

**Scenario: 构建成功后发布**
- **When** 构建成功
- **Then** 流水线执行 `npm publish`
- **And** 使用 CI secrets 中的 npm token

### Requirement: 自动部署 web-dist 到 kd1
**ID:** REQ-CI-003

**Scenario: 发布后同步 web-dist**
- **When** npm 发布成功
- **Then** 流水线构建 web-dist
- **And** rsync 到 kd1 `web-dist/<version>/`
- **And** 不覆盖其他版本目录
