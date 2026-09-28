import assert from "node:assert/strict";
import test from "node:test";
import type { IChannel, IChannelClient } from "@zcode/rpc";
import { ICrewAgentCatalogService, ICrewService } from "@zcode/services";
import {
  crewAgentCreateParamsSchema,
  crewAgentUpdateParamsSchema,
  crewCreateParamsSchema,
  crewMemberSchema,
  crewResolvedMemberSchema,
  type CrewAgentInput,
} from "@zcode/shared";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

const agent: CrewAgentInput = {
  name: "Reviewer",
  systemPrompt: "Review the requested change.",
  runtime: "zcode",
  accessMode: "read",
  modelSelection: { providerId: "fixture", modelId: "fixture-model" },
  toolAllowlist: ["Read", "Grep"],
};

function fixture() {
  const calls: { channel: string; method: string; args: unknown }[] = [];
  const client: IChannelClient = {
    getChannel<T extends IChannel>(channel: string): T {
      return {
        async call(method: string, args: unknown) {
          calls.push({ channel, method, args: JSON.parse(JSON.stringify(args)) });
          return [];
        },
        listen() {
          throw new Error("Unexpected subscription");
        },
      } as T;
    },
  };
  return { access: new RemoteServiceAccess(client), calls };
}

test("catalog CRUD travels on its own RPC channel, independently of crew CRUD", async () => {
  const { access, calls } = fixture();
  await access.crewAgentCatalogService.list({});
  await access.crewAgentCatalogService.create(agent);
  await access.crewAgentCatalogService.get({ agentId: "a" });
  await access.crewAgentCatalogService.update({ agentId: "a", name: "New name" });
  await access.crewAgentCatalogService.delete({ agentId: "a" });
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["list", "create", "get", "update", "delete"],
  );
  assert(calls.every(({ channel }) => channel === ICrewAgentCatalogService.channelName));
  assert.notEqual(ICrewAgentCatalogService.channelName, ICrewService.channelName);
  await access.crewService.create({ name: "Group", members: [{ agentId: "a" }] });
  assert.equal(calls.at(-1)?.channel, ICrewService.channelName);
  assert.deepEqual(calls.at(-1)?.args, [{ name: "Group", members: [{ agentId: "a" }] }]);
});

test("nullable optional catalog settings survive JSON RPC to explicitly reset", async () => {
  const { access, calls } = fixture();
  const reset = crewAgentUpdateParamsSchema.parse({
    agentId: "a",
    modelSelection: null,
    toolAllowlist: null,
  });
  await access.crewAgentCatalogService.update(reset);
  assert.deepEqual(calls[0]?.args, [{ agentId: "a", modelSelection: null, toolAllowlist: null }]);
  assert.deepEqual(crewAgentUpdateParamsSchema.parse({ agentId: "a", name: "Only name" }), {
    agentId: "a",
    name: "Only name",
  });
});

test("group membership accepts only references and group-level permission overrides", () => {
  const reference = { memberId: "m", agentId: "a", accessMode: "read" };
  assert.deepEqual(crewMemberSchema.parse(reference), reference);
  for (const embedded of [
    { name: "Inline" },
    { rolePrompt: "Inline" },
    { systemPrompt: "Inline" },
    { configVersion: "old" },
    { runtime: "zcode" },
    { modelSelection: agent.modelSelection },
    { toolAllowlist: ["Read"] },
  ]) {
    assert.equal(crewMemberSchema.safeParse({ ...reference, ...embedded }).success, false);
  }
  assert.equal(
    crewCreateParamsSchema.safeParse({ name: "Group", members: [{ name: "Inline" }] }).success,
    false,
  );
  assert.equal(
    crewCreateParamsSchema.safeParse({ name: "Group", members: [{ agentId: "a" }] }).success,
    true,
  );
});

test("catalog accepts the existing P1 runtime identities and structured model selection", () => {
  for (const runtime of ["zcode", "claude-cli", "codex-cli", "opencode-cli"]) {
    const parsed = crewAgentCreateParamsSchema.parse({ ...agent, runtime });
    assert.equal(parsed.runtime, runtime);
    assert.deepEqual(parsed.modelSelection, agent.modelSelection);
    assert.equal(parsed.systemPrompt, agent.systemPrompt);
  }
  assert.equal(
    crewAgentCreateParamsSchema.safeParse({ ...agent, modelSelection: "provider/model" }).success,
    false,
  );
  assert.equal(
    crewAgentCreateParamsSchema.safeParse({ ...agent, agentId: "caller-id" }).success,
    false,
  );
  assert.equal(
    crewAgentCreateParamsSchema.safeParse({ ...agent, configVersion: "caller-version" }).success,
    false,
  );
});

test("resolved execution snapshot keeps the P1 runtime contract separate from membership", () => {
  const snapshot = {
    memberId: "m",
    agentId: "a",
    configVersion: "v1",
    name: agent.name,
    rolePrompt: agent.systemPrompt,
    runtime: agent.runtime,
    accessMode: agent.accessMode,
    modelSelection: agent.modelSelection,
    toolAllowlist: agent.toolAllowlist,
  };
  assert.deepEqual(crewResolvedMemberSchema.parse(snapshot), snapshot);
  assert.equal(crewMemberSchema.safeParse(snapshot).success, false);
});
