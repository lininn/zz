import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewConversation, CrewGroup, Locale } from "@zcode/shared";
import type { CrewController } from "../hooks/useCrew.js";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewSidebarActions } from "./CrewSidebarActions.js";
import { CrewSidebarFeedback } from "./CrewSidebarFeedback.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewSidebarHarness, sidebarElements, sidebarText } from "./crewSidebarHarness.js";

const group: CrewGroup = {
  groupId: "group",
  name: "Reviewers",
  workspaceBinding: null,
  members: [],
  epoch: 0,
  status: "unbound",
  createdAt: 0,
  updatedAt: 0,
};
const conversation: CrewConversation = {
  groupId: "group",
  conversationId: "default",
  name: "",
  isDefault: true,
  status: "failed",
  createdAt: 0,
  updatedAt: 0,
};
const controller = (overrides: Partial<CrewController> = {}) =>
  ({
    groups: [],
    conversations: [],
    pending: false,
    loading: false,
    unavailable: false,
    readError: false,
    readErrorKey: "commandError",
    commandError: null,
    ...overrides,
  }) as CrewController;

for (const locale of ["zh-CN", "en-US"] satisfies Locale[]) {
  test(`selected conversation and failure/recovery badges render in ${locale}, with mobile controls`, async () => {
    const crew = controller({
      conversations: [
        conversation,
        {
          ...conversation,
          conversationId: "recover",
          name: "Recovery",
          status: "recovery_required",
        },
        { ...conversation, conversationId: "busy", name: "Running", status: "active" },
        { ...conversation, groupId: "foreign", name: "DO NOT DISPLAY" },
      ],
    });
    const h = await crewSidebarHarness("CrewSidebarGroup.tsx", {
      "@/hooks/useCrew.js": { useCrew: () => crew },
      "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
      "./CrewSidebarActions.js": { CrewSidebarActions },
      "./CrewSidebarFeedback.js": { CrewSidebarFeedback },
      "./CrewStatus.js": { CrewStatus },
    });
    const props = {
      group,
      selectedGroupId: "group",
      selectedConversationId: "default",
      onSelect: () => {},
      onEdit: () => {},
      captureNavigation: () => () => true,
    };
    const node = h.render("CrewSidebarGroup", props);
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>{node}</ZCodeIntlProvider>,
    );
    assert.match(html, /data-conversation-id="default" aria-current="page"/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /min-h-9/);
    assert.match(html, /data-variant="destructive"/);
    assert.match(html, locale === "zh-CN" ? /失败/ : /Failed/);
    assert.doesNotMatch(html, /DO NOT DISPLAY/);
    assert.match(html, /focus-visible:ring/);
  });
}

test("error retry invokes refresh, and unavailable/loading/command-error states are accessible", async () => {
  let refreshes = 0;
  const crew = controller({
    loading: true,
    unavailable: true,
    readError: true,
    commandError: "error.workspaceBusy",
    refresh: async () => {
      refreshes++;
    },
  });
  const h = await crewSidebarHarness("CrewSidebarFeedback.tsx", {
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  });
  let node = h.render("CrewSidebarFeedback", { crew });
  let html = renderToStaticMarkup(node);
  assert.match(html, /role="status">home\.loading<\/p>/);
  assert.match(html, /serviceUnavailable/);
  assert.match(html, /readError/);
  assert.match(html, /error.workspaceBusy/);
  assert.match(html, /disabled=""/);
  crew.loading = false;
  crew.unavailable = false;
  node = h.render("CrewSidebarFeedback", { crew });
  const retry = sidebarElements(node).find((el) => typeof el.props.onClick === "function")!;
  (retry.props.onClick as () => void)();
  assert.equal(refreshes, 1);
  html = renderToStaticMarkup(node);
  assert.doesNotMatch(html, /disabled=""/);
});

test("empty list separates creation and settings; unavailable/read errors do not show misleading empty state", async () => {
  const crew = controller();
  let manages = 0;
  let creates = 0;
  const h = await crewSidebarHarness("CrewSidebar.tsx", {
    "@/hooks/useCrew.js": { useCrew: () => crew },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
    "./CrewSidebarFeedback.js": { CrewSidebarFeedback },
  });
  const props = {
    selectedGroupId: null,
    selectedConversationId: null,
    onSelect: () => {},
    onEdit: () => {},
    onManage: () => manages++,
    onCreate: () => creates++,
  };
  const render = (p = props) => h.render("CrewSidebar", p);
  const markup = () => renderToStaticMarkup(<ZCodeIntlProvider>{render()}</ZCodeIntlProvider>);
  assert.match(markup(), /emptyTitle/);
  assert.match(markup(), /overflow-y-auto/);
  const controls = sidebarElements(render()).filter((el) => typeof el.props.onClick === "function");
  assert.equal(controls.length, 2);
  for (const control of controls) (control.props.onClick as () => void)();
  assert.equal(manages, 1);
  assert.equal(creates, 1);
  crew.readError = true;
  assert.doesNotMatch(markup(), /emptyTitle/);
  crew.readError = false;
  crew.unavailable = true;
  assert.doesNotMatch(markup(), /emptyTitle/);
  const withoutManage = h.render("CrewSidebar", { ...props, onManage: undefined });
  assert.equal(
    sidebarElements(withoutManage).filter((el) => typeof el.props.onClick === "function").length,
    1,
  );
});

test("expanded empty group reports no conversations; initial inactive groups remain collapsed", async () => {
  const crew = controller();
  const h = await crewSidebarHarness("CrewSidebarGroup.tsx", {
    "@/hooks/useCrew.js": { useCrew: () => crew },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
    "./CrewSidebarActions.js": { CrewSidebarActions: () => null },
    "./CrewSidebarFeedback.js": { CrewSidebarFeedback },
    "./CrewStatus.js": { CrewStatus },
  });
  const props = {
    group,
    selectedGroupId: null as string | null,
    selectedConversationId: null,
    onSelect: () => {},
    onEdit: () => {},
    captureNavigation: () => () => true,
  };
  const markup = () =>
    renderToStaticMarkup(
      <ZCodeIntlProvider>{h.render("CrewSidebarGroup", props)}</ZCodeIntlProvider>,
    );
  assert.match(markup(), /aria-expanded="false"/);
  assert.doesNotMatch(markup(), /home.emptyConversations/);
  props.selectedGroupId = "group";
  markup(); // Flush the selected-group expansion effect in the hook-cell harness.
  assert.match(markup(), /home.emptyConversations/);
  crew.loading = true;
  assert.doesNotMatch(markup(), /home.emptyConversations/);
});
