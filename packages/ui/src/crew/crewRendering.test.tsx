import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CrewAgent,
  CrewGroup,
  CrewGroupDetail,
  CrewResolvedMember,
  Locale,
} from "@zcode/shared";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import en from "../i18n/locales/en-US.js";
import zh from "../i18n/locales/zh-CN.js";
import { CrewComposer } from "./CrewComposer.js";
import { TabStoreProvider } from "../store/TabStoreProvider.js";
import { CrewAgentEditor } from "./CrewAgentEditor.js";
import { CrewGroupEditor } from "./CrewGroupEditor.js";
import { CrewBoard } from "./CrewBoard.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewErrorKey } from "./crewErrors.js";

const agent: CrewAgent = {
  agentId: "agent-a",
  configVersion: "version-1",
  name: "Reviewer",
  systemPrompt: "Inspect evidence, do not modify files.",
  runtime: "zcode",
  accessMode: "read",
  createdAt: 0,
  updatedAt: 0,
};
const member: CrewResolvedMember = {
  memberId: "member-a",
  agentId: agent.agentId,
  configVersion: agent.configVersion,
  name: agent.name,
  rolePrompt: agent.systemPrompt,
  runtime: agent.runtime,
  accessMode: agent.accessMode,
};
const group: CrewGroup = {
  groupId: "crew-a",
  name: "Review crew",
  announcement: "",
  members: [{ memberId: member.memberId, agentId: member.agentId }],
  workspaceBinding: null,
  epoch: 0,
  status: "unbound",
  createdAt: 0,
  updatedAt: 0,
};

const conversation = {
  groupId: group.groupId,
  conversationId: "conversation-a",
  name: "",
  isDefault: true,
  status: "idle" as const,
  createdAt: 0,
  updatedAt: 0,
};

for (const locale of ["zh-CN", "en-US"] satisfies Locale[]) {
  test(`composer renders localized unbound guard and explicit assignment action (${locale})`, () => {
    let sends = 0;
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewComposer
          group={group}
          conversation={conversation}
          resolvedMembers={[member]}
          pending={false}
          onSend={async () => {
            sends++;
            return true;
          }}
        />
      </ZCodeIntlProvider>,
    );
    const messages = locale === "en-US" ? en : zh;
    assert.ok(html.includes(messages["crew.chooseMember"]!));
    assert.match(html, /type="submit" disabled=""/);
    assert.match(html, /text-mobile-input-safe/);
    assert.doesNotMatch(html, /crew\.(chooseMember|message|sendUnavailable)/);
    assert.equal(sends, 0);
  });
}

test("group editor selects existing catalog references without inline agent editing", () => {
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <TabStoreProvider>
        <CrewGroupEditor
          group={group}
          agents={[agent]}
          pending={false}
          onSave={async () => {}}
          onCancel={() => {}}
        />
      </TabStoreProvider>
    </ZCodeIntlProvider>,
  );
  assert.doesNotMatch(html, /Inspect evidence|crew-runtime-select/);
  // 群公告是编辑器唯一的内联文本域；不得出现 Agent 角色/提示词编辑。
  assert.match(html, /Crew announcement/);
  assert.equal(html.match(/<textarea/g)?.length, 1);
  assert.match(html, /version-1/);
  assert.match(html, /role="checkbox"/);
  assert.match(html, /ZCode/);
  assert.match(html, /Read only/);
});

