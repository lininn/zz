# Web 配置页（`zz --web-config`）Spec

## 目标

提供本地 Web 页面，管理自定义 Claude / OpenAI 兼容 Provider 与模型（含传图/视频/PDF 能力开关），保存到 ZCode Personal Provider Config（`~/.zcode/v2/provider_config.json`），供 `zz -p`、TUI、`app-server` 等入口直接使用。参考 claude-code-haha 的 `--web` 配置页交互。

## 产品规则

1. 管理范围：仅管理 Personal 层中**无 `templateId` 且非 `account:` 前缀**的 Provider（"标准个人 Provider"）。模板型（Z.ai / BigModel 模板派生）与账号型 Provider 及其模型规则、默认选择**原样保留**，Web UI 不越权改写。
2. API 兼容性：`api.type` 支持 `anthropic-messages`（Claude 形式）与 `openai-chat-completions` / `openai-responses`（OpenAI 形式）。
3. 模型能力：每个模型可配置 `enabled`、`supportsImage` / `supportsVideo` / `supportsPdf`（传图能力）、`contextWindow`、`maxOutputTokens`。未做任何自定义的模型不写模型规则，让内置匹配规则继续提供默认值。
4. 默认模型选择：UI 未设置或选中目标无效时，保留文件中现有选择（避免误清模板型 Provider 的默认选择）；选中有效目标时覆盖。
5. 删除/重命名：UI 中删除 Provider 或模型会移除 Personal 层对应规则；重命名后旧 ID 的孤儿模型规则一并清理。
6. 端口：默认 3210，`--web-port <port>` 指定；被占用时自动向后顺延（最多 10 个）。仅绑定 `127.0.0.1`。
7. 环境变量：不新增（遵循仓库约定，端口用 CLI 参数表达）。
8. 复制 Provider：Provider 面板提供「复制此 Provider」。副本复制源 Provider 的 API 类型、Base URL、API Key、启用状态与全部模型规则；名称追加「副本」，`providerId` 按 `custom-N` 规则重新分配未占用 ID，副本插入到源 Provider 之后并选中，保存前可自由修改。API Key 随副本一并复制（密钥本就以明文存于同一配置文件，不增加额外暴露面）。
9. 模型导入弹窗：提供「全选」主开关，仅作用于可导入（非「已存在」禁用项）的模型。取消全选后所有可导入模型取消勾选；单个勾选变化时主开关同步为全选/半选/未选状态，计数文案实时显示可导入与已选数量。

## 状态所有者

- 配置文件状态：`@zcode/provider-node` 的 `NodePersonalProviderConfigRepository`（文件锁、原子写、schema 校验、revision）。
- Web 会话状态：浏览器内存（`state.providers`），保存成功后重新从 `/api/config` 加载。

## 接口

CLI：

- `zcode --web-config`：启动配置页并阻塞到 SIGINT/SIGTERM。
- `zcode --web-config --web-port <port>`：指定起始端口。

HTTP（同源，`127.0.0.1`）：

- `GET /`：配置页 HTML（内嵌，无外部资产）。
- `GET /api/config`：返回 `{ providers, defaultModelSelection }`。
- `POST /api/config`：保存 `{ providers, defaultModelSelection }`；校验失败返回 400 + `{ error }`。
- `POST /api/models`：`{ apiType, baseUrl, apiKey }` → 代理请求上游 `/models`，返回 `{ models: string[] }`；Anthropic 形式带 `x-api-key` + `anthropic-version`，OpenAI 形式带 `Bearer`。

## 验收场景

1. 空配置启动：`GET /api/config` 返回 `{ providers: [] }`，页面可新增 Provider 并保存成功。
2. 保存后文件通过 `decodeProviderConfigFile` 校验，且 `zz` 的 Provider Registry 能读出该 Provider 与模型。
3. 模板型/账号型规则在保存前后保持字节不变（内容级）。
4. 勾选"传图"保存后，该模型规则含 `properties.inputFormat.supportsImage: true`。
5. 端口被占用时自动顺延，并在 stdout 提示实际端口。
6. 上游 `/models` 返回非 200 时，`POST /api/models` 返回 502 与错误信息，页面 toast 提示。
7. 复制 Provider 后，副本与源的 API 类型 / Base URL / API Key / 模型列表一致且 `providerId` 唯一；修改副本的模型不影响源；保存后文件中同时存在两个 Provider。
8. 导入弹窗中取消全选后导入 0 个模型；重新勾选部分模型后导入，仅勾选项进入模型列表。

## 模块

- `webConfigCommand.ts`：CLI 入口（端口解析、启动、打开浏览器、信号处理）。
- `server.ts`：HTTP 服务器与 REST API。
- `html.ts` / `htmlScript.ts`：内嵌配置页结构/样式与行为脚本（原生前端 JS，无构建依赖；脚本内容禁用反引号与 `${`，因其被内嵌进模板字面量）。
- `configStore.ts`：Web UI 数据合同与 Personal Provider Config 的读写/合并。
