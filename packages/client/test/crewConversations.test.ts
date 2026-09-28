import assert from "node:assert/strict";
import test from "node:test";
import type { IChannel, IChannelClient } from "@zcode/rpc";
import { ICrewService } from "@zcode/services";
import {
  crewConversationCreateParamsSchema,
  crewConversationListParamsSchema,
  crewGetParamsSchema,
  crewSendParamsSchema,
  crewCancelParamsSchema,
  crewPermissionParamsSchema,
  crewRecoverParamsSchema,
  crewConversationSchema,
} from "@zcode/shared";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

test("conversation commands preserve scope through the existing Crew RPC channel", async () => {
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
  const service = new RemoteServiceAccess(client).crewService;
  const target = { groupId: "g", conversationId: "c" };
  await service.createConversation({ groupId: "g", name: "Task" });
  await service.listConversations({ groupId: "g" });
  await service.get(target);
  await service.send({ ...target, messageId: "m", text: "work", mentions: [] });
  await service.recover(target);
  await service.cancel({ ...target, executionId: "e" });
  await service.respondPermission({ ...target, executionId: "e", requestId: "p", approved: true });
  assert.deepEqual(
    calls.map(({ method }) => method),
    [
      "createConversation",
      "listConversations",
      "get",
      "send",
      "recover",
      "cancel",
      "respondPermission",
    ],
  );
  assert(calls.every(({ channel }) => channel === ICrewService.channelName));
  for (const call of calls.slice(2)) {
    assert.equal((call.args as { conversationId: string }[])[0]?.conversationId, "c");
    assert.equal((call.args as { groupId: string }[])[0]?.groupId, "g");
  }
});

test("conversation schemas reject empty scope and unknown attributes, retaining fixed-default compatibility", () => {
  const scoped = [
    [crewGetParamsSchema, {}],
    [crewSendParamsSchema, { messageId: "m", text: "work", mentions: [] }],
    [crewRecoverParamsSchema, {}],
    [crewCancelParamsSchema, { executionId: "e" }],
    [crewPermissionParamsSchema, { executionId: "e", requestId: "p", approved: true }],
  ] as const;
  for (const [schema, extra] of scoped) {
    const base = { groupId: "g", ...extra };
    assert(schema.safeParse(base).success);
    assert(schema.safeParse({ ...base, conversationId: " c " }).success);
    assert(!schema.safeParse({ ...base, conversationId: " " }).success);
    assert(
      !schema.safeParse({ ...base, conversationId: "c", selectedConversation: "other" }).success,
    );
  }
  assert(crewConversationListParamsSchema.safeParse({ groupId: "g" }).success);
  assert(crewConversationCreateParamsSchema.safeParse({ groupId: "g", name: "Task" }).success);
  assert(
    !crewConversationCreateParamsSchema.safeParse({ groupId: "g", conversationId: "caller" })
      .success,
  );
  assert(!crewConversationCreateParamsSchema.safeParse({ groupId: "g", name: " " }).success);
});

test("conversation projection has explicit ownership and a localizable default title", () => {
  const view = {
    groupId: "g",
    conversationId: "c",
    name: "",
    isDefault: true,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  };
  assert.deepEqual(crewConversationSchema.parse(view), view);
  assert(!crewConversationSchema.safeParse({ ...view, conversationId: undefined }).success);
  assert(!crewConversationSchema.safeParse({ ...view, messages: [] }).success);
});
