import * as relayUi from "./crewRelayUi.js";
import { CrewRelayCard } from "./CrewRelayCard.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as presentation from "./crewChatPresentation.js";
import * as errors from "./crewErrors.js";
import { avatarColor } from "../components/workflow-timeline/WorkflowAgentFace.js";
// harness 是白名单式桩：组件每引入一个外部依赖都要在这里登记，否则抛 Unexpected component dependency。
import { cn } from "../components/lib/utils.js";
import { chatDetail, chatExecution, chatMessage } from "./crewChatFixtures.js";
import { crewComponentHarness, crewElementNodes, type ChatElement } from "./crewChatHarness.js";

const text = (key: string, values?: Record<string, string | number>) =>
  `${key}${values ? ` ${Object.values(values).join(" → ")}` : ""}`;
const baseImports = {
  "./crewRelayUi.js": relayUi,
  "./CrewRelayCard.js": { CrewRelayCard },
  "./CrewRelayControl.js": { CrewRelayControl: () => null },
  "./CrewRelayPlans.js": { CrewRelayPlans: () => null },
  "@/hooks/useCrewText.js": { useCrewText: () => text },
  "@/components/ui/button.js": { Button: "button" },
  "@/components/workflow-timeline/WorkflowAgentFace.js": { avatarColor },
  "@/components/lib/utils.js": { cn },
  "lucide-react": {
    ChevronDown: "i",
    ChevronRight: "i",
    Clock3: "i",
    ArrowRight: "i",
    UserRound: "i",
    MessageSquare: "i",
  },
  "./CrewStatus.js": { CrewStatus: ({ status }: { status: string }) => <span>{status}</span> },
  "./crewChatPresentation.js": presentation,
};
const Details = () => <div data-testid="actual-detail-boundary" />;
const Permission = () => <div data-testid="permission-boundary" />;
const Composer = () => <div data-testid="composer-boundary" />;
const Stream = () => <div data-testid="stream-boundary" />;
const Row = () => <div data-testid="row-boundary" />;
const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
const rowImports = {
  ...baseImports,
  "./CrewExecutionDetails.js": { CrewExecutionDetails: Details },
  "./CrewPermissionRequest.js": { CrewPermissionRequest: Permission },
};
const streamImports = {
  ...baseImports,
  "./crewErrors.js": errors,
  "./CrewExecutionRow.js": { CrewExecutionRow: Row },
  "@/components/ai-elements/conversation.js": {
    Conversation: passthrough,
    ConversationContent: passthrough,
    ConversationScrollButton: () => <button />,
    ConversationEmptyState: ({ title }: { title: string }) => <p>{title}</p>,
  },
};
const viewImports = {
  ...baseImports,
  "./CrewComposer.js": { CrewComposer: Composer },
  "./CrewMessageStream.js": { CrewMessageStream: Stream },
  "./CrewRuntimeStatus.js": { CrewRuntimeStatus: () => <span /> },
  "./CrewConversations.js": {
    crewConversationTitle: (conversation: { name: string }) => conversation.name,
  },
};
const nodes = crewElementNodes;
const click = (node: ChatElement | undefined) => {
  assert.ok(node, "expected clickable component");
  (node.props.onClick as () => void)();
};
const findType = (tree: ReactNode, type: unknown) =>
  nodes(tree).find((node) => node.type === type)!;
const countType = (tree: ReactNode, type: unknown) =>
  nodes(tree).filter((node) => node.type === type).length;

test("execution disclosure is a native keyboard button; details exist only between expand/collapse callbacks", async () => {
  const harness = await crewComponentHarness("CrewExecutionRow.tsx", rowImports);
  const props = {
    execution: chatExecution,
    pending: false,
    onCancel: async () => {},
    onRespondPermission: async () => {},
  };
  const render = () => harness.render("CrewExecutionRow", props);
  let tree = render();
  const disclosure = (value: ReactNode) =>
    nodes(value).find((node) => "aria-expanded" in node.props)!;
  assert.equal(disclosure(tree).type, "button");
  assert.equal(disclosure(tree).props.type, "button");
  assert.equal(disclosure(tree).props["aria-expanded"], false);
  assert.equal(countType(tree, Details), 0);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Original Analyst/);
  assert.match(html, /succeeded/);
  assert.match(html, /runtime.zcode/);
  assert.match(html, /1:05/);
  click(disclosure(tree));
  tree = render();
  assert.equal(disclosure(tree).props["aria-expanded"], true);
  assert.equal(countType(tree, Details), 1);
  assert.equal(findType(tree, Details).props.execution, chatExecution);
  const panel = nodes(tree).find((node) => node.props.role === "region")!;
  assert.equal(disclosure(tree).props["aria-controls"], panel.props.id);
  click(disclosure(tree));
  assert.equal(countType(render(), Details), 0);
});