test("board renders user content as text and exposes persisted execution status", () => {
  const detail: CrewGroupDetail = {
    conversation,
    conversations: [conversation],
    group,
    resolvedMembers: [member],
    messages: [
      {
        conversationId: conversation.conversationId,
        groupId: group.groupId,
        messageId: "msg-a",
        epoch: 0,
        sequence: 1,
        sender: "user",
        kind: "chat",
        memberId: null,
        text: "<script>@Reviewer</script>",
        mentions: [],
        executionId: null,
        createdAt: 0,
      },
    ],
    executions: [
      {
        executionId: "exec-a",
        conversationId: conversation.conversationId,
        groupId: group.groupId,
        messageId: "msg-a",
        memberId: member.memberId,
        epoch: 0,
        status: "running",
        memberSnapshot: member,
        workspaceBinding: { workspacePath: "/test" },
        ownerId: "owner",
        taskId: "task",
        createdAt: 0,
        updatedAt: 0,
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
  assert.match(html, /&lt;script&gt;@Reviewer&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Running/);
  assert.match(html, /Cancel execution/);
  assert.match(html, /exec-a/);
});

test("every crew translation has matching placeholders; all statuses are localized", () => {
  const keys = Object.keys(en)
    .filter((key) => key.startsWith("crew."))
    .sort();
  assert.deepEqual(
    keys,
    Object.keys(zh)
      .filter((key) => key.startsWith("crew."))
      .sort(),
  );
  for (const key of keys) {
    assert.deepEqual(en[key]?.match(/\{\w+\}/g)?.sort(), zh[key]?.match(/\{\w+\}/g)?.sort(), key);
  }
  for (const status of [
    "unbound",
    "idle",
    "active",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "recovery_required",
  ] as const) {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale="en-US">
        <CrewStatus status={status} />
      </ZCodeIntlProvider>,
    );
    assert.ok(html.includes(en[`crew.status.${status}`]!));
  }
});

test("known service failures are localized, unknown errors do not expose sensitive text", () => {
  assert.equal(crewErrorKey(new Error("crew.remoteUnavailable")), "error.remoteUnavailable");
  assert.equal(crewErrorKey(new Error("sensitive connection string")), "commandError");
  assert.ok(en[`crew.${crewErrorKey(new Error("crew.identityMismatch"))}`]);
});

test("project ownership rejections never surface as raw keys in the conversation", () => {
  for (const key of [
    "remote-project-required",
    "cwd-not-in-roots",
    "remote-single-root-required",
  ]) {
    const localized = crewErrorKey(`project.${key}`);
    assert.notEqual(localized, "commandError", `${key} must map to a localized crew error`);
    assert.ok(en[`crew.${localized}`], `${key} needs an en-US message`);
    assert.ok(zh[`crew.${localized}`], `${key} needs a zh-CN message`);
  }
  // 未登记的项目错误仍按未知错误处理，避免泄露任意内部键。
  assert.equal(crewErrorKey("project.some-internal-failure"), "commandError");
});

for (const locale of ["zh-CN", "en-US"] satisfies Locale[]) {
  test(`failed dispatch shows a localized project-root hint instead of the raw key (${locale})`, () => {
    const messages = locale === "en-US" ? en : zh;
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewBoard
          detail={{
            conversation,
            conversations: [conversation],
            group,
            resolvedMembers: [member],
            messages: [
              {
                groupId: group.groupId,
                conversationId: conversation.conversationId,
                messageId: "msg-failed",
                epoch: 0,
                sequence: 1,
                sender: "member",
                kind: "chat",
                memberId: member.memberId,
                text: "project.remote-project-required",
                mentions: [],
                executionId: "exec-failed",
                createdAt: 0,
              },
            ],
            executions: [
              {
                executionId: "exec-failed",
                groupId: group.groupId,
                conversationId: conversation.conversationId,
                messageId: "msg-failed",
                memberId: member.memberId,
                epoch: 0,
                status: "failed",
                memberSnapshot: member,
                workspaceBinding: { workspacePath: "/test" },
                ownerId: null,
                taskId: null,
                createdAt: 0,
                updatedAt: 0,
              },
            ],
          }}
          pending={false}
          onCancel={async () => {}}
          onRespondPermission={async () => {}}
        />
      </ZCodeIntlProvider>,
    );
    assert.doesNotMatch(html, /project\.remote-project-required/);
    // renderToStaticMarkup 会把英文撇号转义成实体，比对前先还原。
    const text = html.replace(/&#x27;|&#39;/g, "'");
    assert.ok(text.includes(messages["crew.error.projectRootRequired"]!));
  });
}

test("recovery-required execution without taskId keeps safe cancel available with a blocking hint", () => {
  const detail: CrewGroupDetail = {
    conversation,
    conversations: [conversation],
    group: { ...group, status: "recovery_required" },
    resolvedMembers: [member],
    messages: [],
    executions: [
      {
        executionId: "needs-recovery",
        conversationId: conversation.conversationId,
        groupId: group.groupId,
        messageId: "msg-a",
        memberId: member.memberId,
        epoch: 0,
        status: "recovery_required",
        memberSnapshot: member,
        workspaceBinding: { workspacePath: "/test" },
        ownerId: "previous-owner",
        taskId: null,
        createdAt: 0,
        updatedAt: 0,
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
  assert.match(html, /Recovery required/);
  assert.match(html, /Cancel execution/);
  assert.match(html, /no task reference and remains safely blocked/);
  assert.doesNotMatch(html, /<button[^>]*\sdisabled(?:=|\s|>)/);
});

for (const locale of ["zh-CN", "en-US"] satisfies Locale[]) {
  test(`catalog editor independently configures ZCode model/system prompt/tools (${locale})`, () => {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewAgentEditor
          agent={{ ...agent, toolAllowlist: ["Read"] }}
          pending={false}
          onSave={async () => {}}
          onCancel={() => {}}
        />
      </ZCodeIntlProvider>,
    );
    assert.match(html, /Inspect evidence, do not modify files/);
    assert.match(html, /crew-agent-model/);
    assert.match(html, /crew-agent-tools/);
    assert.match(html, /Read/);
    assert.match(html, /crew-runtime-select/);
    assert.doesNotMatch(html, /crew\.(systemPrompt|toolAllowlist|modelReadUnavailable)/);
  });
}
test("catalog validation errors all have zh/en translations", () => {
  for (const key of [
    "agentInUse",
    "agentNotFound",
    "duplicateAgentId",
    "permissionEscalation",
    "capabilitiesUnsupported",
  ]) {
    assert.equal(crewErrorKey(`crew.${key}`), `error.${key}`);
    assert.ok(en[`crew.error.${key}`]);
    assert.ok(zh[`crew.error.${key}`]);
  }
});

test("board uses live resolved definitions while preserving historical execution labels", () => {
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <CrewBoard
        detail={{
          conversation,
          conversations: [conversation],
          group,
          resolvedMembers: [{ ...member, name: "Current reviewer", configVersion: "version-2" }],
          messages: [],
          executions: [
            {
              executionId: "historic",
              conversationId: conversation.conversationId,
              groupId: group.groupId,
              messageId: "old-message",
              memberId: member.memberId,
              epoch: 0,
              status: "succeeded",
              memberSnapshot: { ...member, name: "Original reviewer" },
              workspaceBinding: { workspacePath: "/fixture" },
              ownerId: null,
              taskId: "task",
              createdAt: 0,
              updatedAt: 0,
            },
          ],
        }}
        pending={false}
        onCancel={async () => {}}
        onRespondPermission={async () => {}}
      />
    </ZCodeIntlProvider>,
  );
  assert.match(html, /Current reviewer/);
  assert.match(html, /version-2/);
  assert.match(html, /Original reviewer/);
  assert.doesNotMatch(html, /Inspect evidence/);
});

test("group editor displays read after catalog downgrade of a stored write override", () => {
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <TabStoreProvider>
        <CrewGroupEditor
          group={{
            ...group,
            members: [{ memberId: member.memberId, agentId: agent.agentId, accessMode: "write" }],
          }}
          agents={[agent]}
          pending={false}
          onSave={async () => {}}
          onCancel={() => {}}
        />
      </TabStoreProvider>
    </ZCodeIntlProvider>,
  );
  assert.match(html, /Read only/);
  assert.doesNotMatch(html, /Read and write/);
  assert.match(html, /type="submit"/);
  assert.doesNotMatch(html, /type="submit"[^>]*disabled=""/);
});
