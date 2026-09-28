import assert from "node:assert/strict";
import test from "node:test";
import { crewChatEntries, crewReplyPreview, crewExecutionElapsed } from "./crewChatPresentation.js";
import { chatDetail, chatExecution, chatMember, chatMessage } from "./crewChatFixtures.js";

test("adjacent senders group without mutating input, and epochs split groups", () => {
  const messages = [
    chatMessage({ messageId: "second", sequence: 2, mentions: [] }),
    chatMessage({ messageId: "first", sequence: 1, mentions: [] }),
    chatMessage({ messageId: "epoch", sequence: 3, epoch: 2, mentions: [] }),
    chatMessage({ messageId: "agent", sequence: 4, epoch: 2, sender: "member", memberId: "a" }),
  ];
  const entries = crewChatEntries(chatDetail({ messages, executions: [] }));
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.kind, "messages");
  if (entries[0]?.kind !== "messages") return;
  assert.deepEqual(
    entries[0].messages.map(({ message }) => message.messageId),
    ["first", "second"],
  );
  assert.equal(messages[0]?.messageId, "second");
});

test("execution chronology follows dispatch sequence, not completion or reply time", () => {
  const entries = crewChatEntries(
    chatDetail({
      messages: [
        chatMessage({
          messageId: "reply",
          sequence: 2,
          createdAt: 66000,
          sender: "member",
          memberId: "a",
          executionId: "exec-a",
        }),
        chatMessage(),
        chatMessage({ messageId: "later", sequence: 3, createdAt: 67000, mentions: [] }),
      ],
    }),
  );
  assert.deepEqual(
    entries.map((item) => item.kind),
    ["messages", "execution", "messages", "messages"],
  );
  const reply = entries[2];
  assert.equal(reply?.kind === "messages" && reply.sender.name, "Original Analyst");
  const request = entries[0];
  assert.equal(
    request?.kind === "messages" && request.messages[0]?.mentions[0]?.name,
    "Original Analyst",
  );
});

test("foreign group/conversation messages, snapshots, and permission rows never enter chat", () => {
  const entries = crewChatEntries(
    chatDetail({
      messages: [chatMessage({ conversationId: "other" }), chatMessage({ groupId: "other" })],
      executions: [
        { ...chatExecution, conversationId: "other" },
        { ...chatExecution, groupId: "other" },
      ],
    }),
  );
  assert.deepEqual(entries, []);
});

test("historical snapshots survive removal and snapshot revisions split adjacent sender groups", () => {
  const second = {
    ...chatExecution,
    executionId: "exec-b",
    messageId: "missing",
    createdAt: 500,
    memberSnapshot: { ...chatMember, name: "Later Analyst", configVersion: "v2" },
  };
  const entries = crewChatEntries(
    chatDetail({
      resolvedMembers: [],
      executions: [chatExecution, second],
      messages: [
        chatMessage({
          messageId: "reply-a",
          sequence: 1,
          sender: "member",
          memberId: "a",
          executionId: "exec-a",
          createdAt: 2000,
        }),
        chatMessage({
          messageId: "reply-b",
          sequence: 2,
          sender: "member",
          memberId: "a",
          executionId: "exec-b",
          createdAt: 3000,
        }),
      ],
    }),
  );
  const groups = entries.filter((entry) => entry.kind === "messages");
  assert.deepEqual(
    groups.map((entry) => entry.sender.name),
    ["Original Analyst", "Later Analyst"],
  );
});

test("structured A to B handoffs use recipient dispatch snapshot, not sender snapshot or current catalog", () => {
  const handoff = chatMessage({
    messageId: "handoff",
    sender: "member",
    memberId: "a",
    executionId: "exec-a",
    mentions: ["b"],
    createdAt: 2000,
  });
  const recipient = {
    ...chatExecution,
    executionId: "exec-b",
    messageId: "handoff",
    memberId: "b",
    memberSnapshot: { ...chatMember, memberId: "b", name: "Original Builder" },
    createdAt: 2000,
  };
  const entries = crewChatEntries(
    chatDetail({ messages: [handoff], executions: [chatExecution, recipient] }),
  );
  const group = entries.find((entry) => entry.kind === "messages");
  assert.equal(group?.sender.name, "Original Analyst");
  assert.equal(group?.messages[0]?.mentions[0]?.name, "Original Builder");
});

test("fallback snapshots never cross epochs or borrow a future name", () => {
  const entries = crewChatEntries(
    chatDetail({
      resolvedMembers: [],
      messages: [chatMessage({ sender: "member", memberId: "a", epoch: 2, executionId: "exec-a" })],
    }),
  );
  const group = entries.find((entry) => entry.kind === "messages");
  assert.equal(group?.sender.name, null);
  const future = crewChatEntries(
    chatDetail({
      resolvedMembers: [],
      executions: [{ ...chatExecution, createdAt: 9000 }],
      messages: [
        chatMessage({ sender: "member", memberId: "a", executionId: null, createdAt: 100 }),
      ],
    }),
  );
  assert.equal(future.find((entry) => entry.kind === "messages")?.sender.name, null);
});

test("reply folding preserves short text and bounds long lines and multi-line replies", () => {
  assert.equal(crewReplyPreview("short"), null);
  assert.ok(crewReplyPreview("x".repeat(1201))!.length <= 601);
  assert.ok(crewReplyPreview("line\n".repeat(17))!.split("\n").length <= 9);
});

test("elapsed time uses terminal timestamps and a supplied live clock, clamped at zero", () => {
  assert.equal(crewExecutionElapsed(chatExecution, 999999), "1:05");
  assert.equal(crewExecutionElapsed({ ...chatExecution, status: "running" }, 3602000), "1:00:01");
  assert.equal(crewExecutionElapsed({ ...chatExecution, status: "queued" }, 500), "0:00");
});