test("running rows keep cancel and permissions outside disclosure; pending blocks cancellation", async () => {
  const harness = await crewComponentHarness("CrewExecutionRow.tsx", rowImports);
  const execution = { ...chatExecution, status: "running", permission: { requestId: "request" } };
  const cancelled: string[] = [];
  const respond = async () => {};
  const props = {
    execution,
    pending: false,
    onCancel: async (id: string) => {
      cancelled.push(id);
    },
    onRespondPermission: respond,
  };
  let tree = harness.render("CrewExecutionRow", props);
  assert.equal(countType(tree, Details), 0);
  assert.equal(findType(tree, Permission).props.onRespond, respond);
  assert.equal(findType(tree, Permission).props.execution, execution);
  const cancel = (value: ReactNode) =>
    nodes(value).find((node) => node.props.children === "cancel");
  click(cancel(tree));
  assert.deepEqual(cancelled, ["exec-a"]);
  tree = harness.render("CrewExecutionRow", { ...props, pending: true });
  assert.equal(cancel(tree)?.props.disabled, true);
  click(cancel(tree));
  assert.deepEqual(cancelled, ["exec-a"]);
  assert.equal(findType(tree, Permission).props.pending, true);
  // 待恢复仍未终结；取消走服务端安全停止，不应被 live 计时条件隐藏。
  tree = harness.render("CrewExecutionRow", {
    ...props,
    execution: { ...execution, status: "recovery_required" },
  });
  click(cancel(tree));
  assert.deepEqual(cancelled, ["exec-a", "exec-a"]);
  tree = harness.render("CrewExecutionRow", {
    ...props,
    pending: true,
    execution: { ...execution, status: "recovery_required" },
  });
  assert.equal(cancel(tree)?.props.disabled, true);
  click(cancel(tree));
  assert.deepEqual(cancelled, ["exec-a", "exec-a"]);
  for (const status of ["failed", "cancelled", "succeeded"]) {
    tree = harness.render("CrewExecutionRow", { ...props, execution: { ...execution, status } });
    assert.equal(cancel(tree), undefined);
    assert.equal(countType(tree, Permission), 0);
  }
});

test("actual message stream renders one header per adjacent sender group and scoped execution rows", async () => {
  const harness = await crewComponentHarness("CrewMessageStream.tsx", streamImports);
  const detail = chatDetail({
    messages: [
      chatMessage(),
      chatMessage({
        messageId: "reply",
        sequence: 2,
        sender: "member",
        memberId: "a",
        executionId: "exec-a",
        text: "answer",
        createdAt: 2000,
        mentions: [],
      }),
      chatMessage({
        messageId: "reply-2",
        sequence: 3,
        sender: "member",
        memberId: "a",
        executionId: "exec-a",
        text: "more",
        createdAt: 3000,
        mentions: [],
      }),
      chatMessage({ messageId: "foreign", conversationId: "other", sequence: 4, text: "FOREIGN" }),
    ],
    executions: [
      chatExecution,
      { ...chatExecution, executionId: "foreign-exec", conversationId: "other" },
    ],
  });
  const tree = harness.render("CrewMessageStream", {
    detail,
    pending: false,
    onCancel: async () => {},
    onRespondPermission: async () => {},
  });
  assert.equal(
    nodes(tree).filter((node) => node.props["data-testid"] === "crew-message-group").length,
    2,
  );
  assert.equal(countType(tree, Row), 1);
  assert.equal(findType(tree, Row).props.execution, chatExecution);
  // Private body functions still execute their real source with controlled hook cells.
  const expandedBodies = nodes(tree)
    .filter((node) => typeof node.type === "function" && "item" in node.props)
    .map((node) => harness.renderElement(node));
  const html = expandedBodies.map((body) => renderToStaticMarkup(body)).join("");
  assert.match(html, /answer/);
  assert.match(html, /@Original Analyst/);
  assert.doesNotMatch(html, /FOREIGN|Renamed Analyst/);
  assert.equal(avatarColor("a"), avatarColor(detail.resolvedMembers[0]!.memberId));
});

test("long agent body toggles actual text and aria state; user text stays unfolded", async () => {
  const harness = await crewComponentHarness("CrewMessageStream.tsx", streamImports);
  const full = `${"reply ".repeat(250)}END-MARKER`;
  const detail = chatDetail({
    executions: [],
    messages: [chatMessage({ sender: "member", memberId: "a", text: full, mentions: [] })],
  });
  const tree = harness.render("CrewMessageStream", { detail, pending: false });
  const body = nodes(tree).find((node) => typeof node.type === "function" && "item" in node.props)!;
  let rendered = harness.renderElement(body);
  const toggle = (value: ReactNode) => nodes(value).find((node) => "aria-expanded" in node.props)!;
  assert.equal(toggle(rendered).props["aria-expanded"], false);
  assert.doesNotMatch(renderToStaticMarkup(rendered), /END-MARKER/);
  click(toggle(rendered));
  rendered = harness.renderElement(body);
  assert.equal(toggle(rendered).props["aria-expanded"], true);
  assert.match(renderToStaticMarkup(rendered), /END-MARKER/);
  click(toggle(rendered));
  assert.doesNotMatch(renderToStaticMarkup(harness.renderElement(body)), /END-MARKER/);
  const userBody = createElement(body.type, {
    ...body.props,
    item: { message: chatMessage({ text: full, mentions: [] }), mentions: [] },
  }) as ChatElement;
  rendered = harness.renderElement(userBody);
  assert.equal(toggle(rendered), undefined);
  assert.match(renderToStaticMarkup(rendered), /END-MARKER/);
});

