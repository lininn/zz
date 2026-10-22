import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewConversation, CrewGroup, CrewExecution, CrewGroupDetail } from "@zcode/shared";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewBoard } from "./CrewBoard.js";
import { CrewConversationView } from "./CrewConversationView.js";
import type { CrewController } from "../hooks/useCrew.js";
import { CrewComposer } from "./CrewComposer.js";
import { CrewConversations, crewConversationTitle } from "./CrewConversations.js";
import { crewPermissionParams } from "./crewExternalUi.js";
import { crewSendParams, newCrewDraft } from "./crewUiHelpers.js";
import { crewErrorKey } from "./crewErrors.js";
import { createCrewRequestScope, runCrewCommand } from "../hooks/crewRequestScope.js";

const group: CrewGroup = {
  groupId: "group",
  name: "Team",
  announcement: "",
  members: [],
  workspaceBinding: { workspacePath: "/fixture" },
  epoch: 1,
  status: "recovery_required",
  createdAt: 0,
  updatedAt: 0,
};
const conversation: CrewConversation = {
  groupId: group.groupId,
  conversationId: "a",
  name: "",
  isDefault: true,
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
};
const execution: CrewExecution = {
  groupId: group.groupId,
  conversationId: "a",
  executionId: "exec-a",
  messageId: "msg",
  memberId: "member",
  memberSnapshot: {
    memberId: "member",
    agentId: "agent",
    name: "Agent",
    rolePrompt: "Read",
    runtime: "zcode",
    accessMode: "read",
    configVersion: "v1",
  },
  epoch: 1,
  status: "running",
  workspaceBinding: group.workspaceBinding!,
  ownerId: "owner",
  taskId: "task",
  createdAt: 0,
  updatedAt: 0,
  permission: {
    requestId: "permission-a",
    toolName: "Read",
    description: "A approval",
    canRespond: true,
  },
};

for (const locale of ["en-US", "zh-CN"] as const) {
  test(`conversation list uses localized empty titles, selection and named plain text (${locale})`, () => {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewConversations
          conversations={[
            conversation,
            { ...conversation, conversationId: "b", isDefault: false },
            {
              ...conversation,
              conversationId: "c",
              isDefault: false,
              name: "<script>named</script>",
            },
            { ...conversation, conversationId: "d", isDefault: false },
          ]}
          selectedId="b"
          pending={false}
          onSelect={() => {}}
          onCreate={async () => {}}
        />
      </ZCodeIntlProvider>,
    );
    assert.match(html, locale === "en-US" ? /Default conversation/ : /默认会话/);
    assert.match(html, locale === "en-US" ? /Conversation 1/ : /会话 1/);
    assert.match(html, locale === "en-US" ? /Conversation 3/ : /会话 3/);
    assert.match(html, /data-conversation-id="b" aria-pressed="true"/);
    assert.match(html, /&lt;script&gt;named&lt;\/script&gt;/);
  });
}

test("dispatch guard follows conversation recovery, not aggregate group recovery", () => {
  const render = (status: CrewConversation["status"]) =>
    renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale="en-US">
        <CrewComposer
          group={group}
          conversation={{ ...conversation, status }}
          resolvedMembers={[execution.memberSnapshot]}
          pending={false}
          onSend={async () => true}
        />
      </ZCodeIntlProvider>,
    );
  assert.doesNotMatch(render("idle"), /Bind a workspace and resolve recovery/);
  assert.match(render("recovery_required"), /Bind a workspace and resolve recovery/);
  assert.doesNotMatch(render("idle"), /type="button"[^>]*disabled=""/);
  assert.match(render("recovery_required"), /type="button"[^>]*disabled=""/);
});

test("send and approval always carry their originating conversation", () => {
  const draft = { ...newCrewDraft(), text: "Read" };
  assert.equal(crewSendParams("group", "a", draft, [])?.conversationId, "a");
  assert.equal(crewSendParams("group", "b", draft, [])?.conversationId, "b");
  assert.equal(crewPermissionParams(execution, true)?.conversationId, "a");
  assert.equal(crewPermissionParams(execution, false)?.conversationId, "a");
  assert.equal(crewErrorKey(new Error("crew.conversationNotFound")), "error.conversationNotFound");
});

