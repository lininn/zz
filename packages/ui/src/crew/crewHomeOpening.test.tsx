import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewGetParams } from "@zcode/shared";
import type { ICrewService } from "@zcode/services";
import type { CrewController } from "../hooks/useCrew.js";
import { useCrewText } from "../hooks/useCrewText.js";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { crewHookHarness } from "./crewHookHarness.js";
import { crewSidebarHarness } from "./crewSidebarHarness.js";
import { chatDetail } from "./crewChatFixtures.js";
import { CrewChatView } from "./CrewChatView.js";

const detail = chatDetail();
detail.conversation.status = "recovery_required";
detail.executions[0]!.status = "recovery_required";
const props = {
  groupId: detail.group.groupId,
  conversationId: detail.conversation.conversationId,
  editing: false,
  onFinishEditing() {},
  onManage() {},
};
async function homeHarness(controller: () => CrewController) {
  return crewSidebarHarness("CrewHome.tsx", {
    "@/hooks/useCrew.js": { useCrew: controller },
    "@/hooks/useCrewText.js": { useCrewText },
    "@/hooks/useCrewAgentCatalog.js": { useCrewAgentCatalog: () => ({}) },
    "@/components/ui/button.js": { Button: "button" },
    "./CrewChatView.js": { CrewChatView },
    "./CrewGroupEditor.js": { CrewGroupEditor: () => null },
    "./crewUiHelpers.js": { crewBindingKey: () => "unused" },
  });
}
function renderHome(
  harness: Awaited<ReturnType<typeof homeHarness>>,
  locale: "zh-CN" | "en-US",
  selection = props,
) {
  function Home() {
    return harness.render("CrewHome", selection);
  }
  return renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale={locale}>
      <Home />
    </ZCodeIntlProvider>,
  );
}

for (const locale of ["zh-CN", "en-US"] as const) {
  test(`selected conversation without a projection is not the unselected empty state (${locale})`, async () => {
    const home = await homeHarness(() => ({ loading: false }) as CrewController);
    const html = renderHome(home, locale);
    assert.doesNotMatch(html, /从左侧选择|Select a crew conversation/);
    assert.match(html, /role="alert"/);
    assert.match(
      html,
      locale === "zh-CN" ? /无法打开所选对话/ : /Unable to open the selected conversation/,
    );
    assert.match(html, locale === "zh-CN" ? /刷新/ : /Refresh/);
  });
}

test("opening a recovery-required selection loads the exact detail and renders chat/actions", async () => {
  const reads: unknown[] = [];
  const pending = Promise.withResolvers<typeof detail>();
  const hook = crewHookHarness({
    listConversations: async () => [detail.conversation],
    get: (target: CrewGetParams) => {
      reads.push(target);
      return pending.promise;
    },
  } as unknown as ICrewService);
  const home = await homeHarness(() => hook.view(props.groupId, props.conversationId));
  assert.match(renderHome(home, "en-US"), /Loading/);
  pending.resolve(detail);
  await setImmediate();
  const html = renderHome(home, "en-US");
  assert.deepEqual(JSON.parse(JSON.stringify(reads)), [
    { groupId: "group", conversationId: "chat" },
  ]);
  assert.match(html, /data-testid="crew-chat"/);
  assert.match(html, /data-testid="crew-execution-row"/);
  assert.match(html, /Inspect this/);
  assert.match(html, /Recover|Resume/);
  assert.match(html, /Cancel/);
  assert.doesNotMatch(html, /Select a crew conversation/);
});

test("read failure has a specific missing-conversation hint, not a selection prompt", async () => {
  const hook = crewHookHarness({
    listConversations: async () => [detail.conversation],
    get: async () => {
      throw new Error("crew.conversationNotFound");
    },
  } as unknown as ICrewService);
  const home = await homeHarness(() => hook.view(props.groupId, props.conversationId));
  renderHome(home, "en-US");
  await setImmediate();
  const html = renderHome(home, "en-US");
  assert.match(html, /This conversation no longer exists/);
  assert.doesNotMatch(html, /Select a crew conversation/);
});

test("invalid detail cannot silently project nothing, and refreshing a valid response opens chat", async () => {
  let response: unknown = {
    ...detail,
    conversation: { ...detail.conversation, groupId: "foreign" },
  };
  const hook = crewHookHarness({
    listConversations: async () => [detail.conversation],
    get: async () => response,
  } as unknown as ICrewService);
  hook.view("group", "chat");
  await setImmediate();
  let crew = hook.view("group", "chat");
  assert.equal(crew.detail, undefined);
  assert.equal(crew.readError, true);
  response = detail;
  await crew.refresh();
  crew = hook.view("group", "chat");
  assert.equal(crew.readError, false);
  assert.equal(crew.detail?.conversation.conversationId, "chat");
});

for (const response of [
  null,
  {},
  { ...detail, group: { ...detail.group, groupId: "foreign" } },
  { ...detail, conversation: { ...detail.conversation, conversationId: "foreign" } },
]) {
  test(`missing/mismatched service response is an explicit read failure (${JSON.stringify(response)?.slice(0, 70)})`, async () => {
    const hook = crewHookHarness({
      listConversations: async () => [],
      get: async () => response,
    } as unknown as ICrewService);
    hook.view("group", "chat");
    await setImmediate();
    const crew = hook.view("group", "chat");
    assert.equal(crew.detail, undefined);
    assert.equal(crew.readError, true);
  });
}
