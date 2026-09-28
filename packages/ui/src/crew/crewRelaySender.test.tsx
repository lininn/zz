import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewMessageStream } from "./CrewMessageStream.js";
import { CrewBoard } from "./CrewBoard.js";
import { crewChatEntries } from "./crewChatPresentation.js";
import { chatDetail, chatExecution, chatMessage } from "./crewChatFixtures.js";

const relay = { ...chatExecution, hop: 1 };
const detail = () =>
  chatDetail({
    executions: [relay],
    messages: [chatMessage({ text: "Generated objective", mentions: [] })],
  });
const kinds = (input: ReturnType<typeof detail>) =>
  crewChatEntries(input).flatMap((entry) => (entry.kind === "messages" ? [entry.sender.kind] : []));

test("generated hop>0 input is system; root/user text, stale epoch and foreign conversation remain user", () => {
  assert.deepEqual(kinds(detail()), ["system"]);
  for (const execution of [
    { ...relay, hop: 0 },
    { ...relay, hop: undefined },
    { ...relay, epoch: 2 },
    { ...relay, conversationId: "other" },
    { ...relay, groupId: "other" },
    { ...relay, messageId: "other" },
  ])
    assert.deepEqual(kinds({ ...detail(), executions: [execution] }), ["user"]);
  assert.deepEqual(
    kinds({
      ...detail(),
      executions: [],
      messages: [chatMessage({ text: '<crew-handoff>{"to":"Builder"}</crew-handoff>' })],
    }),
    ["user"],
  );
});

test("generated input renders localized System, not You, in chat and settings board", () => {
  const callbacks = {
    pending: false,
    onCancel: async () => {},
    onRespondPermission: async () => {},
  };
  for (const locale of ["en-US", "zh-CN"] as const) {
    const system = locale === "en-US" ? "System" : "系统";
    const you = locale === "en-US" ? "You" : "你";
    for (const view of [
      <CrewMessageStream detail={detail()} {...callbacks} />,
      <CrewBoard detail={detail()} {...callbacks} />,
    ]) {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>{view}</ZCodeIntlProvider>,
      );
      assert.match(html, /Generated objective/);
      assert.ok(html.includes(`>${system}<`));
      assert.ok(!html.includes(`>${you}<`));
    }
  }
});
