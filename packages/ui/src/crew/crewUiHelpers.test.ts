import assert from "node:assert/strict";
import test from "node:test";
import type { CrewGroup, CrewResolvedMember } from "@zcode/shared";
import { mapCrewMembersToMentionItems } from "../mentions/providers/crewMentionProvider.js";
import {
  crewBindingKey,
  crewEnterSubmits,
  crewSendParams,
  editCrewDraft,
  isCrewBusy,
  newCrewDraft,
  opensCrewMentionPicker,
} from "./crewUiHelpers.js";

const member: CrewResolvedMember = {
  memberId: "member-1",
  agentId: "agent-1",
  configVersion: "v1",
  name: "Reviewer",
  rolePrompt: "Inspect changes and report evidence.",
  runtime: "zcode",
  accessMode: "read",
};

test("crew provider preserves same-name members and selects by memberId, not agentId", () => {
  const items = mapCrewMembersToMentionItems([member, { ...member, memberId: "member-2" }]);
  assert.deepEqual(
    items.map((item) => item.value),
    ["member-1", "member-2"],
  );
  assert.ok(items[0]);
  assert.equal(items[0].description, member.rolePrompt);
  assert.equal(items[0].markdown, "");
});

test("typing or pasting @ and markdown never assigns work", () => {
  const draft = { ...newCrewDraft(), text: "@Reviewer [Reviewer](crew-member:member-1)" };
  assert.deepEqual(crewSendParams("crew-1", "conversation-a", draft, [member])?.mentions, []);
  assert.deepEqual(
    crewSendParams("crew-1", "conversation-a", { ...draft, memberId: member.memberId }, [member])
      ?.mentions,
    ["member-1"],
  );
});

test("removed/foreign selected member and empty messages fail closed", () => {
  const draft = { ...newCrewDraft(), text: "Review", memberId: "foreign" };
  assert.equal(crewSendParams("crew-1", "conversation-a", draft, [member]), null);
  assert.equal(
    crewSendParams("crew-1", "conversation-a", { ...draft, memberId: null, text: "  " }, [member]),
    null,
  );
  assert.equal(
    crewSendParams(
      "crew-1",
      "conversation-a",
      { ...draft, memberId: null, text: "x".repeat(64001) },
      [member],
    ),
    null,
  );
});

test("failed send retries retain messageId; changing text or assignment rotates it", () => {
  const initial = editCrewDraft(newCrewDraft(), { text: "Review" });
  assert.deepEqual(
    crewSendParams("crew-1", "conversation-a", initial, [member]),
    crewSendParams("crew-1", "conversation-a", initial, [member]),
  );
  assert.equal(editCrewDraft(initial, { text: initial.text }), initial);
  assert.notEqual(editCrewDraft(initial, { text: "Changed" }).messageId, initial.messageId);
  assert.notEqual(
    editCrewDraft(initial, { memberId: member.memberId }).messageId,
    initial.messageId,
  );
  assert.deepEqual(
    crewSendParams("crew-1", "conversation-a", editCrewDraft(initial, { memberId: null }), [member])
      ?.mentions,
    [],
  );
});

test("busy/recovery groups cannot rebind; workspace identity takes priority over path", () => {
  for (const status of ["active", "recovery_required"] as const) {
    assert.equal(isCrewBusy({ status } as CrewGroup), true);
  }
  assert.equal(isCrewBusy({ status: "idle" } as CrewGroup), false);
  assert.equal(
    crewBindingKey({ workspacePath: "/same", workspaceIdentity: " remote:one " }),
    "remote:one",
  );
  assert.equal(crewBindingKey({ workspacePath: "/same", workspaceIdentity: " " }), "/same");
});

test("typing a standalone @ opens selection, while email or IME input does not", () => {
  assert(opensCrewMentionPicker("@", false, "", 0));
  assert(opensCrewMentionPicker("@", false, "please ", 7));
  assert(!opensCrewMentionPicker("@", false, "email", 5));
  assert(!opensCrewMentionPicker("@", true, "", 0));
  assert(!opensCrewMentionPicker("v", false, "@Reviewer", 9));
});

test("bare Enter submits the crew composer, modifiers and IME keep newline", () => {
  // 群聊此前只能点「发送」：裸 Enter 换行，用户以为没反应。
  assert(crewEnterSubmits({ key: "Enter" }));
  assert(!crewEnterSubmits({ key: "Enter", shiftKey: true }));
  assert(!crewEnterSubmits({ key: "Enter", ctrlKey: true }));
  assert(!crewEnterSubmits({ key: "Enter", metaKey: true }));
  // IME 组合态的 Enter 是候选确认，不能发送，否则中文输入会被吃掉半句。
  assert(!crewEnterSubmits({ key: "Enter", isComposing: true }));
  // @ 选择器打开时 Enter 归 picker。
  assert(!crewEnterSubmits({ key: "Enter", pickerOpen: true }));
  assert(!crewEnterSubmits({ key: "a" }));
  assert(!crewEnterSubmits({ key: " " }));
});

test("dispatch is not blocked by runtime probe state; unknown member is still rejected", () => {
  for (const runtime of ["claude-cli", "codex-cli", "opencode-cli"] as const) {
    const external = { ...member, runtime };
    const draft = { ...newCrewDraft(), text: "Inspect", memberId: member.memberId };
    // probe 不可用也不阻塞派工；执行边界负责真实校验。
    // 数组按值比较：assert.equal 在 strict 模式下比引用，永远与字面量数组不等。
    assert.deepEqual(
      crewSendParams(
        "group-a",
        "conversation-a",
        draft,
        [external],
        [{ memberId: member.memberId, runtimeId: runtime, available: false }],
      )?.mentions,
      [member.memberId],
    );
    // 成员不存在仍拒绝，@ 正文不能凭空派工。
    assert.equal(
      crewSendParams("group-a", "conversation-a", draft, [
        { ...external, memberId: "other-member" },
      ]),
      null,
    );
  }
});
