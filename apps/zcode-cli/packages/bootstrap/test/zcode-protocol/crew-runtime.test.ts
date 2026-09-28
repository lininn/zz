import assert from "node:assert/strict";
import test from "node:test";
import { closeCrewRuntimes, handleCrewRuntime } from "../../src/zcode-protocol/crew-runtime.js";
import type { ZCodeProtocolAgentServerContext } from "../../src/zcode-protocol/server-types.js";
import type { ExternalRuntimeFacade } from "../../src/app/external-runtime.js";

const workspace = { workspaceKey: "ws", workspacePath: "/workspace", workspaceIdentity: "ws" };
const command = { action: "probe", runtimeId: "claude-cli", accessMode: "read" };
const reply = {
  kind: "probe",
  probe: { runtimeId: "claude-cli", available: false, reason: "outer_isolation_missing" },
};

test("crew protocol read/probe uses facade directly without a ZCode model/session", async () => {
  let factories = 0;
  let closed = 0;
  const context = {
    assertServing() {},
    deps: {
      createZCodeApp() {
        throw new Error("must not create ZCode session");
      },
      async createCrewRuntimeFacade() {
        factories++;
        return {
          async crewRuntime() {
            return reply;
          },
          async shutdown() {
            closed++;
          },
        } as unknown as ExternalRuntimeFacade;
      },
    },
  } as unknown as ZCodeProtocolAgentServerContext;
  assert.deepEqual(await handleCrewRuntime(context, { workspace, command }), reply);
  assert.deepEqual(await handleCrewRuntime(context, { workspace, command }), reply);
  assert.equal(factories, 1);
  await closeCrewRuntimes(context);
  assert.equal(closed, 1);
});

test("crew protocol rejects injected sandbox capabilities and malformed actions", async () => {
  const context = { deps: {} } as ZCodeProtocolAgentServerContext;
  await assert.rejects(handleCrewRuntime(context, { workspace, command, outerSandboxReady: true }));
  await assert.rejects(
    handleCrewRuntime(context, { workspace, command: { ...command, action: "sendMessage" } }),
  );
  const result = await handleCrewRuntime(context, { workspace, command });
  assert.equal(result.kind, "probe");
  if (result.kind === "probe") assert.equal(result.probe.available, false);
});

test("crew protocol does not alias different remote attachments", async () => {
  let created = 0;
  const context = {
    deps: {
      async createCrewRuntimeFacade() {
        created++;
        return {
          async crewRuntime() {
            return reply;
          },
          async shutdown() {},
        };
      },
    },
  } as unknown as ZCodeProtocolAgentServerContext;
  await handleCrewRuntime(context, {
    workspace: { ...workspace, remoteSessionId: "remote-1" },
    command,
  });
  await handleCrewRuntime(context, {
    workspace: { ...workspace, remoteSessionId: "remote-2" },
    command,
  });
  assert.equal(created, 2);
  await closeCrewRuntimes(context);
});
