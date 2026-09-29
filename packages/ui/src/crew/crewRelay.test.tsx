import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewExecution, CrewRelay, CrewRelayParams, CrewUpdateParams } from "@zcode/shared";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewRelayCard } from "./CrewRelayCard.js";
import { CrewRelayPlans } from "./CrewRelayPlans.js";
import { CrewRelayControl } from "./CrewRelayControl.js";
import { CrewChatView } from "./CrewChatView.js";
import type { CrewController } from "../hooks/useCrew.js";
import { chatDetail, chatExecution, chatMessage } from "./crewChatFixtures.js";
import { crewComponentHarness, crewElementNodes as nodes } from "./crewChatHarness.js";
import * as relayUi from "./crewRelayUi.js";
import * as errors from "./crewErrors.js";
import en from "../i18n/locales/en-US.js";
import zh from "../i18n/locales/zh-CN.js";

const plan: CrewExecution = {
  ...chatExecution,
  rootRequestId: "root",
  hop: 0,
  relay: {
    kind: "plan",
    status: "awaiting_user_approval",
    to: "Builder",
    toMemberId: "b",
    objective: "Implement",
    context: "Use this design",
  },
};
const imports = {
  "@/hooks/useCrewText.js": { useCrewText: () => (key: string) => key },
  "@/components/ui/button.js": { Button: "button" },
  "@/components/ui/badge.js": { Badge: "span" },
  "./crewRelayUi.js": relayUi,
  "./crewErrors.js": errors,
};
const click = (tree: ReactNode, label: string) => {
  const button = nodes(tree).find((node) => node.props.children === label)!;
  assert.ok(button, label);
  (button.props.onClick as () => void)();
  return button;
};
const render = (node: ReactNode, locale: "en-US" | "zh-CN" = "en-US") =>
  renderToStaticMarkup(<ZCodeIntlProvider initialLocale={locale}>{node}</ZCodeIntlProvider>);

test("actual root plan callbacks approve/reject with execution scope; pending prevents repeat calls", async () => {
  const harness = await crewComponentHarness("CrewRelayCard.tsx", imports);
  const calls: CrewRelayParams[] = [];
  const props = {
    execution: plan,
    pending: false,
    onRespond: async (input: CrewRelayParams) => {
      calls.push(input);
    },
  };
  const tree = harness.render("CrewRelayCard", props);
  click(tree, "relay.approvePlan");
  click(tree, "relay.reject");
  assert.deepEqual(
    calls.map((call) => ({ ...call })),
    [true, false].map((approved) => ({
      groupId: "group",
      conversationId: "chat",
      executionId: "exec-a",
      approved,
    })),
  );
  const pending = harness.render("CrewRelayCard", { ...props, pending: true });
  assert.equal(click(pending, "relay.approvePlan").props.disabled, true);
  click(pending, "relay.reject");
  assert.equal(calls.length, 2);
});

test("blocked approval and non-successful execution cannot dispatch; rejection remains available", async () => {
  const harness = await crewComponentHarness("CrewRelayCard.tsx", imports);
  const calls: CrewRelayParams[] = [];
  for (const execution of [plan, { ...plan, status: "recovery_required" as const }]) {
    const tree = harness.render("CrewRelayCard", {
      execution,
      pending: false,
      approvalBlocked: execution === plan,
      onRespond: async (input: CrewRelayParams) => {
        calls.push(input);
      },
    });
    assert.equal(click(tree, "relay.approvePlan").props.disabled, true);
    click(tree, "relay.reject");
  }
  assert.deepEqual(
    calls.map((call) => call.approved),
    [false, false],
  );
  const detail = chatDetail();
  assert.equal(relayUi.crewRelayApprovalBlocked(detail, plan), false);
  for (const changed of [
    { ...detail, group: { ...detail.group, relayPaused: true } },
    { ...detail, group: { ...detail.group, epoch: 2 } },
    { ...detail, conversation: { ...detail.conversation, status: "recovery_required" as const } },
  ])
    assert.equal(relayUi.crewRelayApprovalBlocked(changed, plan), true);
});

test("hop>0 return to planner is a regular handoff, with real approval callback", async () => {
  const harness = await crewComponentHarness("CrewRelayCard.tsx", imports);
  const calls: CrewRelayParams[] = [];
  const execution = {
    ...plan,
    hop: 2,
    relay: { ...plan.relay!, kind: "handoff" as const, to: plan.memberSnapshot.name },
  };
  const tree = harness.render("CrewRelayCard", {
    execution,
    pending: false,
    onRespond: async (params: CrewRelayParams) => {
      calls.push(params);
    },
  });
  assert.equal(nodes(tree)[0]!.props["data-testid"], "crew-relay-card");
  assert.equal(relayUi.crewPendingPlan({ ...execution, relay: plan.relay }), false);
  click(tree, "relay.approve");
  assert.equal(calls[0]?.executionId, plan.executionId);
});

