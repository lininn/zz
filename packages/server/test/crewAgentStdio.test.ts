import assert from "node:assert/strict";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

test(
  "server Agent service -> existing CLI bundle accepts agent_crew_ session/create over stdio",
  { timeout: 30000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "crew-stdio-")));
    const originalEnv = { ...process.env };
    let dispose: (() => Promise<void>) | undefined;
    t.after(async () => {
      try {
        await dispose?.();
      } finally {
        for (const key of Object.keys(process.env))
          if (!(key in originalEnv)) delete process.env[key];
        Object.assign(process.env, originalEnv);
        await rm(directory, { recursive: true, force: true });
      }
    });
    // CLI 启动本身依赖本地 IPC；先报告权限缺口，避免把 transport closed 误诊为协议缺陷。
    const ipc = createServer();
    const listening = once(ipc, "listening");
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\crew-test-${randomUUID()}`
        : join(directory, "probe.sock");
    ipc.listen(endpoint);
    try {
      await listening;
    } catch (error) {
      if (
        ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") &&
        process.env.ZCODE_REQUIRE_NETWORK_E2E !== "1"
      ) {
        t.skip(`Agent IPC unavailable: ${(error as Error).message}`);
        return;
      }
      throw error;
    }
    await new Promise<void>((resolve) => ipc.close(() => resolve()));
    // 动态导入前隔离 Host/Agent 的配置根；不读取真实账号配置、不写 CLI 工作树、不发模型请求。
    const inheritedKeys = new Set(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TZ"]);
    for (const key of Object.keys(process.env))
      if (!inheritedKeys.has(key)) delete process.env[key];
    Object.assign(process.env, {
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
      HOME: directory,
      USERPROFILE: directory,
      ZCODE_DATA_BASE_DIR: directory,
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_CACHE_HOME: join(directory, "cache"),
    });
    const bundle = resolve(
      import.meta.dirname,
      "../../../apps/zcode-cli/packages/cli/dist/zcode.cjs",
    );
    await access(bundle);
    const { createZCodeAgentService } = await import("@zcode/services/node");
    const service = createZCodeAgentService({
      requestTimeoutMs: 15000,
      // 只验证 stdio/命名空间，使用测试 readiness 投影；不证明真实账号模型配置可用。
      modelSelectionReadinessSource: {
        getView: async () => ({
          revision: 1,
          providers: [
            {
              providerId: "fixture",
              providerName: "Fixture",
              config: {},
              models: [
                {
                  modelId: "fixture",
                  config: {
                    enabled: true,
                    properties: {
                      requiresMfjsToolSchema: false,
                      contextWindow: 8192,
                      inputFormat: {
                        supportsText: true,
                        supportsImage: false,
                        supportsVideo: false,
                        supportsAudio: false,
                        supportsPdf: false,
                      },
                      outputFormat: { supportsText: true },
                      supportsToolCall: true,
                      supportsJsonSchemaOutput: false,
                      supportsNativeWebSearch: false,
                      supportsMidConversationSystem: false,
                    },
                    optionSpecs: {
                      reasoningLevel: { values: ["none"], map: "{}" },
                      maxOutputTokens: { max: 1024, map: "{}" },
                    },
                  },
                },
              ],
            },
          ],
        }),
      },
      commandResolver: () => ({
        command: process.execPath,
        args: [bundle, "app-server", "--stdio"],
        cwd: directory,
      }),
    });
    dispose = () => service.disposeAllAndWait();
    const target = { workspacePath: directory, workspaceIdentity: "crew-stdio-workspace" };
    assert.equal((await service.initialize(target)).available, true);
    const sessionId = "agent_crew_88f7f2ee-bbe2-471b-8678-b7ab76086794";
    const created = await service.createSession({
      ...target,
      sessionId,
      titleGenerationEnabled: false,
      mcpServers: [],
      toolAllowlist: ["Read", "Glob", "Grep"],
    });
    assert.equal(created.session.sessionId, sessionId);
    const read = await service.readSession({ ...target, sessionId });
    assert.equal(read.session.sessionId, sessionId);
    assert.equal(read.messages.length, 0);
  },
);
