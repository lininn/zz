import { CrewRuntimeStatus } from "./CrewRuntimeStatus.js";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewExecution, CrewGroupDetail, CrewResolvedMember, Locale } from "@zcode/shared";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import en from "../i18n/locales/en-US.js";
import zh from "../i18n/locales/zh-CN.js";
import { CrewBoard } from "./CrewBoard.js";
import { CrewAgentEditor } from "./CrewAgentEditor.js";
import { CrewPermissionRequest } from "./CrewPermissionRequest.js";
import { crewPermissionParams, crewRuntimeAvailability } from "./crewExternalUi.js";
import { crewSendParams, newCrewDraft } from "./crewUiHelpers.js";
import { crewErrorKey } from "./crewErrors.js";

const member: CrewResolvedMember = {
  memberId: "external-member",
  agentId: "agent-a",
  configVersion: "v1",
  name: "Reviewer",
  runtime: "claude-cli",
  accessMode: "read",
  rolePrompt: "Inspect evidence.",
};
const execution: CrewExecution = {
  executionId: "exec-a",
  groupId: "crew-a",
  conversationId: "conversation-a",
  memberId: member.memberId,
  messageId: "msg-a",
  epoch: 1,
  status: "running",
  memberSnapshot: member,
  workspaceBinding: { workspacePath: "/fixture" },
  ownerId: "owner",
  taskId: "task-a",
  createdAt: 0,
  updatedAt: 0,
  permission: {
    requestId: "request-a",
    toolName: "Read",
    description: "<script>request</script>",
    canRespond: true,
  },
};
const conversation = {
  groupId: "crew-a",
  conversationId: "conversation-a",
  name: "",
  isDefault: true,
  status: "idle" as const,
  createdAt: 0,
  updatedAt: 0,
};
const detail: CrewGroupDetail = {
  conversation,
  conversations: [conversation],
  group: {
    groupId: "crew-a",
    name: "Crew",
    members: [{ memberId: member.memberId, agentId: member.agentId }],
    epoch: 1,
    status: "idle",
    workspaceBinding: { workspacePath: "/fixture" },
    createdAt: 0,
    updatedAt: 0,
  },
  resolvedMembers: [member],
  messages: [],
  executions: [execution],
};

test("availability matches member and runtime, not shared provider identity", () => {
  const probes = [
    { memberId: "other", runtimeId: "claude-cli" as const, available: true },
    { memberId: member.memberId, runtimeId: "codex-cli" as const, available: true },
  ];
  assert.equal(crewRuntimeAvailability(member, probes).available, false);
  assert.equal(crewRuntimeAvailability(member).available, false);
  const failure = {
    memberId: member.memberId,
    runtimeId: member.runtime as "claude-cli",
    available: false,
    reason: "Binary not found",
  };
  assert.equal(crewRuntimeAvailability(member, [...probes, failure]).reason, failure.reason);
  assert.equal(crewRuntimeAvailability(member, [{ ...failure, available: true }]).available, true);
  assert.equal(crewRuntimeAvailability({ ...member, runtime: "zcode" }).available, true);
});

test("external dispatch is not blocked by runtime probes; unknown members still fail closed", () => {
  const draft = { ...newCrewDraft(), text: "Review", memberId: member.memberId };
  const available = [
    { memberId: member.memberId, runtimeId: "claude-cli" as const, available: true },
  ];
  const unavailable = [{ ...available[0]!, available: false, reason: "Binary not found" }];
  // 探测状态只用于展示：缺探测、探测可用、探测不可用都应照常派工，
  // 成败由执行边界判定，侧栏红色状态不能反过来拦住用户的明确指派。
  for (const probes of [undefined, available, unavailable]) {
    assert.deepEqual(
      crewSendParams("crew-a", "conversation-a", draft, [member], probes)?.mentions,
      [member.memberId],
    );
  }
  // 未选成员 = 仅发群板，不产生结构化派工。
  assert.deepEqual(
    crewSendParams("crew-a", "conversation-a", { ...draft, memberId: null }, [member])?.mentions,
    [],
  );
  // 护栏仍在：memberId 不在已解析成员里必须拒绝，正文里的 @ 不能变成派工。
  assert.equal(
    crewSendParams("crew-a", "conversation-a", { ...draft, memberId: "not-a-member" }, [member]),
    null,
  );
  assert.equal(crewSendParams("crew-a", "conversation-a", { ...draft, text: "   " }, [member]), null);
  assert.equal(member.runtime, "claude-cli");
});

test("permission responses retain exact request identity; unsupported approval fails closed", () => {
  for (const approved of [true, false]) {
    assert.deepEqual(crewPermissionParams(execution, approved), {
      groupId: "crew-a",
      conversationId: "conversation-a",
      executionId: "exec-a",
      requestId: "request-a",
      approved,
    });
  }
  const unsupported = { ...execution, permission: { ...execution.permission!, canRespond: false } };
  assert.equal(crewPermissionParams(unsupported, true), null);
  assert.equal(crewPermissionParams(unsupported, false)?.approved, false);
  assert.equal(crewPermissionParams({ ...execution, taskId: null }, false), null);
  assert.equal(crewPermissionParams({ ...execution, permission: undefined }, false), null);
  for (const status of [
    "queued",
    "succeeded",
    "failed",
    "cancelled",
    "recovery_required",
  ] as const) {
    assert.equal(crewPermissionParams({ ...execution, status }, true), null);
    assert.equal(crewPermissionParams({ ...execution, status }, false), null);
  }
});