test("root plan is above the timeline, scoped and single; text tags are presentation only", () => {
  const detail = chatDetail({
    executions: [plan, { ...plan, executionId: "foreign", conversationId: "elsewhere" }],
    messages: [
      chatMessage({
        sender: "member",
        memberId: "a",
        executionId: plan.executionId,
        text: 'Plan summary <crew-handoff>{"to":"Untrusted"}</crew-handoff>',
      }),
    ],
  });
  detail.conversation.status = "awaiting_user_approval";
  const html = render(<CrewChatView detail={detail} crew={{ pending: false } as CrewController} />);
  assert.ok(
    html.indexOf('data-testid="crew-relay-plan"') <
      html.indexOf('data-testid="crew-execution-row"'),
  );
  assert.equal((html.match(/data-testid="crew-relay-plan"/g) ?? []).length, 1);
  assert.match(html, /Plan summary/);
  assert.match(html, /Builder/);
  assert.match(html, /Awaiting relay approval/);
  assert.doesNotMatch(html, /Untrusted|&lt;crew-handoff|foreign/);
  assert.equal(
    render(
      <CrewRelayPlans
        detail={{ ...detail, conversation: { ...detail.conversation, groupId: "foreign" } }}
        pending={false}
      />,
    ),
    "",
  );
  assert.equal(
    relayUi.crewRelayDisplayText("@Builder do not dispatch"),
    "@Builder do not dispatch",
  );
});

test("automatic A→B badge, terminal states and fixed reasons render in both languages without raw errors", () => {
  const reasons = [
    "relayHopLimit",
    "relayBudgetExceeded",
    "relayDuplicate",
    "relayRuntimeUnavailable",
    "relayRecoveryRequired",
    "relayBindingChanged",
    "relayMemberNotFound",
    "relayCancelled",
    "relayFailed",
  ] as const;
  for (const locale of ["en-US", "zh-CN"] as const) {
    const messages = locale === "en-US" ? en : zh;
    const automatic = render(
      <CrewRelayCard
        execution={{ ...plan, relay: { ...plan.relay!, status: "dispatched", automatic: true } }}
        pending={false}
      />,
      locale,
    );
    assert.match(automatic, /data-testid="crew-relay-automatic"/);
    assert.match(automatic, /Original Analyst → Builder/);
    assert.doesNotMatch(automatic, /<button/);
    for (const reason of reasons) {
      const html = render(
        <CrewRelayCard
          execution={{ ...plan, relay: { ...plan.relay!, status: "blocked", reason } }}
          pending={false}
        />,
        locale,
      );
      assert.ok(html.includes(messages[`crew.error.${reason}`]!));
      assert.doesNotMatch(html, /<button/);
    }
    const html = render(
      <CrewRelayCard
        execution={{
          ...plan,
          relay: {
            ...plan.relay!,
            status: "blocked",
            reason: "secret-path-token" as CrewRelay["reason"],
          },
        }}
        pending={false}
      />,
      locale,
    );
    assert.doesNotMatch(html, /secret-path-token/);
  }
  for (const [key, value] of Object.entries(en).filter(
    ([key]) => key.startsWith("crew.relay.") || key.startsWith("crew.error.relay"),
  )) {
    assert.ok(zh[key], key);
    assert.deepEqual(value.match(/\{\w+\}/g), zh[key]!.match(/\{\w+\}/g), key);
  }
});

test("busy pause/resume sends only group update; it never approves or replays", async () => {
  const harness = await crewComponentHarness("CrewRelayControl.tsx", imports);
  const calls: CrewUpdateParams[] = [];
  const props = {
    group: { ...chatDetail().group, status: "active" },
    pending: false,
    onUpdate: async (input: CrewUpdateParams) => {
      calls.push(input);
    },
  };
  click(harness.render("CrewRelayControl", props), "relay.pause");
  const paused = { ...props, group: { ...props.group, relayPaused: true } };
  click(harness.render("CrewRelayControl", paused), "relay.resume");
  click(harness.render("CrewRelayControl", { ...props, pending: true }), "relay.pause");
  assert.deepEqual(
    calls.map((call) => ({ ...call })),
    [
      { groupId: "group", relayPaused: true },
      { groupId: "group", relayPaused: false },
    ],
  );
  assert.match(
    render(
      <CrewRelayControl group={chatDetail().group} pending={false} onUpdate={async () => {}} />,
    ),
    /Automatic · 30 minutes · Max 8 hops/,
  );
});

test("another conversation recovery does not block this conversation approval", () => {
  const detail = chatDetail({
    executions: [plan, { ...chatExecution, status: "recovery_required", conversationId: "other" }],
  });
  detail.group.status = "recovery_required";
  assert.equal(relayUi.crewRelayApprovalBlocked(detail, plan), false);
  const html = render(
    <CrewRelayPlans detail={detail} pending={false} onRespond={async () => {}} />,
  );
  assert.doesNotMatch(html, /<button[^>]* disabled=""/);
  detail.executions[1]!.conversationId = detail.conversation.conversationId;
  assert.equal(relayUi.crewRelayApprovalBlocked(detail, plan), true);
});