test("board excludes foreign messages, executions and approval requests", () => {
  const detail: CrewGroupDetail = {
    group,
    conversation: { ...conversation, conversationId: "b" },
    conversations: [conversation],
    resolvedMembers: [],
    executions: [execution],
    messages: [
      {
        groupId: "group",
        conversationId: "a",
        messageId: "a-msg",
        epoch: 1,
        sequence: 1,
        sender: "user",
        kind: "chat",
        text: "private A history",
        mentions: [],
        memberId: null,
        executionId: null,
        createdAt: 0,
      },
    ],
  };
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <CrewBoard
        detail={detail}
        pending={false}
        onCancel={async () => {}}
        onRespondPermission={async () => {}}
      />
    </ZCodeIntlProvider>,
  );
  assert.doesNotMatch(html, /private A history|A approval|exec-a|crew-permission/);
});

test("late commands refresh their captured scope but cannot affect the new selection", async () => {
  const a = createCrewRequestScope();
  const b = createCrewRequestScope();
  let selected = a;
  const isCurrent = () => selected === a;
  const deferred = Promise.withResolvers<string>();
  const events: string[] = [];
  const result = runCrewCommand(
    a,
    isCurrent,
    () => deferred.promise,
    async () => {
      events.push("refresh-a");
    },
    () => {
      events.push("notify-a");
    },
  );
  assert.equal(a.pending, true);
  selected = b;
  assert.equal(b.pending, false);
  deferred.resolve("created-a");
  const completed = await result;
  assert.equal(completed.ok, true);
  assert.equal(completed.isCurrent(), false);
  assert.deepEqual(events, ["notify-a", "refresh-a"]);
  assert.equal(b.error, null);
});

test("late failure and A -> B -> A do not revive stale errors or callbacks", async () => {
  const original = createCrewRequestScope();
  let current = original;
  const deferred = Promise.withResolvers<void>();
  const result = runCrewCommand(
    original,
    () => current === original,
    () => deferred.promise,
    async () => {},
    () => {},
  );
  current = createCrewRequestScope();
  deferred.reject(new Error("crew.conversationNotFound"));
  assert.equal((await result).ok, false);
  assert.equal(current.error, null);
  let invoked = false;
  await runCrewCommand(
    original,
    () => current === original,
    async () => {
      invoked = true;
    },
    async () => {},
    () => {},
  );
  assert.equal(invoked, false);
});

test("same-scope duplicate commands are blocked; read failure cannot reject a committed command", async () => {
  const scope = createCrewRequestScope();
  const deferred = Promise.withResolvers<string>();
  const first = runCrewCommand(
    scope,
    () => true,
    () => deferred.promise,
    async () => {
      throw new Error("read");
    },
    () => {},
  );
  let called = false;
  const second = await runCrewCommand(
    scope,
    () => true,
    async () => {
      called = true;
    },
    async () => {},
    () => {},
  );
  assert.equal(second.ok, false);
  assert.equal(called, false);
  deferred.resolve("accepted");
  assert.equal((await first).ok, true);
  assert.equal(scope.pending, false);
  assert.equal(scope.error, null);
});

test("unnamed title numbers use creation order, include named slots, and ignore status/updatedAt", () => {
  const first = { ...conversation, conversationId: "b", isDefault: false, updatedAt: 99 };
  const named = { ...conversation, conversationId: "c", isDefault: false, name: "Named" };
  const third = {
    ...conversation,
    conversationId: "d",
    isDefault: false,
    status: "active" as const,
  };
  const items = [conversation, first, named, third];
  const t = (key: string, values?: Record<string, string | number>) =>
    `${key}:${values?.number ?? ""}`;
  assert.equal(crewConversationTitle(first, items, t), "untitledConversation:1");
  assert.equal(crewConversationTitle(named, items, t), "Named");
  assert.equal(crewConversationTitle(third, items, t), "untitledConversation:3");
  assert.equal(crewConversationTitle(conversation, items, t), "defaultConversation:");
  assert.deepEqual(
    items.map((item) => item.name),
    ["", "", "Named", ""],
  );
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <CrewConversationView
        detail={{
          group,
          conversation: third,
          conversations: items,
          resolvedMembers: [],
          messages: [],
          executions: [],
        }}
        crew={{ pending: false } as CrewController}
      />
    </ZCodeIntlProvider>,
  );
  assert.match(html, /<h4[^>]*>Conversation 3<\/h4>/);
});
