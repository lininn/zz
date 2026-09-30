# npm-publish

## ADDED Requirements

### Requirement: CLI bin 名改为 zz
**ID:** REQ-NPM-001

**Scenario: 用户全局安装后使用 zz 命令**
- **When** 用户执行 `npm install -g <包名>`
- **Then** 系统提供 `zz` 可执行命令
- **And** `zz --version` 输出当前版本号

**Scenario: CLI_COMMAND_NAME 同步**
- **When** 运行 `zz doctor`
- **Then** 输出的 cli.name 为 `zz`

### Requirement: npm 包元数据完整
**ID:** REQ-NPM-002

**Scenario: 包可发布**
- **When** 执行 `npm publish`
- **Then** 包包含 `name`、`description`、`repository`、`license` 字段
- **And** 包不包含 `private: true`

### Requirement: web-dist 内嵌进包
**ID:** REQ-NPM-003

**Scenario: 安装后开箱即用**
- **When** 用户安装包后执行 `zz --web`
- **Then** 包内包含预构建的 web-dist 静态资源
- **And** 无需额外下载即可启动 web 页面

### Requirement: 与 server-cli 的 bin 不冲突
**ID:** REQ-NPM-004

**Scenario: 发布时只发一个主命令**
- **When** 发布 npm 包
- **Then** `zz` 是唯一对外 bin
- **And** `packages/zcode-server-cli` 不发布同名 bin（或改名）
