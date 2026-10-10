import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewController } from "../hooks/useCrew.js";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewChatView } from "./CrewChatView.js";
import { CrewExecutionRow } from "./CrewExecutionRow.js";
import { chatDetail, chatExecution, chatMessage } from "./crewChatFixtures.js";
import { homeChatEn, homeChatZh } from "./homeChatMessages.js";

for (const locale of ["en-US", "zh-CN"] as const) {
  test(`real homepage component renders scoped grouped chat and collapsed details (${locale})`, () => {
    const detail = chatDetail({
      messages: [
        chatMessage(),
        chatMessage({
          messageId: "reply",
          sequence: 2,
          sender: "member",
          memberId: "a",
          executionId: "exec-a",
          text: "<script>Never execute</script>",
          createdAt: 2000,
          mentions: [],
        }),
        chatMessage({
          messageId: "reply-2",
          sequence: 3,
          sender: "member",
          memberId: "a",
          executionId: "exec-a",
          text: `${"Long reply ".repeat(150)}LAST-SECRET-LINE`,
          createdAt: 3000,
          mentions: [],
        }),
        chatMessage({
          messageId: "foreign",
          sequence: 4,
          conversationId: "elsewhere",
          text: "FOREIGN-CHAT",
        }),
      ],
    });
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewChatView detail={detail} crew={{ pending: false } as CrewController} />
      </ZCodeIntlProvider>,
    );
    assert.match(html, /data-testid="crew-chat"/);
    // 执行归属于发起它的成员，不再是无主的系统事件。
    assert.match(html, /data-sender="a"/);
    assert.doesNotMatch(html, /data-sender="system"/);
    assert.equal((html.match(/data-testid="crew-message-group"/g) ?? []).length, 2);
    assert.equal((html.match(/data-testid="crew-execution-row"/g) ?? []).length, 1);
    assert.match(html, /@Original Analyst/);
    assert.match(html, /&lt;script&gt;Never execute&lt;\/script&gt;/);
    assert.match(html, /1:05/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /<textarea/);
    assert.doesNotMatch(
      html,
      /FOREIGN-CHAT|LAST-SECRET-LINE|data-testid="crew-v4-detail"|data-testid="crew-external-detail"/,
    );
  });
}

test("real external row uses historical runtime and does not read details while collapsed", () => {
  const execution = {
    ...chatExecution,
    memberSnapshot: { ...chatExecution.memberSnapshot, runtime: "codex-cli" as const },
  };
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <CrewExecutionRow
        execution={execution}
        pending={false}
        onCancel={async () => {
          assert.fail("render cannot cancel");
        }}
        onRespondPermission={async () => {
          assert.fail("render cannot grant");
        }}
      />
    </ZCodeIntlProvider>,
  );
  assert.match(html, /Original Analyst/);
  assert.match(html, /Codex CLI/);
  assert.doesNotMatch(html, /crew-external-detail|crew-permission/);
});

test("locale handoff contains identical populated keys and interpolation slots", () => {
  assert.deepEqual(Object.keys(homeChatEn).sort(), Object.keys(homeChatZh).sort());
  for (const key of Object.keys(homeChatEn) as (keyof typeof homeChatEn)[]) {
    assert.ok(homeChatEn[key].length && homeChatZh[key].length);
    assert.deepEqual(homeChatEn[key].match(/\{\w+\}/g), homeChatZh[key].match(/\{\w+\}/g));
  }
});
