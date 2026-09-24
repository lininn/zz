import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  isApiType,
  readWebConfig,
  writeWebConfig,
  WebConfigValidationError,
  type WebConfig,
} from "./configStore.js";
import { WEB_CONFIG_HTML } from "./html.js";

export interface WebConfigServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface WebConfigServerHandle {
  readonly port: number;
  stop(): void;
}

const MAX_BODY_BYTES = 1024 * 1024;
const PORT_RETRY_COUNT = 10;

// ── 请求体解析 ──

interface RequestBodyReader {
  (req: IncomingMessage): Promise<unknown>;
}

const readJsonBody: RequestBodyReader = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new WebConfigValidationError("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new WebConfigValidationError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function normalizeNonNegativeInt(value: unknown, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), max);
}

/** 上游 /models 返回 { data: [{ id }] }；Anthropic 与 OpenAI 形式一致。 */
function extractModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const ids: string[] = [];
  for (const item of payload.data) {
    if (isRecord(item) && typeof item.id === "string" && item.id.length > 0) ids.push(item.id);
  }
  return ids;
}

function normalizeWebConfigInput(input: unknown): WebConfig {
  if (!isRecord(input)) throw new WebConfigValidationError("请求体必须是 JSON 对象");
  const providersInput = Array.isArray(input.providers) ? input.providers : [];
  const providers = providersInput.map((rawProvider, providerIndex): WebConfig["providers"][number] => {
    if (!isRecord(rawProvider)) {
      throw new WebConfigValidationError(`providers[${providerIndex}] 必须是对象`);
    }
    const providerId = typeof rawProvider.providerId === "string" ? rawProvider.providerId.trim() : "";
    if (!providerId) {
      throw new WebConfigValidationError(`providers[${providerIndex}].providerId 不能为空`);
    }
    const modelsInput = Array.isArray(rawProvider.models) ? rawProvider.models : [];
    const models = modelsInput.map((rawModel, modelIndex): WebConfig["providers"][number]["models"][number] => {
      if (!isRecord(rawModel)) {
        throw new WebConfigValidationError(`providers[${providerIndex}].models[${modelIndex}] 必须是对象`);
      }
      const modelId = typeof rawModel.modelId === "string" ? rawModel.modelId.trim() : "";
      if (!modelId) {
        throw new WebConfigValidationError(
          `providers[${providerIndex}].models[${modelIndex}].modelId 不能为空`,
        );
      }
      return {
        modelId,
        enabled: rawModel.enabled !== false,
        supportsImage: rawModel.supportsImage === true,
        supportsVideo: rawModel.supportsVideo === true,
        supportsPdf: rawModel.supportsPdf === true,
        contextWindow: normalizeNonNegativeInt(rawModel.contextWindow, 10_000_000),
        maxOutputTokens: normalizeNonNegativeInt(rawModel.maxOutputTokens, 10_000_000),
      };
    });
    return {
      providerId,
      providerName:
        typeof rawProvider.providerName === "string" ? rawProvider.providerName : providerId,
      enabled: rawProvider.enabled !== false,
      apiType: isApiType(rawProvider.apiType) ? rawProvider.apiType : "openai-chat-completions",
      baseUrl: typeof rawProvider.baseUrl === "string" ? rawProvider.baseUrl : "",
      apiKey: typeof rawProvider.apiKey === "string" ? rawProvider.apiKey : "",
      models,
    };
  });
  const rawSelection = input.defaultModelSelection;
  const defaultModelSelection =
    isRecord(rawSelection) &&
    typeof rawSelection.providerId === "string" &&
    typeof rawSelection.modelId === "string" &&
    rawSelection.providerId.trim().length > 0 &&
    rawSelection.modelId.trim().length > 0
      ? { providerId: rawSelection.providerId.trim(), modelId: rawSelection.modelId.trim() }
      : undefined;
  return { providers, ...(defaultModelSelection ? { defaultModelSelection } : {}) };
}

// ── 响应工具 ──

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function writeError(res: ServerResponse, status: number, message: string): void {
  writeJson(res, status, { error: message });
}

// ── 服务器 ──

export async function startWebConfigServer(
  options: WebConfigServerOptions,
): Promise<WebConfigServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const doFetch = options.fetchImpl ?? fetch;

  const server = createServer((req, res) => {
    void handleRequest(req, res, doFetch).catch((error: unknown) => {
      if (res.writableEnded) return;
      const message = error instanceof Error ? error.message : String(error);
      writeError(res, 500, message);
    });
  });

  // 端口被占用时自动向后尝试，避免旧进程残留导致启动失败。
  let port = options.port;
  for (let attempt = 0; attempt < PORT_RETRY_COUNT; attempt += 1) {
    const listening = await tryListen(server, host, port);
    if (listening) break;
    if (attempt === PORT_RETRY_COUNT - 1) {
      server.close();
      throw new Error(`无法监听 ${host}:${port}（已尝试 ${PORT_RETRY_COUNT} 个端口）`);
    }
    port += 1;
  }

  return {
    port,
    stop: () => {
      server.close();
    },
  };
}

function tryListen(server: ReturnType<typeof createServer>, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      server.close();
      throw error;
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      // 后续 listen 错误直接导致进程退出，保持默认行为。
      server.on("error", () => {});
      resolve(true);
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  doFetch: typeof fetch,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const method = req.method ?? "GET";

  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(WEB_CONFIG_HTML);
    return;
  }

  if (method === "GET" && url.pathname === "/api/config") {
    writeJson(res, 200, readWebConfig());
    return;
  }

  if (method === "POST" && url.pathname === "/api/config") {
    const config = normalizeWebConfigInput(await readJsonBody(req));
    await writeWebConfig(config);
    writeJson(res, 200, { ok: true, config: readWebConfig() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/models") {
    await handleFetchModels(req, res, doFetch);
    return;
  }

  writeError(res, 404, "Not Found");
}

async function handleFetchModels(
  req: IncomingMessage,
  res: ServerResponse,
  doFetch: typeof fetch,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!isRecord(body)) throw new WebConfigValidationError("请求体必须是 JSON 对象");
  const apiType = isApiType(body.apiType) ? body.apiType : "openai-chat-completions";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!baseUrl) {
    writeError(res, 400, "请先填写请求地址 (Base URL)");
    return;
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiType === "anthropic-messages") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const upstream = await doFetch(endpoint, { method: "GET", headers });
  if (!upstream.ok) {
    writeError(res, 502, `上游返回 ${upstream.status}`);
    return;
  }
  const models = extractModelIds(await upstream.json());
  writeJson(res, 200, { models });
}