test("chat passes scoped send/cancel/permission/relay and clears draft only for current successful send", async () => {
  const harness = await crewComponentHarness("CrewChatView.tsx", viewImports);
  const detail = chatDetail();
  const calls: unknown[] = [];
  let current = true;
  let ok = true;
  const crew = {
    pending: false,
    send: async (params: unknown) => {
      calls.push(params);
      return { ok, isCurrent: () => current };
    },
    cancel: async (params: unknown) => {
      calls.push(params);
    },
    respondPermission: async (params: unknown) => {
      calls.push(params);
    },
    respondRelay: async (params: unknown) => {
      calls.push(params);
    },
    update: async (params: unknown) => {
      calls.push(params);
    },
  };
  const tree = harness.render("CrewChatView", { detail, crew });
  const composer = findType(tree, Composer);
  assert.equal(composer.key, "group:chat:1");
  assert.equal(composer.props.conversation, detail.conversation);
  const send = composer.props.onSend as (params: unknown) => Promise<boolean>;
  const input = { groupId: "group", conversationId: "chat", text: "request" };
  assert.equal(await send(input), true);
  current = false;
  assert.equal(await send(input), false);
  current = true;
  ok = false;
  assert.equal(await send(input), false);
  const stream = findType(tree, Stream);
  await (stream.props.onCancel as (id: string) => Promise<void>)("exec-a");
  assert.deepEqual(
    { ...(calls.at(-1) as object) },
    { groupId: "group", conversationId: "chat", executionId: "exec-a" },
  );
  const permission = { ...input, executionId: "exec-a", requestId: "permission", approved: false };
  await (stream.props.onRespondPermission as (params: unknown) => Promise<void>)(permission);
  assert.equal(calls.at(-1), permission);
  const decision = {
    groupId: "group",
    conversationId: "chat",
    executionId: "exec-a",
    approved: true,
  };
  await (stream.props.onRespondRelay as (params: unknown) => Promise<void>)(decision);
  assert.equal(calls.at(-1), decision);
  const plans = findType(tree, viewImports["./CrewRelayPlans.js"].CrewRelayPlans);
  await (plans.props.onRespond as (params: unknown) => Promise<void>)({
    ...decision,
    approved: false,
  });
  assert.deepEqual(calls.at(-1), { ...decision, approved: false });
  const control = findType(tree, viewImports["./CrewRelayControl.js"].CrewRelayControl);
  const pause = { groupId: "group", relayPaused: true };
  await (control.props.onUpdate as (params: unknown) => Promise<void>)(pause);
  assert.equal(calls.at(-1), pause);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden/);
  assert.match(html, /shrink-0 border-t/);
});

test("only active/recovery chats show recovery, failed remains sendable, and pending recovery is guarded", async () => {
  const harness = await crewComponentHarness("CrewChatView.tsx", viewImports);
  const recovered: unknown[] = [];
  for (const status of ["idle", "failed", "active", "recovery_required"] as const) {
    const detail = chatDetail();
    detail.conversation.status = status;
    const crew = {
      pending: false,
      recover: async (params: unknown) => {
        recovered.push(params);
      },
    };
    const tree = harness.render("CrewChatView", { detail, crew });
    const recovery = nodes(tree).find((node) => node.props.children === "recover");
    assert.equal(Boolean(recovery), status === "active" || status === "recovery_required");
    assert.equal(findType(tree, Composer).props.pending, false);
    if (recovery) click(recovery);
  }
  assert.equal(recovered.length, 2);
  assert.deepEqual(
    { ...(recovered[0] as object) },
    { groupId: "group", conversationId: "chat", confirm: true },
  );
  const detail = chatDetail();
  detail.conversation.status = "active";
  const tree = harness.render("CrewChatView", {
    detail,
    crew: { pending: true, recover: () => assert.fail("pending recovery") },
  });
  click(nodes(tree).find((node) => node.props.children === "recover"));
});

test("covered chat preserves its composer while suspending expanded execution details", async () => {
  const row = await crewComponentHarness("CrewExecutionRow.tsx", rowImports);
  const props = {
    execution: chatExecution,
    pending: false,
    onCancel: async () => {},
    onRespondPermission: async () => {},
  };
  click(nodes(row.render("CrewExecutionRow", props)).find((node) => "aria-expanded" in node.props));
  assert.equal(countType(row.render("CrewExecutionRow", { ...props, visible: false }), Details), 0);
  assert.equal(countType(row.render("CrewExecutionRow", { ...props, visible: true }), Details), 1);
  const view = await crewComponentHarness("CrewChatView.tsx", viewImports);
  const visible = view.render("CrewChatView", {
    detail: chatDetail(),
    crew: { pending: false },
    visible: true,
  });
  const covered = view.render("CrewChatView", {
    detail: chatDetail(),
    crew: { pending: false },
    visible: false,
  });
  assert.equal(findType(covered, Composer).key, findType(visible, Composer).key);
  assert.equal(findType(covered, Stream).props.visible, false);
});