for (const locale of ["en-US", "zh-CN"] satisfies Locale[]) {
  const messages = locale === "en-US" ? en : zh;
  test(`editor retains every runtime selection and avoids internal-model hints (${locale})`, () => {
    for (const runtime of ["zcode", "claude-cli", "codex-cli", "opencode-cli"] as const) {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>
          <CrewAgentEditor
            agent={{
              agentId: member.agentId,
              configVersion: member.configVersion,
              name: member.name,
              runtime,
              accessMode: member.accessMode,
              systemPrompt: member.rolePrompt,
              createdAt: 0,
              updatedAt: 0,
            }}
            pending={false}
            onSave={async () => {}}
            onCancel={() => {}}
          />
        </ZCodeIntlProvider>,
      );
      assert.ok(html.includes(messages[`crew.runtime.${runtime}`]!));
      assert.match(html, /data-testid="crew-runtime-select"/);
      if (runtime !== "zcode") {
        assert.ok(html.includes(messages["crew.externalModel"]!));
        assert.ok(!html.includes(messages["crew.defaultModel"]!));
        assert.doesNotMatch(html, /crew-agent-model|crew-agent-tools/);
      }
    }
  });

  test(`board displays unavailable reason outside collapsed details, with no fallback (${locale})`, () => {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewBoard
          detail={{
            ...detail,
            runtimeAvailability: [
              {
                memberId: member.memberId,
                runtimeId: "claude-cli",
                available: false,
                reason: "<b>Binary not found</b>",
              },
            ],
          }}
          pending={false}
          onCancel={async () => {}}
          onRespondPermission={async () => {}}
        />
      </ZCodeIntlProvider>,
    );
    const summary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert.ok(summary.includes(messages["crew.runtimeUnavailable"]!));
    assert.match(summary, /&lt;b&gt;Binary not found&lt;\/b&gt;/);
    assert.ok(summary.includes(messages["crew.runtime.claude-cli"]!));
    assert.doesNotMatch(summary, /<span>ZCode<\/span>/);
    assert.doesNotMatch(html, /<script>|<b>Binary/);
  });

  test(`unverified and mismatched runtime probes are visibly unavailable (${locale})`, () => {
    for (const runtimeAvailability of [
      undefined,
      [{ memberId: member.memberId, runtimeId: "codex-cli" as const, available: true }],
    ]) {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>
          <CrewBoard
            detail={{ ...detail, runtimeAvailability }}
            pending={false}
            onCancel={async () => {}}
            onRespondPermission={async () => {}}
          />
        </ZCodeIntlProvider>,
      );
      assert.ok(html.includes(messages["crew.runtimeUnchecked"]!));
      assert.ok(html.includes(messages["crew.runtimeUnavailable"]!));
    }
  });

  test(`permissions explain unsupported approval and keep deny available (${locale})`, () => {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewPermissionRequest
          execution={{ ...execution, permission: { ...execution.permission!, canRespond: false } }}
          pending={false}
          onRespond={async () => {}}
        />
      </ZCodeIntlProvider>,
    );
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    assert.equal(buttons.length, 2);
    assert.match(buttons[0]!, /disabled=""/);
    assert.doesNotMatch(buttons[1]!, /disabled=""/);
    assert.ok(html.includes(messages["crew.permissionUnsupported"]!));
    assert.ok(html.includes(messages["crew.permissionDeny"]!));
    assert.match(html, /&lt;script&gt;request&lt;\/script&gt;/);
  });
}

test("supported permission actions are enabled; pending disables both without resolving request", () => {
  for (const pending of [true, false]) {
    let responses = 0;
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale="en-US">
        <CrewPermissionRequest
          execution={execution}
          pending={pending}
          onRespond={async () => {
            responses++;
          }}
        />
      </ZCodeIntlProvider>,
    );
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    assert.equal(buttons.length, 2);
    for (const button of buttons) assert.equal(button.includes('disabled=""'), pending);
    assert.match(html, /Read/);
    assert.equal(responses, 0);
  }
});

test("terminal and recovery-required records hide stale permission actions", () => {
  for (const status of [
    "queued",
    "succeeded",
    "failed",
    "cancelled",
    "recovery_required",
  ] as const) {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale="en-US">
        <CrewPermissionRequest
          execution={{ ...execution, status }}
          pending={false}
          onRespond={async () => {}}
        />
      </ZCodeIntlProvider>,
    );
    assert.equal(html, "");
  }
});

test("external runtime and permission admission failures have localized messages", () => {
  for (const key of [
    "runtimeUnavailable",
    "permissionUnsupported",
    "permissionNotFound",
    "externalFailed",
  ]) {
    assert.equal(crewErrorKey(`crew.${key}`), `error.${key}`);
    assert.ok(en[`crew.error.${key}`]);
    assert.ok(zh[`crew.error.${key}`]);
  }
});

for (const [locale, messages] of [
  ["en-US", en],
  ["zh-CN", zh],
] as const) {
  test(`preflight separates missing isolation and stale protocol without claiming availability (${locale})`, () => {
    for (const [reason, key] of [
      ["outer_isolation_missing", "crew.home.runtimeIsolationMissing"],
      [
        "crew/runtime unavailable: restart the server with a current Agent runtime",
        "crew.home.runtimeBridgeUnavailable",
      ],
    ]) {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>
          <CrewRuntimeStatus
            member={member}
            availability={[
              {
                memberId: member.memberId,
                runtimeId: "claude-cli",
                available: false,
                reason,
              },
            ]}
          />
        </ZCodeIntlProvider>,
      );
      assert(html.includes(messages[key!]!));
      assert(html.includes(messages["crew.runtimeUnavailable"]!));
      assert(!html.includes("outer_isolation_missing"));
    }
  });
}
